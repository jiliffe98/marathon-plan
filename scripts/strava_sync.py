#!/usr/bin/env python3
"""
Pull recent Strava activities, categorise each (intervals / threshold / easy /
long / ride) using lap data, and merge them into data/activities.json.

Run locally:   STRAVA_CLIENT_ID=.. STRAVA_CLIENT_SECRET=.. STRAVA_REFRESH_TOKEN=.. python scripts/strava_sync.py
In CI:         see .github/workflows/sync.yml (secrets supply the env vars)

Categorisation rules (match how Jeremiah's coach defines them):
  - Intervals : repeated hard efforts each < 2 km  (e.g. 6x400 m, 4x800 m)
  - Threshold : a sustained hard effort >= 2 km     (e.g. one 6 km tempo block)
  - Long      : easy-paced run >= 18 km
  - Easy      : everything else on foot
  - Ride      : anything not a run (excluded from running volume)
Thresholds are tunable in the CONSTANTS block below.
"""
import os, json, sys, datetime, pathlib, urllib.parse, urllib.request

# ---- tunable constants -------------------------------------------------------
LONG_RUN_KM      = 18.0     # >= this, paced easy -> "Long"
REP_MAX_M        = 2000     # a "rep" shorter than this -> intervals; longer -> threshold
MIN_REPS         = 3        # need at least this many fast reps to call it intervals
FAST_RATIO       = 0.92     # a lap is "fast" if its pace <= this * the run's median lap pace
DAYS_BACK        = 21       # how far back to look each run
# -----------------------------------------------------------------------------

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT  = ROOT / "data" / "activities.json"
API  = "https://www.strava.com/api/v3"


def _req(url, data=None, headers=None):
    headers = headers or {}
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def access_token():
    cid = os.environ["STRAVA_CLIENT_ID"]
    secret = os.environ["STRAVA_CLIENT_SECRET"]
    refresh = os.environ["STRAVA_REFRESH_TOKEN"]
    tok = _req("https://www.strava.com/oauth/token", data={
        "client_id": cid, "client_secret": secret,
        "grant_type": "refresh_token", "refresh_token": refresh,
    })
    return tok["access_token"]


def get(path, token, **params):
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    return _req(f"{API}{path}{qs}", headers={"Authorization": f"Bearer {token}"})


def pace_per_km(distance_m, moving_s):
    if not distance_m:
        return 9e9
    return moving_s / (distance_m / 1000.0)


def mmss(sec_per_km):
    m = int(sec_per_km // 60)
    s = int(round(sec_per_km - m * 60))
    if s == 60:
        m, s = m + 1, 0
    return f"{m}:{s:02d}"


def categorise(act, laps):
    """Return (type_label, note) for a run, using lap structure."""
    dist_km = act["distance"] / 1000.0
    avg_pace = pace_per_km(act["distance"], act["moving_time"])

    work = [l for l in laps if l.get("distance", 0) >= 200]
    note = f"{mmss(avg_pace)}/km"

    # A long run is a long run, even with surges or an embedded tempo block.
    if dist_km >= LONG_RUN_KM:
        return "Long", note

    if len(work) >= 2:
        paces = sorted(pace_per_km(l["distance"], l["moving_time"]) for l in work)
        median = paces[len(paces) // 2]
        fast = [l for l in work if pace_per_km(l["distance"], l["moving_time"]) <= median * FAST_RATIO]
        if fast:
            reps_short = [l for l in fast if l["distance"] < REP_MAX_M]
            reps_long  = [l for l in fast if l["distance"] >= REP_MAX_M]
            # threshold = a single sustained long effort
            if reps_long and len(reps_short) < MIN_REPS:
                L = max(reps_long, key=lambda l: l["distance"])
                p = pace_per_km(L["distance"], L["moving_time"])
                return "Threshold", f"{L['distance']/1000:.1f} km continuous @ {mmss(p)}/km"
            # intervals = several short reps
            if len(reps_short) >= MIN_REPS:
                d = reps_short[0]["distance"]
                same = [l for l in reps_short if abs(l["distance"] - d) <= 100]
                rep_m = round(sum(l["distance"] for l in same) / len(same))
                p = sum(pace_per_km(l["distance"], l["moving_time"]) for l in same) / len(same)
                label_m = f"{rep_m} m" if rep_m < 1000 else f"{rep_m/1000:.1f} km"
                return "Intervals", f"{len(same)}×{label_m} @ {mmss(p)}/km"

    return "Easy", note


def main():
    token = access_token()
    after = int((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=DAYS_BACK)).timestamp())
    acts = get("/athlete/activities", token, after=after, per_page=100)

    data = {}
    if OUT.exists():
        data = json.loads(OUT.read_text())

    # Rebuild every in-window date from this pull (so each day holds ALL its
    # activities, and edits/deletes on Strava are reflected). Each date maps to
    # a LIST of activities.
    after_date = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=DAYS_BACK)).strftime("%Y-%m-%d")
    for k in list(data):
        if k[:1].isdigit() and k >= after_date:
            del data[k]

    fresh = {}
    for a in acts:
        date = a["start_date_local"][:10]
        km = round(a["distance"] / 1000.0, 1)
        mins = round(a.get("moving_time", 0) / 60)
        s = (a.get("sport_type") or a.get("type") or "").lower()
        if "run" in s:
            sport = "run"
        elif any(k in s for k in ("ride", "cycl", "bike", "ebike", "velomobile")):
            sport = "ride"
        elif any(k in s for k in ("weight", "strength")):
            sport = "strength"
        elif any(k in s for k in ("workout", "crossfit", "hiit")):
            sport = "run" if km >= 0.5 else "strength"   # a "Workout" with distance is a running workout
        else:
            sport = "other"

        if sport == "run":
            try:
                laps = get(f"/activities/{a['id']}/laps", token)
            except Exception:
                laps = []
            label, note = categorise(a, laps)
            entry = {"km": km, "type": label, "note": note, "done": True, "sport": "run"}
            print(f"  {date}  {label:10} {km:>5} km  ({note})")
        elif sport == "ride":
            entry = {"km": km, "type": "Ride", "note": f"{km} km ride", "done": True, "sport": "ride"}
            print(f"  {date}  Ride       {km:>5} km")
        elif sport == "strength":
            entry = {"km": None, "type": "Strength", "note": f"{mins} min", "done": True, "sport": "strength"}
            print(f"  {date}  Strength   {mins:>4} min")
        else:
            entry = {"km": km, "type": a.get("sport_type") or "Activity", "note": f"{km} km",
                     "done": True, "sport": "other"}
            print(f"  {date}  Other      {km:>5} km")
        fresh.setdefault(date, []).append(entry)

    data.update(fresh)
    data["_synced_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    OUT.write_text(json.dumps(dict(sorted(data.items())), indent=2) + "\n")
    days = sum(1 for k in data if k[:1].isdigit())
    print(f"Wrote {OUT} ({days} days, synced {data['_synced_at']})")


if __name__ == "__main__":
    try:
        main()
    except KeyError as e:
        sys.exit(f"Missing env var: {e}. Set STRAVA_CLIENT_ID / _SECRET / _REFRESH_TOKEN.")
