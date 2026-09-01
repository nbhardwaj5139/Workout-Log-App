/**
 * Everything numeric: estimated 1RM, tonnage, calories, PRs, trend series.
 *
 * All of it is estimation, and the app says so where it matters. The rep-max
 * formulas are only honest up to ~10 reps; the calorie number is a MET model,
 * not a measurement.
 */

import { getExercise } from './exercises.js';

export const LB_PER_KG = 2.20462;
export const toKg = (lb) => lb / LB_PER_KG;
export const toLb = (kg) => kg * LB_PER_KG;

/** Fraction of bodyweight actually moved, for tonnage on bodyweight lifts. */
const BW_FACTOR = {
  'pull-up': 1, dip: 1, 'inverted-row': 0.6, 'push-up': 0.64,
  'air-squat': 0.5, 'sit-up': 0.3, 'hanging-leg-raise': 0.45, burpee: 0.64,
};

export function bodyweightLoad(set, settings) {
  const bwLb = settings.unit === 'kg' ? toLb(settings.bodyweight) : settings.bodyweight;
  return (BW_FACTOR[set.exerciseId] ?? 0.65) * bwLb;
}

/** Load actually moved by one rep, in the user's unit. Dumbbells count both. */
export function effectiveLoad(set, settings) {
  const perSide = set.perSide ? 2 : 1;
  const external = (set.weight || 0) * perSide;
  if (set.kind === 'bodyweight_reps' || set.bodyweight) {
    return bodyweightLoad(set, settings) + external;
  }
  return external;
}

/** Tonnage for one logged entry (which may represent several identical sets). */
export function setVolume(set, settings) {
  if (!set.reps) return 0;
  return effectiveLoad(set, settings) * set.reps * (set.sets || 1);
}

/**
 * Estimated one-rep max. Averages Epley and Brzycki in the range where both
 * behave, and folds in reps-in-reserve when the lifter reported an RPE.
 * Returns null when the set can't support an estimate.
 */
export function estimate1RM(set, settings) {
  if (!set.reps || set.reps < 1) return null;
  const load = set.kind === 'bodyweight_reps' || set.bodyweight
    ? effectiveLoad(set, settings)
    : (set.weight || 0) * (set.perSide ? 1 : 1); // per-hand load is the tracked number
  if (!load) return null;

  // An RPE report is a statement about reps left in the tank; fold it in so
  // "185 x 8 at RPE 8" estimates higher than a grinding 185 x 8.
  const rir = set.rir ?? (set.rpe !== undefined ? Math.max(0, 10 - set.rpe) : 0);
  const reps = Math.min(set.reps + rir, 20);
  if (reps === 1) return { value: load, confidence: 'high', reps };

  const epley = load * (1 + reps / 30);
  const brzycki = reps < 37 ? load * (36 / (37 - reps)) : epley;
  const value = reps <= 10 ? (epley + brzycki) / 2 : epley;
  const confidence = reps <= 8 ? 'high' : reps <= 12 ? 'moderate' : 'low';
  return { value: Math.round(value * 10) / 10, confidence, reps };
}

export const e1rmValue = (set, settings) => {
  const e = estimate1RM(set, settings);
  return e ? e.value : null;
};

/** Load at a target rep count, back-calculated from an e1RM (Epley inverse). */
export const loadForReps = (e1rm, reps) => e1rm / (1 + reps / 30);

// ---------------------------------------------------------------------------
// Session-level numbers
// ---------------------------------------------------------------------------

/** Seconds of actual work in a set, used for the calorie model. */
function workSeconds(set) {
  if (set.durationSec) return set.durationSec * (set.sets || 1);
  if (set.reps) return set.reps * 3.5 * (set.sets || 1);
  return 30;
}

const RESTED_SECONDS_PER_SET = 90;
// Between sets you are standing, resetting, walking to the rack — the
// Compendium puts that band at MET 2.0-3.0, not lying still.
const REST_MET = 2.5;

/**
 * MET-based energy estimate:  kcal = MET x 3.5 x kg / 200 x minutes.
 * Working time uses the exercise's MET; rest between sets is counted at
 * MET 1.5 (standing around), which is why this lands well below the wild
 * numbers most trackers report.
 */
export function sessionCalories(session, settings) {
  const kg = settings.unit === 'kg' ? settings.bodyweight : toKg(settings.bodyweight);
  let work = 0;
  let workSec = 0;
  let restSec = 0;

  for (const set of session.sets) {
    const ex = getExercise(set.exerciseId);
    const met = ex ? ex.met : 5;
    const secs = workSeconds(set);
    work += (met * 3.5 * kg) / 200 * (secs / 60);
    workSec += secs;
    restSec += RESTED_SECONDS_PER_SET * (set.sets || 1);
  }

  const elapsed = session.endedAt && session.startedAt
    ? (new Date(session.endedAt) - new Date(session.startedAt)) / 1000
    : workSec + restSec;
  const idle = Math.max(0, Math.min(elapsed - workSec, 3 * 3600));
  const rest = (REST_MET * 3.5 * kg) / 200 * (idle / 60);

  return {
    kcal: Math.round(work + rest),
    workKcal: Math.round(work),
    restKcal: Math.round(rest),
    workMinutes: Math.round(workSec / 60),
    elapsedMinutes: Math.round(elapsed / 60),
  };
}

