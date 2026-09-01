/**
 * Local-first persistence.
 *
 * Everything lives in localStorage on the device. No account, no server, no
 * third party gets your training log. The trade-off is that clearing site data
 * clears the log, so the app pushes CSV/JSON export hard.
 */

import { e1rmValue, setVolume, sessionStats, dayKey } from './analytics.js';

const KEY = 'voicelift.v1';

export const DEFAULT_SETTINGS = {
  unit: 'lb',
  bodyweight: 180,
  experience: 'intermediate',
  speak: true,
  autoRest: true,
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function blank() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, sessions: [] };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    return {
      ...blank(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (err) {
    console.warn('Could not read saved log, starting fresh:', err);
    return blank();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Could not save:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mutations — each returns the new state, none mutate in place
// ---------------------------------------------------------------------------

export function startSession(state, at = new Date()) {
  const session = {
    id: uid(),
    date: at.toISOString(),
    startedAt: at.toISOString(),
    endedAt: null,
    notes: '',
    sets: [],
  };
  return { state: { ...state, sessions: [...state.sessions, session] }, session };
}

export const currentSession = (state) => state.sessions.find((s) => !s.endedAt) || null;

export function ensureSession(state) {
  const open = currentSession(state);
  if (open) return { state, session: open };
  return startSession(state);
}

function mapSession(state, id, fn) {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) };
}

export function addSet(state, sessionId, set) {
  const row = { id: uid(), ts: new Date().toISOString(), source: 'voice', ...set };
  return {
    state: mapSession(state, sessionId, (s) => ({ ...s, sets: [...s.sets, row] })),
    set: row,
  };
}

export function updateSet(state, sessionId, setId, patch) {
  return mapSession(state, sessionId, (s) => ({
    ...s,
    sets: s.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)),
  }));
}

export function deleteSet(state, sessionId, setId) {
  return mapSession(state, sessionId, (s) => ({ ...s, sets: s.sets.filter((x) => x.id !== setId) }));
}

export function endSession(state, sessionId, at = new Date()) {
  const next = mapSession(state, sessionId, (s) => ({ ...s, endedAt: at.toISOString() }));
  // An empty session is noise in the history.
  return { ...next, sessions: next.sessions.filter((s) => s.sets.length || !s.endedAt) };
}

export function setNotes(state, sessionId, notes) {
  return mapSession(state, sessionId, (s) => ({ ...s, notes }));
}

export function updateSettings(state, patch) {
  return { ...state, settings: { ...state.settings, ...patch } };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'date', 'time', 'session_id', 'exercise', 'exercise_id', 'sets', 'reps',
  'weight', 'unit', 'per_side', 'bodyweight_only', 'rpe', 'rir',
  'duration_sec', 'distance_m', 'est_1rm', 'volume', 'source', 'transcript',
];

const csvCell = (v) => {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The "data sheet": one row per logged entry, openable in Excel or Sheets. */
export function toCSV(state) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const session of [...state.sessions].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    for (const set of session.sets) {
      const ts = new Date(set.ts || session.date);
      rows.push([
        dayKey(ts),
        ts.toTimeString().slice(0, 8),
        session.id,
        set.exerciseName,
        set.exerciseId || '',
        set.sets || 1,
        set.reps ?? '',
        set.weight ?? '',
        set.weight !== undefined ? (set.unit || state.settings.unit) : '',
        set.perSide ? 'yes' : '',
        set.bodyweight ? 'yes' : '',
        set.rpe ?? '',
        set.rir ?? '',
        set.durationSec ?? '',
        set.distanceM ? Math.round(set.distanceM) : '',
        e1rmValue(set, state.settings) ?? '',
        Math.round(setVolume(set, state.settings)) || '',
        set.source || '',
        set.raw || '',
      ].map(csvCell).join(','));
    }
  }
  return rows.join('\n');
}

/** Per-session summary sheet — one row per workout. */
export function toSessionCSV(state) {
  const cols = ['date', 'session_id', 'exercises', 'hard_sets', 'total_reps', 'volume', 'est_calories', 'work_min', 'elapsed_min', 'notes'];
  const rows = [cols.join(',')];
  for (const s of [...state.sessions].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    const st = sessionStats(s, state.settings);
    rows.push([
      dayKey(s.date), s.id, st.exercises, st.hardSets, st.reps, st.volume,
      st.calories.kcal, st.calories.workMinutes, st.calories.elapsedMinutes, s.notes || '',
    ].map(csvCell).join(','));
  }
  return rows.join('\n');
}

