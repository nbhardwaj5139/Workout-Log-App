/**
 * The only maths the log needs: how much was moved.
 *
 * Deliberately small. Anything that tries to interpret your training —
 * predicted maxes, calorie models, readiness scores — is a guess dressed up
 * as a number, and it belongs somewhere other than the place you record what
 * actually happened.
 */

/** Load moved by one rep, in the tracked unit. Dumbbells count both hands. */
export function effectiveLoad(set) {
  return (set.weight || 0) * (set.perSide ? 2 : 1);
}

/** Weight x reps for one logged entry (which may stand for several sets). */
export function setVolume(set) {
  if (!set.reps || !set.weight) return 0;
  return effectiveLoad(set) * set.reps * (set.sets || 1);
}

export function sessionTotals(session) {
  const sets = session.sets || [];
  return {
    entries: sets.length,
    hardSets: sets.reduce((n, s) => n + (s.sets || 1), 0),
    reps: sets.reduce((n, s) => n + (s.reps || 0) * (s.sets || 1), 0),
    volume: Math.round(sets.reduce((n, s) => n + setVolume(s), 0)),
    exercises: new Set(sets.map((s) => s.exerciseId || s.exerciseName)).size,
  };
}

export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function groupConsecutive(sets) {
  const groups = [];
  for (const set of sets) {
    const key = set.exerciseId || set.exerciseName;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sets.push(set);
    else groups.push({ key, name: set.exerciseName, sets: [set] });
  }
  return groups;
}
