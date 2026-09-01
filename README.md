# VoiceLift

Say your set, it gets logged. That's the whole app.

> "bench press 185 for 8" → **Barbell Bench Press · 185 lb × 8**

No build step, no dependencies, no server, no account. Open `index.html` and
it works.

## Running it

ES modules need HTTP — `file://` will not work.

```bash
python3 -m http.server 8080     # then open http://localhost:8080
npm test                         # 23 tests, no dependencies
```

## What you can say

Word order does not matter. The parser finds the exercise, the weight and the
reps wherever they land in the sentence — all of these log the same set:

```
bench press 185 for 8      185 for 8 bench press      8 reps of bench press at 185
bench press for 8 at 185   at 185 bench press 8 reps  185 pounds bench press 8 reps
```

| You say | It logs |
|---|---|
| `two twenty five for five at rpe eight` | 225 lb × 5, RPE 8 |
| `three sets of ten on lat pulldown at 120` | 3 × 120 lb × 10 |
| `squat two plates for five` | 225 lb × 5 (45 lb bar + 2 plates a side) |
| `incline dumbbell press 60s for 10 each hand` | 60 lb/hand × 10 |
| `deadlift four oh five single` | 405 lb × 1 |
| `pull ups bodyweight 12` | 12 reps at bodyweight |
| `run 5k in 28 minutes` · `plank 60 seconds` | cardio and holds |
| `185 for 8` | same exercise as the last set — name it once |
| `same again` · `one more` | repeats the previous set |
| `make that 195` | corrects what it just logged |
| `undo` · `finish workout` | commands |

Spoken numbers work the way lifters actually say them: `two twenty five` is
225, `one thirty five` is 135, `four oh five` is 405, `a hundred and eighty
five` is 185. Several sets in one breath work too —
`185 for 8 then 185 for 6 then 185 for 5`.

Anything the parser isn't sure of is logged with a **check** tag and a
tap-to-fix row rather than a silent guess. An unrecognised movement is kept as
a custom exercise instead of being dropped.

## The log

- **Today** — what you've done this session, grouped by exercise. Tap any set
  to correct it.
- **History** — every finished workout.
- **Export** — sets CSV (with the raw transcript of what you said, so a bad
  parse is traceable), workouts CSV, and a JSON backup.

## About the microphone

The in-app mic uses the browser's Web Speech API, which is not evenly
supported:

| | In-app mic |
|---|---|
| Chrome / Edge (desktop, Android) | works |
| Safari on macOS / iOS **in a browser tab** | works |
| **iOS home-screen app** | **does not work** — WebKit switches speech recognition off in standalone mode |
| Chrome / Firefox on iOS | does not work — WebKit without the speech API |
| Firefox anywhere | does not work — no Web Speech API |

**Where the in-app mic doesn't work, use your keyboard's dictation key.** Tap
the text box, hit the 🎤 on the keyboard, and talk. It goes through the exact
same parser, it's on-device, and on iOS it works everywhere including the
installed app. The app detects your situation and says which one you're in.

Also worth knowing: your **log** never leaves the device, but your **voice**
might — in Chrome, Web Speech audio is sent to Google's servers for
recognition. Keyboard dictation on iOS is on-device.

## Install

- **Android / Chrome** — install prompt, or the button in Settings.
- **iPhone** — Safari → Share → Add to Home Screen. Remember the mic caveat
  above: installed means keyboard dictation.

Installed, it works offline — the service worker caches the whole app.

## Layout

```
index.html            markup
manifest.webmanifest  install metadata
sw.js                 offline precache + update prompt
css/styles.css        theme tokens; light and dark each chosen, not flipped
js/parser.js          speech → structured set (the interesting file)
js/exercises.js       58 exercises with aliases and equipment increments
js/store.js           localStorage, CSV/JSON export
js/totals.js          sets, reps, volume — the only maths in the app
js/speech.js          Web Speech wrapper, with the iOS quirks handled
js/wakelock.js        keeps the screen on while the mic is live
js/app.js             UI
test/                 23 parser tests, including word-order permutations
```

## Deliberately not here

No coaching, no predicted one-rep maxes, no calorie estimates, no readiness
scores. Those are guesses wearing the costume of data, and they do not belong
in the place you record what actually happened. Get the logging right first.

## Known limits

1. **Recognition quality is the ceiling.** In a loud gym the recogniser
   mishears; the check tags and tap-to-fix rows exist because of that. A
   phone at arm's length beats one in your pocket.
2. **English only** — the number words and alias list are `en-US`.
3. **One device.** No sync; export the JSON to move it.
4. **The mic stops when the screen locks.** The wake lock keeps the screen on
   while you're training, but hands-off listening with the phone pocketed
   needs a native app.
