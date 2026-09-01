import test from 'node:test';
import assert from 'node:assert/strict';
import { repair, candidates, bestReading } from '../js/repair.js';
import { parseUtterance } from '../js/parser.js';

const parse = (t) => parseUtterance(t, { unitPref: 'lb' });

test('the mishearings that actually happen', () => {
  assert.equal(repair('bench press 185 fiber wraps'), 'bench press 185 five reps');
  assert.equal(repair('squad 225 for ate reps'), 'squat 225 for eight reps');
  assert.equal(repair('185 for sex reps'), '185 for six reps');
  assert.equal(repair('dumbbell girl 30 for 12'), 'dumbbell curl 30 for 12');
  assert.equal(repair('deadlift 315 for tree reps'), 'deadlift 315 for three reps');
});

test('load-bearing words are never rewritten', () => {
  // "for" and "to" carry meaning in "for 8" and "to failure".
  assert.match(repair('bench 185 for 8'), /for 8/);
  assert.match(repair('bench 185 for 5 to failure'), /to failure/);
});

test('"fiber wraps" parses as five reps end to end', () => {
  const best = bestReading('bench press 185 fiber wraps', [], parse);
  const set = best.results[0].set;
  assert.equal(set.exerciseId, 'barbell-bench-press');
  assert.equal(set.weight, 185);
  assert.equal(set.reps, 5);
});

test('a recogniser alternative can win over the top result', () => {
  // Top result is mush; the second alternative is the real sentence.
  const best = bestReading('bench dress won ate five for ate', ['bench press 185 for 8'], parse);
  assert.equal(best.results[0].set.reps, 8);
  assert.equal(best.results[0].set.weight, 185);
});

test('a good transcript is left alone', () => {
  const best = bestReading('bench press 185 for 8', [], parse);
  assert.equal(best.text, 'bench press 185 for 8');
  assert.equal(best.results[0].set.reps, 8);
});

test('repair can only win by being strictly better', () => {
  // Nothing to fix here — the original must survive as the chosen reading.
  for (const clean of ['squat 225 for 5', 'three sets of ten on lat pulldown at 120', '185 for 8']) {
    assert.equal(bestReading(clean, [], parse).text, clean, clean);
  }
});

test('candidates are de-duplicated and ordered original-first', () => {
  const c = candidates('bench 185 for 8', ['bench 185 for 8']);
  assert.equal(c[0], 'bench 185 for 8');
  assert.equal(new Set(c).size, c.length);
});
