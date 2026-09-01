# VoiceLift

Log your workout by talking. Say *"bench press 185 for 8"* between sets and
it's recorded, checked against your history, and answered with what to put on
the bar next.

No build step, no dependencies, no account, no server. Open `index.html` and
it works.

```
speech ──► parser ──► store ──► coach ──► spoken reply
              │         │         │
              │         │         └─ load-jump / fatigue / recovery flags
              │         └─ localStorage + CSV export
              └─ "two twenty five for eight at rpe eight" → {225 lb × 8, RPE 8}
```

## Running it

ES modules need to be served over HTTP — opening the file directly with
`file://` will not work.

```bash
python3 -m http.server 8080     # or: npx serve .
# then open http://localhost:8080
```

## Putting it on your phone

The app is a PWA: install it and it runs fullscreen, offline, with the screen
held awake.

**Publishing it.** The deploy workflow is committed. It needs one switch that
only a repo admin can flip:

> **Settings → Pages → Build and deployment → Source: "GitHub Actions"**

The workflow cannot do this itself — creating a Pages site requires repo-admin
rights that `GITHUB_TOKEN` does not have. Until it is flipped the deploy job
skips quietly instead of failing, so you never get a red build email about it.

**On a free account, Pages also requires the repository to be public.** If you
want to keep this repo private, host it on **Cloudflare Pages** or **Netlify**
instead — both serve private repos for free, connect straight to GitHub, and
need no files in the repo. Point them at this repo with an empty build command
and `.` as the publish directory.

Every asset path, the service-worker scope, and the manifest `start_url` are
relative, so the app works at a domain root and at a repo subpath
(`https://<owner>.github.io/Workout-Log-App/`) alike. Both are tested.

**Installing it.**

- **Android / Chrome / Edge** — the browser offers an install prompt, or use the
  button in Settings → Install.
- **iPhone / Safari** — Share → *Add to Home Screen*. Safari never offers a
  prompt, so the app tells you this rather than waiting for one that isn't
  coming.

**Why bother installing:** you get the full screen back, it opens with no
address bar, and the service worker means it works in a basement gym with no
signal. Your log was always local; now the app itself is too.

**Screen Wake Lock** is held while the mic is live or a rest timer is running,
and released as soon as neither is — so the screen doesn't lock between sets,
but it also isn't burning battery while you read the charts. Where Wake Lock
isn't supported the app says so and tells you to lengthen your screen timeout.

Speech recognition needs HTTPS or localhost, and a browser that ships the Web
Speech API (Chrome, Edge, Safari 14.1+; **not** Firefox). Without it the app
still runs — the text box feeds the exact same parser, so nothing is lost but
your hands.

```bash
npm test        # 43 tests, no dependencies — or: node --test test/*.test.mjs
```

## What you can say

| You say | It logs |
|---|---|
| `bench press 185 for 8` | 185 lb × 8 |
| `two twenty five for five at rpe eight` | 225 lb × 5, RPE 8, 2 RIR |
| `three sets of ten on lat pulldown at 120` | 3 × 120 lb × 10 |
| `squat two plates for five` | 225 lb × 5 (45 lb bar + 2 plates a side) |
| `incline dumbbell press 60s for 10 each hand` | 60 lb/hand × 10 |
| `deadlift four oh five single` | 405 lb × 1 |
| `pull ups bodyweight 12` | 12 reps at bodyweight |
| `run 5k in 28 minutes` | 5,000 m in 28:00 |
| `plank for a minute` | 60 s hold |
| `185 for 8` | same exercise as the last set — say the name once |
| `same again` / `one more` | repeats the previous set |
| `make that 195` | corrects what it just logged |
| `undo` · `rest 90 seconds` · `what's next` · `finish workout` | commands |

The parser handles spoken numbers the way lifters actually say them —
`two twenty five` is 225, `one thirty five` is 135, `four oh five` is 405,
`a hundred and eighty five` is 185 — plus plate maths, per-hand dumbbell
loads, RPE/RIR, and several sets in one breath
(`185 for 8 then 185 for 6 then 185 for 5`).

Anything it isn't sure about is logged with a visible confidence warning and a
tap-to-fix row, rather than quietly guessing. An unrecognised movement is kept
as a custom exercise instead of being dropped.

## The coach

After every set the app checks what just happened against your own history and
common strength-training practice. The rules, all in `js/coach.js` under
`RULES` so they're easy to argue with:

