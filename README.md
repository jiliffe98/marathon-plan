# Training plan apps — `jiliffe98.github.io/marathon-plan`

Two apps in one repo, sharing one Strava sync and one Supabase project.

| URL | What | Supabase row (`STATE_ID`) |
|---|---|---|
| `/` | **Sub-20 5k Block** — Sep–Dec 2026, the current training block | `jeremiah-block1` |
| `/marathon/` | **Sydney Marathon 2026 — record** — the completed block, frozen at 31 Aug | `jeremiah` |

```
 watch ──▶ Strava ──▶ GitHub Action (hourly) ──▶ data/activities.json ──▶ /  (block app)
                                                                        
                      your edits ──▶ Supabase training_state ──▶ both apps (separate rows)
                      coach chat  ──▶ Supabase Edge Function `coach` ──▶ Claude
                      /marathon/data/activities.json is a frozen snapshot — never rewritten
```

## Repo layout

| Path | Purpose |
|---|---|
| `index.html`, `config.js`, `sw.js`, `manifest.webmanifest` | the current block app (root) |
| `marathon/` | the archived marathon app — self-contained: own data snapshot, service worker cache, manifest |
| `data/activities.json` | live Strava data, rewritten hourly for the last 21 days (+2-day timezone margin) |
| `scripts/strava_sync.py` | Strava pull + session categorisation (intervals / threshold / easy / long); rides carry duration, avg watts and NP |
| `.github/workflows/sync.yml` | hourly cron + manual dispatch (`days_back`, `debug_date`, `debug_splits` inputs) |
| `supabase/functions/coach` | Claude coach. Block-agnostic — the client sends `context.block` (goal, paces, zones, rules) |
| `supabase/functions/resync` | "↻ Resync Strava" button → dispatches the sync workflow (`GITHUB_TOKEN` secret, Actions:write on this repo only) |
| `supabase/functions/nlplan` | legacy plan editor, superseded by `coach`; not called by either app |
| `supabase_schema.sql` | the one table: `training_state(id text pk, data jsonb)` |

## Starting the next block (when this one is done)

1. `mkdir block1 && cp index.html config.js sw.js manifest.webmanifest apple-touch-icon.png block1/ && cp -r icons block1/ && mkdir block1/data`
   then snapshot `data/activities.json` into `block1/data/`, trimmed to the block's dates, and add a "completed" banner.
2. In the root `index.html`: rewrite `PLAN`, `RACE_ISO`, `BENCH_ISO`, the `BLOCK` coach brief, and the two reference panels.
3. New `STATE_ID` in `config.js`; new `CACHE` name in `sw.js` and in the archive's `sw.js`.
4. The sync, the Supabase project and the edge functions need no changes.

## Day to day

- **Tap a day** → edit planned sessions (run / ride / strength), log something Strava missed, or move a session with the "Move to" buttons. **Drag** a chip to another day on desktop.
- **Tap a completed chip** → Strava detail (pace or NP, duration) plus the planned session's detail text; add a per-session note.
- **Week headers** show run km vs target, runs / rides / gym done vs planned, and the long run. The left border is the phase colour.
- **💬 Coach** answers questions about the block and proposes plan edits you can apply or dismiss.
- **↻ Resync Strava** triggers a pull now; the cron runs hourly anyway.
- **Reset edits** clears only this app's manual edits. Strava data and the other app's edits are untouched.

## Setup (already done — for reference)

**Hosting:** GitHub Pages from `main` / root. **Strava:** an API app with `activity:read_all`; the refresh token
plus client id/secret live as repo Actions secrets `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`
(`scripts/get_token.py` is the one-time token helper). **Supabase:** run `supabase_schema.sql` once; the anon key
in `config.js` is public by design. Edge-function secrets (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) are set in the
Supabase dashboard, never in the browser. Deploy functions with `supabase functions deploy <name> --project-ref <ref>`
and leave JWT verification on.

## Tuning the auto-categorisation

`scripts/strava_sync.py` → `CONSTANTS`: `LONG_RUN_KM`, `REP_MAX_M` (intervals vs threshold cut-off, 2 km),
`MIN_REPS`, `INTERVAL_GAP`, `THRESH_MARGIN`, `DAYS_BACK`. Change, commit, re-run the workflow.

## Known history

- Early-morning runs were silently deleted after 21 days (Strava filters `after` in UTC, the app keys by local date). Fixed Sep 2026 with a 2-day fetch margin; a 90-day backfill restored the block.
- The activity fetch is paginated so a wide `days_back` can't truncate and lose days.
- Garmin's stored FTP (295 W) was a setting, not a test; the block app uses 280 W pending the week-4 test.

## Cost

GitHub Pages, GitHub Actions, Strava API and Supabase are free at this usage. The coach uses Anthropic API credit.
