/**
 * Voice-utterance parser: free speech -> a structured set.
 *
 * Speech recognisers hand back a bare string with no punctuation and a
 * habit of spelling numbers out, so everything here works on words:
 *   "bench press two twenty five for eight at rpe eight"
 *   "three sets of ten on lat pulldown a hundred and twenty"
 *   "squat two plates for five"
 *   "one eighty five for eight"        (exercise carried from context)
 *   "run five k in twenty eight minutes"
 *
 * parseUtterance() never throws; a hopeless utterance comes back as
 * {type:'unknown'} with a reason so the UI can ask for a repeat.
 */

import { ALIAS_INDEX, BY_ID } from './exercises.js';
import { phoneticSimilarity } from './phonetic.js';

// ---------------------------------------------------------------------------
// Spoken numbers
// ---------------------------------------------------------------------------

const UNITS = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES = { hundred: 100, thousand: 1000 };

const NUM_WORD = (w) => (
  w in UNITS ? { t: 'unit', v: UNITS[w] }
    : w in TEENS ? { t: 'teen', v: TEENS[w] }
      : w in TENS ? { t: 'ten', v: TENS[w] }
        : w in SCALES ? { t: 'scale', v: SCALES[w] }
          : null
);

/** Half-values people actually say: "two and a half", "sixty five and a half". */
const HALF_RE = /\band a half\b/;

/**
 * Fold a run of number words into one value.
 * Handles both plain English ("one hundred and eighty five" -> 185) and the
 * gym shorthand where the hundreds digit is just stated ("two twenty five"
 * -> 225, "four oh five" -> 405).
 */
function foldRun(run) {
  const hasScale = run.some((n) => n.t === 'scale');

  if (hasScale) {
    let total = 0;
    let current = 0;
    for (const n of run) {
      if (n.t === 'scale') {
        if (n.v === 100) current = (current || 1) * 100;
        else { total += (current || 1) * n.v; current = 0; }
      } else {
        current += n.v;
      }
    }
    return [total + current];
  }

  // Merge "twenty five" -> 25 first.
  const parts = [];
  for (let i = 0; i < run.length; i += 1) {
    if (run[i].t === 'ten' && run[i + 1] && run[i + 1].t === 'unit' && run[i + 1].v > 0) {
      parts.push(run[i].v + run[i + 1].v);
      i += 1;
    } else {
      parts.push(run[i].v);
    }
  }

  // "four oh five" -> 405
  if (parts.length === 3 && parts[0] >= 1 && parts[0] <= 9 && parts[1] === 0 && parts[2] >= 1 && parts[2] <= 9) {
    return [parts[0] * 100 + parts[2]];
  }
  // "two twenty five" -> 225 / "three fifteen" -> 315 / "one ten" -> 110
  if (parts.length >= 2 && parts[0] >= 1 && parts[0] <= 9 && parts[1] >= 10 && parts[1] <= 99) {
    return [parts[0] * 100 + parts[1], ...parts.slice(2)];
  }
  return parts;
}