export const toJSON = (state) => JSON.stringify(state, null, 2);

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('Not a VoiceLift export');
  return {
    ...blank(),
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
  };
}

export function clearAll() {
  localStorage.removeItem(KEY);
  return blank();
}

// ---------------------------------------------------------------------------
// Sample data, so the charts have something to show on day one
// ---------------------------------------------------------------------------

export function sampleState(now = new Date()) {
  const state = blank();
  const plan = [
    { day: 42, ex: [['barbell-bench-press', 155, [8, 8, 7]], ['barbell-row', 135, [10, 10, 9]], ['dumbbell-curl', 25, [12, 12]]] },
    { day: 40, ex: [['back-squat', 205, [5, 5, 5]], ['romanian-deadlift', 155, [8, 8]], ['plank', null, [45, 45]]] },
    { day: 35, ex: [['barbell-bench-press', 160, [8, 8, 8]], ['lat-pulldown', 120, [10, 10, 10]], ['lateral-raise', 15, [15, 15]]] },
    { day: 33, ex: [['back-squat', 215, [5, 5, 5]], ['leg-press', 270, [10, 10]], ['run', null, [null]]] },
    { day: 28, ex: [['barbell-bench-press', 165, [8, 8, 7]], ['pull-up', null, [8, 7, 6]], ['tricep-pushdown', 50, [12, 12]]] },
    { day: 26, ex: [['deadlift', 275, [5, 5, 3]], ['walking-lunge', 35, [10, 10]]] },
    { day: 21, ex: [['barbell-bench-press', 170, [8, 8, 8]], ['barbell-row', 145, [10, 10, 10]], ['dumbbell-curl', 30, [10, 10]]] },
    { day: 19, ex: [['back-squat', 225, [5, 5, 5]], ['leg-curl', 90, [12, 12]], ['run', null, [null]]] },
    { day: 14, ex: [['barbell-bench-press', 175, [8, 7, 7]], ['overhead-press', 95, [8, 8]], ['face-pull', 40, [15, 15]]] },
    { day: 12, ex: [['deadlift', 295, [5, 4, 4]], ['hip-thrust', 185, [10, 10]]] },
    { day: 7, ex: [['barbell-bench-press', 180, [8, 8, 8]], ['pull-up', null, [9, 8, 7]], ['plank', null, [60, 60]]] },
    { day: 5, ex: [['back-squat', 235, [5, 5, 4]], ['leg-press', 320, [10, 10]], ['run', null, [null]]] },
    { day: 2, ex: [['barbell-bench-press', 185, [8, 8, 7]], ['barbell-row', 155, [10, 10, 9]], ['lateral-raise', 20, [15, 12]]] },
  ];

  for (const entry of plan) {
    const at = new Date(now.getTime() - entry.day * 86400000);
    at.setHours(18, 0, 0, 0);
    const session = {
      id: uid(),
      date: at.toISOString(),
      startedAt: at.toISOString(),
      endedAt: new Date(at.getTime() + 62 * 60000).toISOString(),
      notes: '',
      sets: [],
    };
    let offset = 0;
    for (const [exId, weight, values] of entry.ex) {
      for (const v of values) {
        offset += 4;
        const base = {
          id: uid(),
          ts: new Date(at.getTime() + offset * 60000).toISOString(),
          exerciseId: exId,
          exerciseName: exId.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()),
          sets: 1,
          source: 'sample',
          raw: '',
        };
        if (exId === 'run') {
          session.sets.push({ ...base, kind: 'distance_duration', distanceM: 4800, durationSec: 1680 });
        } else if (exId === 'plank') {
          session.sets.push({ ...base, kind: 'duration', durationSec: v });
        } else if (weight === null) {
          session.sets.push({ ...base, kind: 'bodyweight_reps', reps: v, bodyweight: true });
        } else {
          session.sets.push({
            ...base, kind: 'weight_reps', reps: v, weight, unit: 'lb', rpe: v <= 4 ? 9 : 8,
          });
        }
      }
    }
    state.sessions.push(session);
  }
  return state;
}