export function sessionStats(session, settings) {
  const sets = session.sets || [];
  const hardSets = sets.reduce((n, s) => n + (s.sets || 1), 0);
  const reps = sets.reduce((n, s) => n + (s.reps || 0) * (s.sets || 1), 0);
  const volume = sets.reduce((n, s) => n + setVolume(s, settings), 0);
  const distanceM = sets.reduce((n, s) => n + (s.distanceM || 0), 0);
  const cardioSec = sets.reduce((n, s) => n + (s.kind === 'distance_duration' ? (s.durationSec || 0) : 0), 0);

  const muscles = {};
  for (const s of sets) {
    const ex = getExercise(s.exerciseId);
    if (!ex) continue;
    for (const m of ex.primary) muscles[m] = (muscles[m] || 0) + (s.sets || 1);
    for (const m of ex.secondary) muscles[m] = (muscles[m] || 0) + 0.5 * (s.sets || 1);
  }

  return {
    hardSets,
    reps,
    volume: Math.round(volume),
    distanceM: Math.round(distanceM),
    cardioSec,
    exercises: new Set(sets.map((s) => s.exerciseId || s.exerciseName)).size,
    muscles,
    calories: sessionCalories(session, settings),
  };
}

// ---------------------------------------------------------------------------
// History queries
// ---------------------------------------------------------------------------

export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function setsFor(sessions, exerciseId) {
  const out = [];
  for (const s of sessions) {
    for (const set of s.sets) {
      if (set.exerciseId === exerciseId) out.push({ ...set, sessionId: s.id, date: s.date });
    }
  }
  return out.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/** Best working set per session for one exercise, ordered oldest first. */
export function e1rmSeries(sessions, exerciseId, settings) {
  const byDay = new Map();
  for (const set of setsFor(sessions, exerciseId)) {
    const v = e1rmValue(set, settings);
    if (v === null) continue;
    const k = dayKey(set.date);
    if (!byDay.has(k) || byDay.get(k).value < v) {
      byDay.set(k, { date: k, value: v, set });
    }
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function volumeSeries(sessions, exerciseId, settings) {
  const byDay = new Map();
  for (const s of sessions) {
    const rows = exerciseId ? s.sets.filter((x) => x.exerciseId === exerciseId) : s.sets;
    if (!rows.length) continue;
    const k = dayKey(s.date);
    const v = rows.reduce((n, x) => n + setVolume(x, settings), 0);
    byDay.set(k, { date: k, value: Math.round((byDay.get(k)?.value || 0) + v) });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function caloriesSeries(sessions, settings) {
  return sessions
    .map((s) => ({ date: dayKey(s.date), value: sessionCalories(s, settings).kcal }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const startOfWeek = (d) => {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7; // Monday-based
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
};

export function weeklyVolume(sessions, settings) {
  const byWeek = new Map();
  for (const s of sessions) {
    const k = startOfWeek(s.date);
    const stats = sessionStats(s, settings);
    const row = byWeek.get(k) || { week: k, volume: 0, sets: 0, sessions: 0, kcal: 0 };
    row.volume += stats.volume;
    row.sets += stats.hardSets;
    row.kcal += stats.calories.kcal;
    row.sessions += 1;
    byWeek.set(k, row);
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Acute:chronic workload ratio — this week's tonnage against the rolling
 * 4-week average. Sports-science convention flags >1.5 as a spike and <0.8
 * as detraining; it is a coarse signal, not a diagnosis.
 */
export function acwr(sessions, settings, now = new Date()) {
  const t = now.getTime();
  const inWindow = (s, days) => t - new Date(s.date).getTime() <= days * 86400000;
  const tonnage = (list) => list.reduce((n, s) => n + sessionStats(s, settings).volume, 0);

  const acute = tonnage(sessions.filter((s) => inWindow(s, 7)));
  const chronicTotal = tonnage(sessions.filter((s) => inWindow(s, 28)));
  const chronic = chronicTotal / 4;
  if (!chronic) return { acute, chronic, ratio: null };
  return { acute, chronic: Math.round(chronic), ratio: Math.round((acute / chronic) * 100) / 100 };
}

export function muscleWeeklySets(sessions, settings, days = 7, now = new Date()) {
  const out = {};
  for (const s of sessions) {
    if (now.getTime() - new Date(s.date).getTime() > days * 86400000) continue;
    const stats = sessionStats(s, settings);
    for (const [m, n] of Object.entries(stats.muscles)) out[m] = (out[m] || 0) + n;
  }
  return out;
}

export function personalRecords(sessions, settings) {
  const prs = new Map();
  for (const s of sessions) {
    for (const set of s.sets) {
      const key = set.exerciseId || set.exerciseName;
      if (!key) continue;
      const cur = prs.get(key) || {
        exerciseId: set.exerciseId,
        name: set.exerciseName,
        bestE1rm: null,
        heaviest: null,
        bestReps: null,
        longest: null,
        farthest: null,
      };
      const e = e1rmValue(set, settings);
      if (e !== null && (!cur.bestE1rm || e > cur.bestE1rm.value)) cur.bestE1rm = { value: e, date: s.date, set };
      if (set.weight && (!cur.heaviest || set.weight > cur.heaviest.value)) cur.heaviest = { value: set.weight, date: s.date, set };
      if (set.reps && (!cur.bestReps || set.reps > cur.bestReps.value)) cur.bestReps = { value: set.reps, date: s.date, set };
      if (set.durationSec && (!cur.longest || set.durationSec > cur.longest.value)) cur.longest = { value: set.durationSec, date: s.date, set };
      if (set.distanceM && (!cur.farthest || set.distanceM > cur.farthest.value)) cur.farthest = { value: set.distanceM, date: s.date, set };
      prs.set(key, cur);
    }
  }
  return prs;
}