/** Rewrite spoken numbers in `text` as digits. */
export function wordsToNumbers(text) {
  const withHalves = text.replace(HALF_RE, '__HALF__');
  const tokens = withHalves.split(/\s+/);
  const out = [];
  let run = [];

  const flush = () => {
    if (!run.length) return;
    out.push(...foldRun(run).map(String));
    run = [];
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const word = raw.toLowerCase();
    const num = NUM_WORD(word);

    if (num) {
      // "a"/"an" only counts as 1 in front of a scale word, handled below.
      run.push(num);
      continue;
    }
    if (word === 'and' && run.length && NUM_WORD((tokens[i + 1] || '').toLowerCase())) {
      continue; // "a hundred and five"
    }
    if ((word === 'a' || word === 'an') && (tokens[i + 1] || '').toLowerCase() in SCALES) {
      run.push({ t: 'unit', v: 1 });
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();

  return out.join(' ')
    .replace(/(\d+) __HALF__/g, (_, d) => `${Number(d) + 0.5}`)
    .replace(/__HALF__/g, 'half');
}

// ---------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------

/** "benched" is the bench press; "squatted" is a squat. */
const VERB_FORMS = new Map(Object.entries({
  benched: 'bench', squatted: 'squat', deadlifted: 'deadlift',
  curled: 'curl', rowed: 'row', pressed: 'press', pulled: 'pull',
  dipped: 'dip', lunged: 'lunge', planked: 'plank', shrugged: 'shrug',
  ran: 'run', jogged: 'jog', biked: 'bike', swam: 'swim', walked: 'walk',
  benching: 'bench', squatting: 'squat', deadlifting: 'deadlift',
  curling: 'curl', rowing: 'row', pressing: 'press', running: 'run',
}));

const FILLERS = [
  'u+m+', 'u+h+', 'e+r+', 'h+m+', 'mm+', 'okay', 'ok', 'alright', 'all right',
  'so', 'like', 'just', 'please', 'yeah', 'yep', 'and then i', 'i think',
  // Commentary people tack on the end: "185 for 8 nice", "225 for 5, brutal".
  'nice', 'easy', 'heavy', 'hard', 'good', 'great', 'tough', 'solid', 'clean',
  'smooth', 'brutal', 'rough', 'light', 'felt', 'feels', 'feeling', 'boom',
  'there', 'done', 'ez',
];
/**
 * Conversational scaffolding people put in front of the actual set.
 *
 * Real speech is not "bench press 185 for 8" — it is "hey, can you log my
 * first set of bench press, 185 for 8". These are stripped from the start of
 * the utterance, repeatedly, until only the set is left. Order matters:
 * longer phrases first so "i'd like you to" is not half-eaten by "to".
 */
const LEAD_INS = [
  // politeness and address
  "i'd like you to", 'i would like you to', 'i want you to', 'i need you to',
  'can you please', 'could you please', 'would you please',
  'can you', 'could you', 'would you', 'will you',
  'please', 'hey there', 'hey', 'hi', 'yo', 'okay', 'ok', 'alright', 'right',
  "let's", 'lets', 'help me', 'go ahead and', 'for me',
  // intent
  'i want to', 'i wanna', 'i am going to', "i'm going to", 'im going to',
  'i am about to', "i'm about to", 'going to', 'gonna',
  'log down', 'log', 'logged', 'logging', 'record', 'recording',
  'put down', 'put in', 'write down', 'write', 'note that', 'note down',
  'mark down', 'mark', 'save', 'enter', 'track', 'add in', 'add',
  // reporting what happened
  'i did', 'i just did', 'i have done', "i've done", 'that was', 'this was',
  'did', 'doing', 'i am doing', "i'm doing", 'im doing', 'finished', 'completed',
  // sequencing chatter
  'first exercise', 'next exercise', 'last exercise', 'the exercise',
  'my first set of', 'the first set of', 'first set of', 'my first set',
  'the first set', 'first set', 'my next set of', 'next set of', 'my set of',
  'my last set', 'this set', 'that set', 'the set', 'my set',
  'lets do', "let's do", 'next up', 'next', 'this is', 'it was', 'as',
  'moving on to', 'moving to', 'switching to', 'switch to', 'now doing',
  'starting', 'time for', 'on to', 'onto',
  // stray connectors left behind by the above
  'the', 'a', 'an', 'my', 'of', 'is', 'was', 'that', 'to', 'and', 'then', 'for the',
];

export function normalizeText(input) {
  let t = String(input || '').toLowerCase();
  t = t.replace(/[×✕]/g, ' x ');
  t = t.replace(/@/g, ' at ');
  t = t.replace(/[^a-z0-9:.\s'-]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // Lifter shorthand for rep counts.
  t = t.replace(/\b(?:a |one )?single\b/g, '1 reps')
    .replace(/\b(?:a |one )?double\b/g, '2 reps')
    .replace(/\b(?:a |one )?triple\b/g, '3 reps');
  for (const f of FILLERS) t = t.replace(new RegExp(`\\b${f}\\b`, 'g'), ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // Verb forms back to the noun the exercise list knows.
  t = t.split(' ').map((w) => VERB_FORMS.get(w) || w).join(' ');
  // "hey can you log my first set of bench press" stacks five of these, so
  // keep peeling until nothing matches. A strip that would leave nothing
  // useful behind is rolled back — better a clumsy parse than an empty one.
  const OPERATIONS = new Set(['add', 'add in', 'up', 'drop', 'down', 'plus', 'minus']);
  const ordered = [...LEAD_INS].sort((a, b) => b.length - a.length);
  for (let pass = 0; pass < 8; pass += 1) {
    let peeled = false;
    for (const l of ordered) {
      const re = new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (!re.test(t)) continue;
      const next = t.replace(re, '').trim();
      // "add ten" is an instruction, not a preamble.
      if (OPERATIONS.has(l) && /^(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty)\b/.test(next)) continue;
      if (!next) return t;           // that phrase *was* the whole utterance
      t = next;
      peeled = true;
      break;
    }
    if (!peeled) break;
  }
  return t.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Exercise matching
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

const STOP = new Set(['the', 'a', 'an', 'of', 'on', 'at', 'for', 'with', 'to', 'my', 'some', 'x', 'by', 'and', 'then', 'set', 'sets', 'rep', 'reps']);

const singular = (w) => (
  w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w
);

function tokenScore(phrase, alias) {
  const pa = phrase.split(' ').filter((w) => w && !STOP.has(w)).map(singular);
  const ab = alias.split(' ').filter((w) => w && !STOP.has(w)).map(singular);
  if (!pa.length || !ab.length) return 0;
  let hits = 0;
  for (const w of ab) {
    // Spelling distance catches typos; phonetic distance catches mishearings.
    // "bensch press" is two letters off "bench press" but identical out loud.
    if (pa.some((p) => p === w
      || similarity(p, w) >= 0.8
      || phoneticSimilarity(p, w) >= 0.85)) hits += 1;
  }
  const recall = hits / ab.length;
  const precision = hits / pa.length;
  return (2 * recall * precision) / (recall + precision || 1);
}

/**
 * Find an exercise inside `text`.
 * Returns {exercise, alias, score, exact} or null. Exact alias hits win; a
 * fuzzy hit needs to clear 0.72 so mumbles don't log the wrong lift.
 */
export function matchExercise(text) {
  const t = ` ${text.replace(/-/g, ' ')} `;

  for (const { alias, ex } of ALIAS_INDEX) {
    if (t.includes(` ${alias} `)) {
      return { exercise: ex, alias, score: 1, exact: true };
    }
  }

  const phrase = text
    .split(' ')
    .filter((w) => !/\d/.test(w) && !STOP.has(w))
    .join(' ')
    .trim();
  if (!phrase) return null;

  let best = null;
  for (const { alias, ex } of ALIAS_INDEX) {
    const score = tokenScore(phrase, alias);
    if (!best || score > best.score) best = { exercise: ex, alias, score, exact: false };
  }
  return best && best.score >= 0.72 ? best : null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const COMMANDS = [
  { command: 'undo', re: /^(undo|scratch that|delete that|remove that|delete the last( one| set)?|remove the last( one| set)?|never mind|nevermind|oops)\b/ },
  { command: 'finish', re: /^(finish|end|stop|done)( the| my)?( workout| session| for today| for the day)?\b/ },
  { command: 'new', re: /^(new|start( a)?( new)?)( workout| session)\b/ },
  { command: 'coach', re: /^(what('s| is)? next|what should i do|coach|recommend|advise|any advice|how much should i)\b/ },
  { command: 'rest', re: /^(rest|start( a)?( rest)? timer|timer)\b/ },
  { command: 'note', re: /^(note|add a note|remember)\b/ },
  { command: 'repeat', re: /^(same( again| weight| thing)?|again|one more|another( one| set)?|repeat)\b/ },
];

const AMEND_RE = /^(?:no |nope |actually |make that |change that to |correct that to |i meant |meant )+/;

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

const NUM = '(\\d+(?:\\.\\d+)?)';

const DISTANCE_UNITS = {
  kilometer: 1000, kilometre: 1000, km: 1000, k: 1000,
  mile: 1609.34, miles: 1609.34, mi: 1609.34,
  meter: 1, metre: 1, m: 1,
  yard: 0.9144, yd: 0.9144, yds: 0.9144,
};

const LB_PER_KG = 2.20462;

/** Pull one regex out of `state.text`, blanking what it consumed. */
function take(state, re) {
  const m = state.text.match(re);
  if (!m) return null;
  state.text = `${state.text.slice(0, m.index)} ${state.text.slice(m.index + m[0].length)}`
    .replace(/\s+/g, ' ').trim();
  return m;
}

function extractFields(text, exercise, opts) {
  const f = { warnings: [] };
  const kind = exercise ? exercise.kind : 'weight_reps';

  // "60s" means 60-pound dumbbells on a lift and 60 seconds on a hold.
  const state = {
    text: text.replace(/\b(\d+)s\b/g, kind === 'duration' ? '$1 seconds' : '$1'),
  };

  // A warm-up is still a set, but it must not be mistaken for working volume.
  if (take(state, /\b(?:warm ?ups?|warm ?up sets?)\b/)) f.warmup = true;

  // "failed at 6", "only got 6" — the number is reps, not load.
  const shortfall = take(state, new RegExp(`\\b(?:failed at|failed on|only got|only did|only managed|managed only)\\s*${NUM}\\b`));
  if (shortfall) {
    f.reps = Number(shortfall[1]);
    f.rir = 0;
    f.toFailure = true;
  }

  // Bodyweight-only.
  if (take(state, /\b(?:body ?weight|just my body ?weight|no (?:added )?weight|unweighted|bw)\b/)) {
    f.bodyweight = true;
  }

  // "each side" / "per hand".
  if (take(state, /\b(?:each|per|a) (?:side|hand|arm|leg)\b/) || take(state, /\beach\b/)) {
    f.perSide = true;
  }

  // Plate maths: 45 lb bar + 45 lb plates per side.
  const plates = take(state, new RegExp(`\\b${NUM}\\s*plates?\\b`))
    || take(state, /\b(a|one) plate\b/);
  if (plates) {
    const n = Number.isNaN(Number(plates[1])) ? 1 : Number(plates[1]);
    f.weight = 45 + 90 * n;
    f.unit = 'lb';
    f.weightSource = 'plates';
  }

  // RPE / RIR.
  const rpe = take(state, new RegExp(`\\brpe\\s*(?:of\\s*)?${NUM}\\b`))
    || take(state, new RegExp(`\\b${NUM}\\s*rpe\\b`));
  if (rpe) f.rpe = Number(rpe[1]);

  const rir = take(state, new RegExp(`\\b${NUM}\\s*(?:rir|reps? in reserve|in (?:the )?(?:tank|reserve)|left in the tank)\\b`));
  if (rir) f.rir = Number(rir[1]);
  if (take(state, /\b(?:to failure|failed|failure|all out|maxed out)\b/)) {
    f.rir = 0;
    f.toFailure = true;
  }

  // Duration.
  const clock = take(state, /\b(\d+):(\d{2})\b/);
  if (clock) f.durationSec = Number(clock[1]) * 60 + Number(clock[2]);
  if (f.durationSec === undefined) {
    const hrs = take(state, new RegExp(`\\b${NUM}\\s*(?:hours?|hrs?)\\b`));
    const mins = take(state, new RegExp(`\\b${NUM}\\s*(?:minutes?|mins?)\\b`))
      || take(state, /\b(a|one) (?:minute|min)\b/);
    const secs = take(state, new RegExp(`\\b${NUM}\\s*(?:seconds?|secs?)\\b`));
    let total = 0;
    if (hrs) total += Number(hrs[1]) * 3600;
    if (mins) total += (Number.isNaN(Number(mins[1])) ? 1 : Number(mins[1])) * 60;
    if (secs) total += Number(secs[1]);
    if (hrs || mins || secs) f.durationSec = Math.round(total);
  }

  // Distance. Bare "m"/"k" only for genuine cardio, or nothing would be safe.
  const cardio = !exercise || kind === 'distance_duration';
  const units = cardio
    ? 'kilometers?|kilometres?|km|k|miles?|mi|meters?|metres?|m|yards?|yds?'
    : 'kilometers?|kilometres?|km|miles?|metres?|meters?';
  const dist = take(state, new RegExp(`\\b${NUM}\\s*(${units})\\b`));
  if (dist) {
    const key = dist[2].replace(/s$/, '');
    f.distanceM = Number(dist[1]) * (DISTANCE_UNITS[key] || DISTANCE_UNITS[dist[2]] || 1);
    f.distanceRaw = { value: Number(dist[1]), unit: dist[2] };
  }

  // Explicit weight with a unit.
  if (f.weight === undefined) {
    const w = take(state, new RegExp(`\\b${NUM}\\s*(lbs?|pounds?|kilograms?|kilos?|kgs?|kg)\\b`));
    if (w) {
      const isKg = /^k/.test(w[2]);
      f.weight = Number(w[1]);
      f.unit = isKg ? 'kg' : 'lb';
      f.weightSource = 'explicit';
    }
  }

  // "3 sets of 8" / "3 sets".
  const setsOf = take(state, new RegExp(`\\b${NUM}\\s*sets?\\s*(?:of|x|by)\\s*${NUM}\\b`));
  if (setsOf) {
    f.sets = Number(setsOf[1]);
    f.reps = Number(setsOf[2]);
  } else {
    const setsOnly = take(state, new RegExp(`\\b${NUM}\\s*sets?\\b`));
    if (setsOnly) f.sets = Number(setsOnly[1]);
  }

  // "225 x 5" (weight x reps) vs "5 x 5" (sets x reps).
  if (f.reps === undefined) {
    const cross = take(state, new RegExp(`\\b${NUM}\\s*(?:x|by)\\s*${NUM}\\b`));
    if (cross) {
      const a = Number(cross[1]); const b = Number(cross[2]);
      if (a > 25 && f.weight === undefined && kind !== 'bodyweight_reps') {
        f.weight = a;
        f.reps = b;
        f.weightSource = f.weightSource || 'cross';
      } else {
        if (f.sets === undefined) f.sets = a;
        f.reps = b;
      }
    }
  }

  // Reps.
  if (f.reps === undefined) {
    const reps = take(state, new RegExp(`\\b${NUM}\\s*reps?\\b`))
      || take(state, new RegExp(`\\bfor\\s*${NUM}\\b`));
    if (reps) f.reps = Number(reps[1]);
  }

  // Weight introduced by a preposition: "at 185", "with 60s".
  if (f.weight === undefined) {
    const w = take(state, new RegExp(`\\b(?:at|with|using|on|holding)\\s*${NUM}s?\\b`));
    if (w) {
      f.weight = Number(w[1]);
      f.weightSource = 'preposition';
    }
  }

  // Whatever numbers are left over.
  const leftovers = (state.text.match(/\b\d+(?:\.\d+)?\b/g) || []).map(Number);
  if (leftovers.length) {
    if (kind === 'duration' && f.durationSec === undefined) {
      f.durationSec = leftovers[0];
      f.guessed = true;
    } else if (kind === 'bodyweight_reps') {
      if (f.reps === undefined) {
        f.reps = leftovers[0];
        if (leftovers.length > 1) f.guessed = true;
      }
      if (f.weight === undefined && leftovers[1] !== undefined) {
        f.weight = leftovers[1];
        f.weightSource = 'guess';
        f.guessed = true;
      }
    } else if (f.weight === undefined && f.reps === undefined && leftovers.length >= 2) {
      const [hi, lo] = [...leftovers].sort((a, b) => b - a);
      f.weight = hi; f.reps = lo; f.guessed = true; f.weightSource = 'guess';
    } else if (f.weight === undefined && leftovers[0] >= 25) {
      f.weight = leftovers[0];
      f.weightSource = 'guess';
      if (f.reps === undefined || leftovers.length > 1) f.guessed = true;
    } else if (f.reps === undefined) {
      f.reps = leftovers[0];
      if (f.weight === undefined || leftovers.length > 1) f.guessed = true;
    }
  }

  if (f.unit === undefined && f.weight !== undefined) f.unit = opts.unitPref || 'lb';
  if (f.unit && opts.unitPref && f.unit !== opts.unitPref && f.weight !== undefined) {
    // Store in the user's unit so history stays comparable.
    f.weight = f.unit === 'kg'
      ? Math.round(f.weight * LB_PER_KG * 10) / 10
      : Math.round((f.weight / LB_PER_KG) * 10) / 10;
    f.unit = opts.unitPref;
    f.converted = true;
  }
  if (f.rpe !== undefined && f.rir === undefined) f.rir = Math.max(0, 10 - f.rpe);
  if (f.rir !== undefined && f.rpe === undefined) f.rpe = Math.max(0, 10 - f.rir);

  f.leftoverText = state.text.trim();
  return f;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function parseClause(clause, ctx) {
  const opts = { unitPref: ctx.unitPref || 'lb' };
  const numeric = wordsToNumbers(clause);

  const amend = AMEND_RE.exec(numeric);
  const body = amend ? numeric.slice(amend[0].length).trim() : numeric;

  if (!amend) {
    for (const { command, re } of COMMANDS) {
      const m = re.exec(body);
      if (!m) continue;
      const rest = body.slice(m[0].length).trim();
      if (command === 'rest') {
        const f = extractFields(rest, { kind: 'duration' }, opts);
        return { type: 'command', command, seconds: f.durationSec || 90, raw: clause };
      }
      if (command === 'note') return { type: 'command', command, text: rest, raw: clause };
      if (command === 'repeat') {
        const f = extractFields(rest, ctx.lastSet ? BY_ID.get(ctx.lastSet.exerciseId) : null, opts);
        return { type: 'command', command, overrides: f, raw: clause };
      }
      // A bare command word with numbers after it is probably a set, not a
      // command: "done 3 sets of 10".
      if (rest && /\d/.test(rest) && command !== 'undo') break;
      return { type: 'command', command, raw: clause };
    }
  }

  const match = matchExercise(body);
  let exercise = match ? match.exercise : null;
  let custom = null;

  const withoutName = match && match.exact
    ? body.replace(new RegExp(`\\b${match.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), ' ').replace(/\s+/g, ' ').trim()
    : body;

  if (!exercise) {
    const namePhrase = withoutName
      .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
      .replace(/\b(sets?|reps?|rpe|rir|x|by|at|with|for|of|the|a|an|on|and|then|pounds?|lbs?|kgs?|kilos?|seconds?|secs?|minutes?|mins?|plates?|each|side|hand|to|failure)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();

    if (amend || !namePhrase) {
      // Continuation: "185 for 8" right after a logged bench set.
      if (ctx.currentExerciseId) exercise = BY_ID.get(ctx.currentExerciseId) || null;
    } else if (/^[a-z][a-z '-]{1,39}$/.test(namePhrase) && namePhrase.split(' ').length <= 4) {
      custom = titleCase(namePhrase);
    } else if (ctx.currentExerciseId) {
      exercise = BY_ID.get(ctx.currentExerciseId) || null;
    }
  }

  const shape = exercise || (custom ? { kind: 'weight_reps', perSide: false } : null);

  // "add ten", "up five", "drop twenty" are relative to the set before them.
  // Resolve to an absolute load here, where the previous set is in scope, and
  // hand the rest of the pipeline an ordinary "at <weight>".
  let body2 = withoutName;
  const prevWeight = ctx.lastSet && ctx.lastSet.weight;
  const relative = /\b(?:add|up|plus|increase(?: by)?|drop|down|minus|reduce(?: by)?|take off)\s+(\d+(?:\.\d+)?)\b/.exec(body2);
  const relativeCap = opts.unitPref === 'kg' ? 50 : 100;
  if (relative && prevWeight !== undefined && Number(relative[1]) <= relativeCap) {
    const down = /^(?:drop|down|minus|reduce|take off)/.test(relative[0]);
    const value = Math.max(0, prevWeight + (down ? -1 : 1) * Number(relative[1]));
    body2 = `${body2.slice(0, relative.index)} at ${value} ${body2.slice(relative.index + relative[0].length)}`
      .replace(/\s+/g, ' ').trim();
  }

  const fields = extractFields(body2, shape, opts);

  const hasData = fields.reps !== undefined || fields.weight !== undefined
    || fields.durationSec !== undefined || fields.distanceM !== undefined;

  if (amend) {
    if (!hasData) return { type: 'unknown', reason: 'Nothing to correct in that.', raw: clause };
    return { type: 'command', command: 'amend', fields, exerciseId: exercise ? exercise.id : null, raw: clause };
  }

  if (!exercise && !custom) {
    return { type: 'unknown', reason: "Didn't catch which exercise that was.", raw: clause };
  }
  if (!hasData) {
    if (!exercise) {
      return { type: 'unknown', reason: `Didn't recognise "${custom}" as an exercise.`, raw: clause };
    }
    // "next up lat pulldown" — a valid way to switch exercises without logging.
    return {
      type: 'focus', exerciseId: exercise.id, exerciseName: exercise.name, custom: false, raw: clause,
    };
  }

  const kind = exercise ? exercise.kind : 'weight_reps';
  const warnings = [];
  let confidence = 1;

  if (!exercise) { confidence -= 0.35; warnings.push(`"${custom}" isn't in the exercise list yet — logged as a custom movement.`); }
  if (exercise && match && match.exact) {
    const stray = fields.leftoverText
      .replace(/\b(?:x|by|at|with|for|of|the|a|an|on|and|then|to|each|side|hand|per)\b/g, ' ')
      .replace(/[\d.]+/g, ' ')
      .trim();
    if (stray) {
      confidence -= 0.2;
      warnings.push(`Logged as ${exercise.name}; "${stray}" was ignored. Tap to fix if that was a different movement.`);
    }
  }
  if (match && !match.exact) confidence -= 0.25 * (1 - match.score);
  if (!match && exercise) confidence -= 0.12; // carried from context
  if (fields.guessed) confidence -= 0.12;
  if (kind === 'weight_reps' && fields.reps === undefined) { confidence -= 0.3; warnings.push('No rep count heard.'); }
  if (kind === 'weight_reps' && fields.weight === undefined && !fields.bodyweight) { confidence -= 0.3; warnings.push('No weight heard.'); }
  if (kind === 'distance_duration' && fields.distanceM === undefined && fields.durationSec === undefined) confidence -= 0.3;

  const perSide = fields.perSide !== undefined
    ? fields.perSide
    : Boolean(exercise && exercise.perSide && fields.weight !== undefined);

  return {
    type: 'set',
    confidence: Math.max(0.05, Math.round(confidence * 100) / 100),
    warnings,
    match: match ? { alias: match.alias, exact: match.exact, score: Math.round(match.score * 100) / 100 } : null,
    set: {
      exerciseId: exercise ? exercise.id : null,
      exerciseName: exercise ? exercise.name : custom,
      custom: !exercise,
      kind,
      sets: fields.sets || 1,
      reps: fields.reps,
      weight: fields.bodyweight ? undefined : fields.weight,
      unit: fields.weight !== undefined && !fields.bodyweight ? fields.unit : undefined,
      perSide,
      bodyweight: Boolean(fields.bodyweight) || (kind === 'bodyweight_reps' && fields.weight === undefined),
      rpe: fields.rpe,
      rir: fields.rir,
      warmup: fields.warmup || undefined,
      toFailure: fields.toFailure || undefined,
      durationSec: fields.durationSec,
      distanceM: fields.distanceM,
      raw: clause,
    },
  };
}

/**
 * Parse one utterance. Returns an array of results — one utterance can carry
 * several sets ("bench 185 for 8 then 185 for 6").
 *
 * ctx: { currentExerciseId, lastSet, unitPref }
 */
export function parseUtterance(input, ctx = {}) {
  const text = normalizeText(input);
  if (!text) return [{ type: 'unknown', reason: 'Nothing heard.', raw: String(input || '') }];

  // Split only when every piece carries a number, so "bench press, 185 for 8"
  // stays one clause but "185 for 8 then 185 for 6" becomes two.
  let clauses = [text];
  const pieces = text.split(/\s*(?:,|\bthen\b|\band then\b|\bafter that\b)\s*/).filter(Boolean);
  if (pieces.length > 1 && pieces.every((p) => /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(p))) {
    clauses = pieces;
  }

  const results = [];
  const running = { ...ctx };
  for (const clause of clauses) {
    const r = parseClause(clause, running);
    // A note is prose, not a command to be tidied — take it from what was
    // actually said, before filler-stripping touched it.
    if (r.type === 'command' && r.command === 'note') {
      const verbatim = /\b(?:note|add a note|remember)\b\s*(.+)$/i.exec(String(input || ''));
      if (verbatim) r.text = verbatim[1].trim().replace(/[.\s]+$/, '');
    }
    if (r.type === 'set') {
      running.currentExerciseId = r.set.exerciseId || running.currentExerciseId;
      running.lastSet = r.set;
    } else if (r.type === 'focus' && r.exerciseId) {
      running.currentExerciseId = r.exerciseId;
    }
    results.push(r);
  }
  return results;
}
