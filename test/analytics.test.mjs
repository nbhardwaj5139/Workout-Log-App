import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/analytics.js';

const settings = { unit: 'lb', bodyweight: 180 };
const S = (o) => ({ kind: 'weight_reps', sets: 1, ...o });

test('a single is its own one-rep max', () => {
  assert.equal(A.estimate1RM(S({ weight: 315, reps: 1 }), settings).value, 315);
});

test('1RM estimate sits between Epley and Brzycki', () => {
  const e = A.estimate1RM(S({ weight: 225, reps: 5 }), settings);
  assert.ok(e.value > 225 && e.value < 275, `got ${e.value}`);
  assert.equal(e.confidence, 'high');
});

test('reps in reserve raise the estimate', () => {
  const grinder = A.estimate1RM(S({ weight: 225, reps: 5, rpe: 10 }), settings).value;
  const easy = A.estimate1RM(S({ weight: 225, reps: 5, rpe: 8 }), settings).value;
  assert.ok(easy > grinder);
});

test('high-rep estimates are marked unreliable', () => {
  assert.equal(A.estimate1RM(S({ weight: 95, reps: 20 }), settings).confidence, 'low');
});

test('dumbbell volume counts both hands', () => {
  const one = A.setVolume(S({ weight: 50, reps: 10 }), settings);
  const pair = A.setVolume(S({ weight: 50, reps: 10, perSide: true }), settings);
  assert.equal(pair, one * 2);
});

test('bodyweight lifts carry a share of bodyweight as load', () => {
  const v = A.setVolume(S({ kind: 'bodyweight_reps', exerciseId: 'pull-up', reps: 10, bodyweight: true }), settings);
  assert.equal(v, 1800); // 10 reps x full bodyweight
});

test('session stats add up', () => {
  const session = {
    id: 's', date: '2026-08-30T10:00:00Z',
    startedAt: '2026-08-30T10:00:00Z', endedAt: '2026-08-30T11:00:00Z',
    sets: [
      S({ exerciseId: 'barbell-bench-press', sets: 3, reps: 8, weight: 185 }),
      S({ exerciseId: 'dumbbell-curl', sets: 2, reps: 12, weight: 30, perSide: true }),
    ],
  };
  const st = A.sessionStats(session, settings);
  assert.equal(st.hardSets, 5);
  assert.equal(st.reps, 48);
  assert.equal(st.volume, 3 * 8 * 185 + 2 * 12 * 60);
  assert.ok(st.calories.kcal > 50 && st.calories.kcal < 600, `kcal ${st.calories.kcal}`);
  assert.equal(st.muscles.chest, 3);
});

test('acute:chronic ratio spots a spike', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  const mk = (daysAgo, weight) => ({
    id: `s${daysAgo}`,
    date: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
    sets: [S({ exerciseId: 'back-squat', sets: 5, reps: 5, weight })],
  });
  const steady = [mk(24, 200), mk(17, 200), mk(10, 200), mk(3, 200)];
  assert.ok(Math.abs(A.acwr(steady, settings, now).ratio - 1) < 0.35);

  const spiking = [mk(24, 100), mk(17, 100), mk(10, 100), mk(3, 400)];
  assert.ok(A.acwr(spiking, settings, now).ratio > 1.5);
});

test('e1RM series takes the best set of each day, oldest first', () => {
  const sessions = [
    { id: 'a', date: '2026-08-01T10:00:00Z', sets: [S({ exerciseId: 'deadlift', reps: 5, weight: 275 }), S({ exerciseId: 'deadlift', reps: 5, weight: 315 })] },
    { id: 'b', date: '2026-08-08T10:00:00Z', sets: [S({ exerciseId: 'deadlift', reps: 5, weight: 325 })] },
  ];
  const series = A.e1rmSeries(sessions, 'deadlift', settings);
  assert.equal(series.length, 2);
  assert.equal(series[0].set.weight, 315);
  assert.ok(series[1].value > series[0].value);
});