| Rule | Threshold |
|---|---|
| Load jump vs. your best in 60 days | flag above **10%**, hard stop above 20% |
| Within-session fade (estimated 1RM vs. best set today) | back off at **7.5%** |
| Reps lost at the same load | back off at **3** |
| Hard sets on one compound | nudge past **6** |
| Weekly hard sets per muscle | flag past **22** |
| Same muscle trained again | flag inside **48 h** |
| This week's tonnage ÷ 4-week average | flag past **1.5** |
| Estimated max flat for 3 sessions | suggest a **12%** deload |

Progression is double-progression: earn the top of the rep range at a
manageable RPE, then take one increment — rounded to what the equipment
actually offers — and start again at the bottom of the range. A first-ever
session on a movement is deliberately under-loaded, and a lift you haven't
touched in three weeks comes back 10% lighter than you left it.

The recommendation also carries a warm-up ramp, a rest interval, and the
reasoning it used ("last session 2026-08-17: 185 lb × 8, estimated 1RM ~232").

**This is not medical advice**, and the app says so on the screen. It cannot
see your form, and it only knows what you tell it.

## The data sheet

Every set lands in a table you can read, filter, and export:

- **Sets CSV** — one row per entry, with estimated 1RM, volume, and the raw
  transcript of what you said, so a bad parse is always traceable.
- **Sessions CSV** — one row per workout: sets, reps, tonnage, estimated
  calories, work and elapsed minutes.
- **JSON backup** — the whole state, re-importable.

Charts cover estimated 1RM per lift over time, per-session and weekly volume
(the progressive-overload picture), estimated energy per session, and hard sets
per muscle over the last 7 days.

### About the numbers

- **Estimated 1RM** averages Epley and Brzycki up to 10 reps and folds in
  reps-in-reserve when you report an RPE. Past ~12 reps it's flagged low
  confidence, because the formulas stop meaning much there.
- **Volume** is load × reps, counting both dumbbells and a share of bodyweight
  on bodyweight lifts (a pull-up moves all of you; a push-up about 64%).
- **Calories** are a MET model — `MET × 3.5 × kg / 200 × minutes` — using time
  under load at the exercise's MET and rest at MET 2.5. It's an estimate, and
  it will read lower than the wildly optimistic numbers most trackers print.

## Where the data lives

Your **training log** lives in `localStorage`, in your browser, on your device.
It is never uploaded and there is no account. The flip side: clearing site data
erases it, so take a JSON backup occasionally.

Your **voice** is a separate question. The Web Speech API is implemented by the
browser, not by this app, and in Chrome that means the audio is sent to Google's
servers for recognition. Safari's behaviour depends on the platform and language.
So: the log is local, the audio may not be. If that matters to you, the honest
fix is an on-device recogniser (a WASM Whisper build), not a privacy claim.

## Layout

```
index.html            markup and the shell
manifest.webmanifest  install metadata
sw.js                 service worker — precache, offline, update prompt
icons/                app icon (source SVG plus rendered PNGs)
css/styles.css        theme tokens, light and dark each chosen rather than flipped
js/exercises.js       58 exercises with aliases, MET values, increments, rep ranges
js/parser.js          speech → structured set (the interesting file)
js/analytics.js       1RM, volume, calories, PRs, trend series, ACWR
js/coach.js           recommendations and safety flags
js/store.js           localStorage, CSV/JSON export, sample data
js/charts.js          dependency-free SVG charts
js/speech.js          Web Speech API wrapper with restart handling
js/wakelock.js        Screen Wake Lock, re-acquired on return to visibility
js/app.js             UI wiring
test/                 43 tests over the parser, analytics, and coach
```

## Known limits

1. **Recognition quality is the ceiling.** In a loud gym the browser's
   recogniser mishears; the confidence warnings and the tap-to-fix rows exist
   because of that, not in spite of it. A rack-side phone at arm's length works
   better than a pocket.
2. **English only.** The number words and the alias list are `en-US`.
3. **No sync between devices.** One browser, one log, plus manual export.
4. **The coach only knows what's logged.** Sleep, food, stress, and yesterday's
   shift all matter more than any of these rules, and it can't see them.
5. **Bodyweight is a static setting**, so calorie and bodyweight-lift volume
   numbers drift if yours changes and you don't update it.
6. **The mic stops when the screen locks.** This is the browser, not the app —
   iOS tears down speech recognition on background, and Android suspends the
   tab. The app stands the mic down cleanly and restarts it when you come back,
   and the wake lock keeps the screen on while you're actually training, but
   truly hands-off listening with the phone in your pocket needs a native
   speech plugin and a store build. That is the one thing the web version
   structurally cannot do.
