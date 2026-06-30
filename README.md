# Sydney Marathon Training Plan — hosted app

A phone + laptop web app for your marathon block. Strava activity is pulled in
automatically every day and categorised (intervals / threshold / easy / long);
your notes, logged sessions and drag-rearrangements sync across devices.

```
 your watch ──▶ Strava ──▶ GitHub Action (daily) ──▶ data/activities.json
                                                          │
                            your edits ──▶ Supabase ──────┤
                                                          ▼
                                              GitHub Pages site (phone + laptop)
```

Everything below is **free** and a **one-time setup** (~30 min). Do the parts in
order. After Part 1 you already have a working site; Parts 2–3 add the Strava
auto-pull and cross-device sync.

---

## Part 1 — Put the site online (GitHub Pages)

1. Create a free account at <https://github.com> if you don't have one.
2. Create a new repository — name it e.g. `marathon-plan`, set it **Public**,
   don't add a README (we have one).
3. Upload these files to the repo (drag the whole folder contents into the
   "uploading an existing file" page, or use GitHub Desktop):
   - `index.html`, `config.js`, `README.md`, `supabase_schema.sql`
   - the `data/`, `scripts/`, and `.github/` folders
4. In the repo: **Settings ▸ Pages ▸ Build and deployment**. Set
   **Source = Deploy from a branch**, **Branch = `main` / `(root)`**, Save.
5. Wait ~1 minute. Your site is live at
   `https://<your-username>.github.io/marathon-plan/`.
   Open it on your phone and add it to your home screen.

✅ At this point the plan + your already-recorded sessions (through 30 June) are
live. Edits save on that one device until you finish Part 3.

---

## Part 2 — Auto-pull from Strava

### 2a. Create a Strava API application
1. Go to <https://www.strava.com/settings/api> (log into Strava).
2. Fill the form: Application Name `marathon-plan`, Category `Training`,
   Website `https://<your-username>.github.io/marathon-plan/`,
   **Authorization Callback Domain** = `localhost`.
3. Note your **Client ID** and **Client Secret**.

### 2b. Get a refresh token (one time)
1. Paste this URL in your browser (replace `CLIENT_ID`), press Enter:
   ```
   https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
   ```
2. Click **Authorize**. The browser jumps to a `http://localhost/?...&code=XXXX...`
   page that won't load — that's fine. Copy the **`code`** value from the address bar.
3. Swap that code for a refresh token. In a terminal (or run the helper
   `python scripts/get_token.py` if you prefer — see note below), run:
   ```
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d code=CODE_FROM_STEP_2 \
     -d grant_type=authorization_code
   ```
4. In the JSON that comes back, copy the **`refresh_token`** value.

### 2c. Store the secrets in GitHub
In your repo: **Settings ▸ Secrets and variables ▸ Actions ▸ New repository
secret**. Add three:
| Name | Value |
|---|---|
| `STRAVA_CLIENT_ID` | your Client ID |
| `STRAVA_CLIENT_SECRET` | your Client Secret |
| `STRAVA_REFRESH_TOKEN` | the refresh token from 2b |

### 2d. Run it
**Actions** tab ▸ **Strava sync** ▸ **Run workflow**. After it finishes it will
have refreshed `data/activities.json`. From then on it runs itself every morning.
Make sure your Garmin → Strava auto-upload is on (Garmin Connect ▸ Settings ▸
Connected Apps ▸ Strava) so new runs reach Strava.

---

## Part 3 — Sync your edits across devices (Supabase)

1. Create a free project at <https://supabase.com>.
2. **SQL Editor ▸ New query** → paste the contents of `supabase_schema.sql` → **Run**.
3. **Project Settings ▸ API**: copy the **Project URL** and the **anon public** key.
4. Edit `config.js` in your repo and fill them in:
   ```js
   window.CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...your anon key...",
     STATE_ID: "jeremiah"
   };
   ```
5. Commit the change. The site's pill in the top-right will now read
   **“Cloud sync on”** and your notes/logs/rearrangements follow you between phone
   and laptop.

> The anon key is public by design (it sits in the page). For low-sensitivity
> training data that's fine. If you ever want it locked to just you, ask and we'll
> add proper auth.

---

## Using it day to day
- **Tap a day** → log what you did (distance, type), add a note, or mark complete.
  A manual entry overrides the Strava import for that day.
- **Drag a session** onto another day to rearrange (on phone, use the “Move to”
  buttons in the day editor).
- **Week headers** show your actual **long run** and **total km** vs target, with a
  red/amber/green bar and +/− delta. Rides don't count toward running volume.
- **Reset edits** clears only your manual changes; Strava data stays.

## Tuning the auto-categorisation
Open `scripts/strava_sync.py` → the `CONSTANTS` block at the top:
`LONG_RUN_KM`, `REP_MAX_M` (intervals vs threshold cutoff = 2 km),
`MIN_REPS`, `FAST_RATIO`. Change, commit, re-run the workflow.

## Cost
GitHub Pages, GitHub Actions, Strava API, and Supabase are all free at this usage.
