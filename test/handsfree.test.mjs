import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWake, routeUtterance, ARM_WINDOW_MS } from '../js/handsfree.js';

test('wake phrase with the set in the same breath', () => {
  const w = detectWake('log it bench press 185 for 8');
  assert.equal(w.matched, true);
  assert.equal(w.rest, 'bench press 185 for 8');
});

test('longest wake phrase wins over the bare one', () => {
  assert.equal(detectWake('log it 185 for 8').phrase, 'log it');
  assert.equal(detectWake('log 185 for 8').phrase, 'log');
});

test('punctuation from the recogniser does not break the match', () => {
  const w = detectWake('Log it, bench press 185 for 8.');
  assert.equal(w.matched, true);
  assert.equal(w.rest, 'bench press 185 for 8');
});

test('a wake phrase mid-sentence is not a wake — only the start counts', () => {
  assert.equal(detectWake('I need to log it later').matched, false);
});

test('bare wake phrase arms the window', () => {
  const r = routeUtterance('log it', { armedUntil: 0 }, 1000);
  assert.equal(r.action, 'arm');
});

test('the next utterance inside the window is logged', () => {
  const state = { armedUntil: 1000 + ARM_WINDOW_MS };
  const r = routeUtterance('185 for 8', state, 3000);
  assert.equal(r.action, 'log');
  assert.equal(r.text, '185 for 8');
});

test('the same utterance after the window closes is ignored', () => {
  const state = { armedUntil: 1000 + ARM_WINDOW_MS };
  const r = routeUtterance('185 for 8', state, 1000 + ARM_WINDOW_MS + 1);
  assert.equal(r.action, 'ignore');
});

test('conversation and song lyrics are ignored when not armed', () => {
  for (const noise of [
    'are you using this bench',
    'so I told him it was fine',
    'never gonna give you up',
    'yeah man that set was heavy',
  ]) {
    assert.equal(routeUtterance(noise, { armedUntil: 0 }, 5000).action, 'ignore', noise);
  }
});

test('wake and set in one breath does not need the window', () => {
  const r = routeUtterance('log that squat 225 for 5', { armedUntil: 0 }, 5000);
  assert.equal(r.action, 'log');
  assert.equal(r.text, 'squat 225 for 5');
});
