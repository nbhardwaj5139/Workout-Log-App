import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneticKey, phoneticSimilarity, snapToNumberWord } from '../js/phonetic.js';

test('words that sound the same key the same', () => {
  for (const [a, b] of [
    ['bench', 'bensch'], ['bench', 'bentch'], ['squat', 'squatt'],
    ['press', 'pres'], ['curl', 'curll'], ['row', 'rowe'],
  ]) {
    assert.equal(phoneticKey(a), phoneticKey(b), `${a} vs ${b}`);
  }
});

test('words that sound different do not collide', () => {
  assert.notEqual(phoneticKey('curl'), phoneticKey('hurl'));
  assert.notEqual(phoneticKey('squat'), phoneticKey('press'));
  assert.notEqual(phoneticKey('row'), phoneticKey('dip'));
});

test('similarity is high for mishearings, low for unrelated words', () => {
  assert.ok(phoneticSimilarity('bensch', 'bench') >= 0.8);
  assert.ok(phoneticSimilarity('deadlift', 'dedlift') >= 0.8);
  assert.ok(phoneticSimilarity('squat', 'deadlift') < 0.4);
});

test('fumbled number words snap back', () => {
  assert.equal(snapToNumberWord('fife'), 'five');
  assert.equal(snapToNumberWord('sevin'), 'seven');
  assert.equal(snapToNumberWord('nien'), 'nine');
  assert.equal(snapToNumberWord('tenn'), 'ten');
  // "ate"/"eight" are homophones whose vowels differ, which this key drops;
  // that pair is handled by the explicit list in repair.js instead.
});

test('real words are not dragged into being numbers', () => {
  for (const w of ['bench', 'press', 'squat', 'reps', 'pounds', 'failure']) {
    assert.equal(snapToNumberWord(w), null, w);
  }
});

test('grammar words are protected even when they sound like numbers', () => {
  // "for" and "four" are phonetically identical; "for 8" must survive.
  assert.equal(phoneticKey('for'), phoneticKey('four'));
  assert.equal(snapToNumberWord('for'), null);
  assert.equal(snapToNumberWord('to'), null);
  assert.equal(snapToNumberWord('at'), null);
});
