/**
 * Local-first persistence.
 *
 * Everything lives in localStorage on the device. No account, no server.
 * The trade-off is that clearing site data clears the log, so export matters.
 */

import { setVolume, sessionTotals, dayKey } from './totals.js';

const KEY = 'voicelift.v1';

export const DEFAULT_SETTINGS = {
  unit: 'lb',
  speak: true,
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const blank = () => ({ version: 2, settings: { ...DEFAULT_SETTINGS }, sessions: [] });

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

// --- mutations, none in place -------------------------------------------

export function startSession(state, at = new Date()) {
  const session = {
    id: uid(),
    date: at.toISOString(),
    startedAt: at.toISOString(),
    endedAt: null,
    sets: [],
  };
  return { state: { ...state, sessions: [...state.sessions, session] }, session };
}

export const currentSession = (state) => state.sessions.find((s) => !s.endedAt) || null;

export function ensureSession(state) {
  const open = currentSession(state);
  return open ? { state, session: open } : startSession(state);
}

const mapSession = (state, id, fn) => ({
  ...state,
  sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)),
});

export function addSet(state, sessionId, set) {
  const row = { id: uid(), ts: new Date().toISOString(), source: 'voice', ...set };
  return {
    state: mapSession(state, sessionId, (s) => ({ ...s, sets: [...s.sets, row] })),
    set: row,
  };
}

export const updateSet = (state, sessionId, setId, patch) => mapSession(state, sessionId, (s) => ({
  ...s,
  sets: s.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)),
}));

export const deleteSet = (state, sessionId, setId) => mapSession(state, sessionId, (s) => ({
  ...s,
  sets: s.sets.filter((x) => x.id !== setId),
}));

export function endSession(state, sessionId, at = new Date()) {
  const next = mapSession(state, sessionId, (s) => ({ ...s, endedAt: at.toISOString() }));
  return { ...next, sessions: next.sessions.filter((s) => s.sets.length || !s.endedAt) };
}

export const updateSettings = (state, patch) => ({
  ...state,
  settings: { ...state.settings, ...patch },
});

// --- export ---------------------------------------------------------------

const CSV_COLUMNS = [
  'date', 'time', 'session_id', 'exercise', 'exercise_id', 'sets', 'reps',
  'weight', 'unit', 'per_side', 'bodyweight_only', 'rpe',
  'duration_sec', 'distance_m', 'volume', 'source', 'transcript',
];

const csvCell = (v) => {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The data sheet: one row per logged entry, opens in Excel or Sheets. */
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
        set.durationSec ?? '',
        set.distanceM ? Math.round(set.distanceM) : '',
        Math.round(setVolume(set)) || '',
        set.source || '',
        set.raw || '',
      ].map(csvCell).join(','));
    }
  }
  return rows.join('\n');
}

/** One row per workout. */
export function toSessionCSV(state) {
  const cols = ['date', 'session_id', 'exercises', 'sets', 'reps', 'volume', 'minutes'];
  const rows = [cols.join(',')];
  for (const s of [...state.sessions].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    const t = sessionTotals(s);
    const mins = s.endedAt
      ? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000)
      : '';
    rows.push([dayKey(s.date), s.id, t.exercises, t.hardSets, t.reps, t.volume, mins]
      .map(csvCell).join(','));
  }
  return rows.join('\n');
}

export const toJSON = (state) => JSON.stringify(state, null, 2);

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('Not a VoiceLift export');
  return { ...blank(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) } };
}

export function clearAll() {
  localStorage.removeItem(KEY);
  return blank();
}
