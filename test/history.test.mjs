import test from 'node:test';
import assert from 'node:assert/strict';
import { lastSessionFor, formatSets, whenAgo, recentExercises, stageNext } from '../js/history.js';

const NOW = new Date('2026-09-01T12:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const S = (o) => ({ kind: 'weight_reps', sets: 1, exerciseId: 'barbell-bench-press', exerciseName: 'Barbell Bench Press', ...o });

const sessions = [
  { id: 'a', date: ago(14), sets: [S({ weight: 175, reps: 8 }), S({ weight: 175, reps: 8 })] },
  { id: 'b', date: ago(7), sets: [S({ weight: 185, reps: 8 }), S({ weight: 185, reps: 8 }), S({ weight: 185, reps: 7 })] },
  { id: 'c', date: ago(3), sets: [S({ exerciseId: 'back-squat', exerciseName: 'Back Squat', weight: 225, reps: 5 })] },
];

test('finds the most recent session with that exercise', () => {
  const last = lastSessionFor(sessions, 'barbell-bench-press');
  assert.equal(last.sets.length, 3);
  assert.equal(last.sets[0].weight, 185);
});

test('an exercise never done returns nothing', () => {
  assert.equal(lastSessionFor(sessions, 'deadlift'), null);
});

test('sets read the way a lifter says them', () => {
  assert.equal(formatSets([S({ weight: 185, reps: 8 }), S({ weight: 185, reps: 7 })]), '185×8, 185×7');
  // Identical sets collapse rather than repeating themselves.
  assert.equal(formatSets([S({ weight: 185, reps: 8 }), S({ weight: 185, reps: 8 })]), '2× 185×8');
  assert.equal(formatSets([S({ bodyweight: true, weight: undefined, reps: 10 })]), 'BW×10');
});

test('elapsed time reads as words', () => {
  assert.equal(whenAgo(ago(0), NOW), 'today');
  assert.equal(whenAgo(ago(1), NOW), 'yesterday');
  assert.equal(whenAgo(ago(3), NOW), '3 days ago');
  assert.equal(whenAgo(ago(9), NOW), 'last week');
});

test('recent exercises are ordered by how recently they were used', () => {
  const recent = recentExercises(sessions);
  assert.equal(recent[0].key, 'back-squat');
  assert.equal(recent[1].key, 'barbell-bench-press');
});

test('the next set is staged from this session when it is in progress', () => {
  const current = { id: 'now', date: ago(0), sets: [S({ weight: 195, reps: 6 })] };
  const staged = stageNext([...sessions, current], current, 'barbell-bench-press');
  assert.equal(staged.weight, 195);
  assert.equal(staged.reps, 6);
  assert.equal(staged.fromThisSession, true);
});

test('and from last time when the exercise has not started yet', () => {
  const current = { id: 'now', date: ago(0), sets: [] };
  const staged = stageNext([...sessions, current], current, 'barbell-bench-press');
  assert.equal(staged.weight, 185);
  assert.equal(staged.reps, 7);
  assert.equal(staged.fromThisSession, false);
});
