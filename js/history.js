/**
 * Reading the log back.
 *
 * People open a training log to read the last entry far more often than to
 * write a new one. Everything here answers "what did I do last time", which is
 * recall from the user's own data — no prediction, no advice.
 */

import { groupConsecutive } from './totals.js';

/** The most recent finished session containing this exercise. */
export function lastSessionFor(sessions, exerciseKey, excludeSessionId = null) {
  const candidates = sessions
    .filter((s) => s.id !== excludeSessionId
      && s.sets.some((x) => (x.exerciseId || x.exerciseName) === exerciseKey))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!candidates.length) return null;

  const session = candidates[0];
  return {
    date: session.date,
    sets: session.sets.filter((x) => (x.exerciseId || x.exerciseName) === exerciseKey),
  };
}

const fmtNum = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/** "185×8, 185×8, 185×7" — collapsed when every set is identical. */
export function formatSets(sets) {
  if (!sets || !sets.length) return '';
  const parts = sets.map((s) => {
    const load = s.weight !== undefined ? fmtNum(s.weight) : (s.bodyweight ? 'BW' : '');
    if (s.durationSec && !s.reps) return `${s.durationSec}s`;
    if (!s.reps) return load || '—';
    const one = load ? `${load}×${s.reps}` : `${s.reps}`;
    return (s.sets || 1) > 1 ? `${s.sets}×(${one})` : one;
  });
  const unique = [...new Set(parts)];
  return unique.length === 1 && parts.length > 1
    ? `${parts.length}× ${unique[0]}`
    : parts.join(', ');
}

/** Days since a date, as words a person would use. */
export function whenAgo(date, now = new Date()) {
  const days = Math.floor((now - new Date(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** One line for under an exercise heading. */
export function lastTimeLine(sessions, exerciseKey, excludeSessionId = null, now = new Date()) {
  const last = lastSessionFor(sessions, exerciseKey, excludeSessionId);
  if (!last) return null;
  return { text: `${whenAgo(last.date, now)} · ${formatSets(last.sets)}`, ...last };
}

/**
 * Exercises worth offering as one-tap chips: most recently used first, since
 * what you did last session is overwhelmingly what you are about to do.
 */
export function recentExercises(sessions, limit = 8) {
  const seen = new Map();
  const ordered = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const session of ordered) {
    for (const g of groupConsecutive(session.sets)) {
      if (!seen.has(g.key)) {
        seen.set(g.key, { key: g.key, name: g.name, date: session.date });
      }
    }
    if (seen.size >= limit) break;
  }
  return [...seen.values()].slice(0, limit);
}

/**
 * The set to stage next for an exercise: what you did most recently, in this
 * session if you have already worked it, otherwise from last time.
 */
export function stageNext(sessions, currentSession, exerciseKey) {
  const inSession = (currentSession?.sets || [])
    .filter((x) => (x.exerciseId || x.exerciseName) === exerciseKey);
  const source = inSession.length
    ? inSession[inSession.length - 1]
    : (lastSessionFor(sessions, exerciseKey, currentSession?.id)?.sets.slice(-1)[0] ?? null);
  if (!source) return null;

  return {
    exerciseId: source.exerciseId,
    exerciseName: source.exerciseName,
    kind: source.kind,
    weight: source.weight,
    reps: source.reps,
    durationSec: source.durationSec,
    perSide: source.perSide,
    bodyweight: source.bodyweight,
    unit: source.unit,
    fromThisSession: inSession.length > 0,
  };
}
