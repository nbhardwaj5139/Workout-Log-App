import test from 'node:test';
import assert from 'node:assert/strict';
import { advise, reviewSet, sessionFlags, warmupRamp } from '../js/coach.js';

const settings = { unit: 'lb', bodyweight: 180 };
const NOW = new Date('2026-08-31T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

const session = (id, daysAgo, sets) => ({
  id, date: ago(daysAgo), startedAt: ago(daysAgo), endedAt: ago(daysAgo),
  sets: sets.map((s, i) => ({ id: `${id}-${i}`, kind: 'weight_reps', sets: 1, ...s })),
});
const bench = (weight, reps, rpe) => ({ exerciseId: 'barbell-bench-press', exerciseName: 'Barbell Bench Press', weight, reps, rpe });

test('a brand new lift gets a deliberately conservative start', () => {
  const empty = { id: 'now', date: ago(0), sets: [] };
  const a = advise({ exerciseId: 'back-squat', sessions: [empty], currentSession: empty, settings, now: NOW });
  assert.match(a.headline, /First time/);
  assert.ok(a.flags.some((f) => f.tag === 'novel'));
  assert.equal(a.target.weight, undefined);
});

test('hitting the top of the rep range earns one increment, never a leap', () => {
  const past = session('a', 7, [bench(185, 8, 8), bench(185, 8, 8)]);
  const cur = { id: 'now', date: ago(0), sets: [] };
  const a = advise({ exerciseId: 'barbell-bench-press', sessions: [past, cur], currentSession: cur, settings, now: NOW });
  assert.ok(a.target.weight > 185, 'should progress');
  assert.ok(a.target.weight <= 185 * 1.05, `jump too big: ${a.target.weight}`);
  assert.ok(a.warmup.length >= 2, 'a warm-up ramp should be offered');
});

test('missing the rep range takes weight off instead of adding it', () => {
  const past = session('a', 7, [bench(225, 3, 9)]);
  const cur = { id: 'now', date: ago(0), sets: [] };
  const a = advise({ exerciseId: 'barbell-bench-press', sessions: [past, cur], currentSession: cur, settings, now: NOW });
  assert.ok(a.target.weight < 225, `expected a back-off, got ${a.target.weight}`);
});

test('three flat sessions trigger a deload rather than another grind', () => {
  const past = [session('a', 21, [bench(200, 5, 9)]), session('b', 14, [bench(200, 5, 9)]), session('c', 7, [bench(200, 5, 9)])];
  const cur = { id: 'now', date: ago(0), sets: [] };
  const a = advise({ exerciseId: 'barbell-bench-press', sessions: [...past, cur], currentSession: cur, settings, now: NOW });
  assert.match(a.headline, /Deload/);
  assert.ok(a.target.weight < 200);
});

test('a long layoff starts lighter than where you left off', () => {
  const past = session('a', 40, [bench(225, 8, 7)]);
  const cur = { id: 'now', date: ago(0), sets: [] };
  const a = advise({ exerciseId: 'barbell-bench-press', sessions: [past, cur], currentSession: cur, settings, now: NOW });
  assert.ok(a.flags.some((f) => f.tag === 'layoff'));
  assert.ok(a.target.weight < 225);
});

test('mid-session fade recommends backing off, not pushing on', () => {
  const cur = {
    id: 'now',
    date: ago(0),
    sets: [
      { id: '1', kind: 'weight_reps', sets: 1, ...bench(225, 8, 8) },
      { id: '2', kind: 'weight_reps', sets: 1, ...bench(225, 4, 10) },
    ],
  };
  const a = advise({ exerciseId: 'barbell-bench-press', sessions: [cur], currentSession: cur, settings, now: NOW });
  assert.ok(a.target.weight < 225, `expected a drop, got ${a.target.weight}`);
  assert.ok(a.flags.some((f) => f.tag === 'fade' || f.tag === 'rpe'));
});

test('enough sets on a compound ends the exercise', () => {
  const sets = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, kind: 'weight_reps', sets: 1, ...bench(185, 8, 8) }));
  const cur = { id: 'now', date: ago(0), sets };
  const a = advise({ exerciseId: 'barbell-bench-press', sessions: [cur], currentSession: cur, settings, now: NOW });
  assert.match(a.headline, /Wrap up/);
  assert.equal(a.target, null);
});

test('a big load jump is flagged the moment it is logged', () => {
  const past = session('a', 7, [bench(185, 5, 8)]);
  const cur = { id: 'now', date: ago(0), sets: [] };
  const flags = reviewSet({ id: 'x', kind: 'weight_reps', sets: 1, ...bench(245, 5) }, {
    sessions: [past], currentSession: cur, settings,
  });
  const jump = flags.find((f) => f.tag === 'load-jump');
  assert.ok(jump, 'expected a load-jump flag');
  assert.equal(jump.level, 'stop');
});

test('a normal working weight is not flagged', () => {
  const past = session('a', 7, [bench(185, 5, 8)]);
  const cur = { id: 'now', date: ago(0), sets: [] };
  const flags = reviewSet({ id: 'x', kind: 'weight_reps', sets: 1, ...bench(190, 5) }, {
    sessions: [past], currentSession: cur, settings,
  });
  assert.equal(flags.length, 0);
});

test('losing reps at the same load is called out', () => {
  const cur = { id: 'now', date: ago(0), sets: [{ id: '1', kind: 'weight_reps', sets: 1, ...bench(185, 10, 8) }] };
  const flags = reviewSet({ id: '2', kind: 'weight_reps', sets: 1, ...bench(185, 6) }, {
    sessions: [], currentSession: cur, settings,
  });
  assert.ok(flags.some((f) => f.tag === 'rep-drop' || f.tag === 'fade'));
});

test('hitting the same muscle inside the recovery window warns', () => {
  const yesterday = session('a', 1, Array.from({ length: 9 }, () => bench(185, 8, 8)));
  const cur = { id: 'now', date: ago(0), sets: [{ id: '1', kind: 'weight_reps', sets: 1, ...bench(185, 8, 8) }] };
  const flags = sessionFlags({ sessions: [yesterday, cur], currentSession: cur, settings, now: NOW });
  assert.ok(flags.some((f) => f.tag === 'recovery'), JSON.stringify(flags.map((f) => f.tag)));
});

test('the warm-up ramp climbs to but never reaches the working weight', () => {
  const ramp = warmupRamp(225, { equipment: 'barbell', increment: 5 }, 'lb');
  assert.ok(ramp.length >= 3);
  assert.ok(ramp.every((r) => r.weight < 225));
  for (let i = 1; i < ramp.length; i += 1) assert.ok(ramp[i].weight > ramp[i - 1].weight);
});
