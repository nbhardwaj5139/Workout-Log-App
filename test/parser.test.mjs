import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUtterance, wordsToNumbers, matchExercise, normalizeText } from '../js/parser.js';

const one = (text, ctx = {}) => parseUtterance(text, { unitPref: 'lb', ...ctx })[0];
const set = (text, ctx) => {
  const r = one(text, ctx);
  assert.equal(r.type, 'set', `expected a set from "${text}", got ${r.type} (${r.reason || ''})`);
  return r.set;
};

test('spoken numbers become digits', () => {
  assert.equal(wordsToNumbers('two twenty five'), '225');
  assert.equal(wordsToNumbers('one thirty five'), '135');
  assert.equal(wordsToNumbers('three fifteen'), '315');
  assert.equal(wordsToNumbers('four oh five'), '405');
  assert.equal(wordsToNumbers('a hundred and eighty five'), '185');
  assert.equal(wordsToNumbers('twenty five'), '25');
  assert.equal(wordsToNumbers('eight'), '8');
  assert.equal(wordsToNumbers('three sets of eight'), '3 sets of 8');
  assert.equal(wordsToNumbers('two and a half'), '2.5');
});

test('filler and lead-ins are stripped', () => {
  assert.equal(normalizeText('umm okay log bench press 185'), 'bench press 185');
  assert.equal(normalizeText('I did squats 225'), 'squats 225');
});

test('exercise aliases resolve, longest first', () => {
  assert.equal(matchExercise('bench press 185').exercise.id, 'barbell-bench-press');
  assert.equal(matchExercise('incline bench 155').exercise.id, 'incline-barbell-press');
  assert.equal(matchExercise('lat pull down 120').exercise.id, 'lat-pulldown');
  assert.equal(matchExercise('rdl 185').exercise.id, 'romanian-deadlift');
});

test('fuzzy matching survives a misheard word', () => {
  const m = matchExercise('barbel row 135');
  assert.equal(m.exercise.id, 'barbell-row');
  assert.ok(m.score >= 0.72);
});

test('a plain set', () => {
  const s = set('bench press 185 for 8');
  assert.equal(s.exerciseId, 'barbell-bench-press');
  assert.equal(s.weight, 185);
  assert.equal(s.reps, 8);
  assert.equal(s.sets, 1);
});

test('sets x reps at a weight', () => {
  const s = set('three sets of ten on lat pulldown at 120');
  assert.equal(s.exerciseId, 'lat-pulldown');
  assert.equal(s.sets, 3);
  assert.equal(s.reps, 10);
  assert.equal(s.weight, 120);
});

test('weight x reps is told apart from sets x reps', () => {
  assert.equal(set('deadlift 315 x 3').weight, 315);
  assert.equal(set('deadlift 315 x 3').reps, 3);
  const five = set('bench 5 by 5 at 185');
  assert.equal(five.sets, 5);
  assert.equal(five.reps, 5);
  assert.equal(five.weight, 185);
});

test('plate maths', () => {
  assert.equal(set('squat two plates for five').weight, 225);
  assert.equal(set('squat a plate for ten').weight, 135);
  assert.equal(set('deadlift four plates for 2').weight, 405);
});

test('RPE and RIR both fill each other in', () => {
  const a = set('bench 225 for 5 at rpe 8');
  assert.equal(a.rpe, 8);
  assert.equal(a.rir, 2);
  const b = set('bench 225 for 5 with 2 in the tank');
  assert.equal(b.rir, 2);
  assert.equal(b.rpe, 8);
  assert.equal(set('bench 225 for 5 to failure').rir, 0);
});

test('the exercise carries over between utterances', () => {
  const s = set('185 for 8', { currentExerciseId: 'barbell-bench-press' });
  assert.equal(s.exerciseId, 'barbell-bench-press');
  assert.equal(s.weight, 185);
  assert.equal(s.reps, 8);
});

test('bodyweight and per-hand loads', () => {
  const pull = set('pull ups bodyweight 12');
  assert.equal(pull.exerciseId, 'pull-up');
  assert.equal(pull.reps, 12);
  assert.equal(pull.bodyweight, true);

  const db = set('incline dumbbell press 60s for 10 each hand');
  assert.equal(db.weight, 60);
  assert.equal(db.perSide, true);
});

test('timed and cardio work', () => {
  const plank = set('plank for a minute');
  assert.equal(plank.durationSec, 60);
  const run = set('run five k in twenty eight minutes');
  assert.equal(run.distanceM, 5000);
  assert.equal(run.durationSec, 1680);
});

test('kg input is converted to the tracked unit', () => {
  const s = set('bench press 100 kg for 5', { unitPref: 'lb' });
  assert.ok(Math.abs(s.weight - 220.5) < 0.6, `got ${s.weight}`);
  assert.equal(s.unit, 'lb');
});

test('several sets in one breath', () => {
  const rs = parseUtterance('bench 185 for 8 then 185 for 6 then 185 for 5', { unitPref: 'lb' });
  assert.equal(rs.length, 3);
  assert.deepEqual(rs.map((r) => r.set.reps), [8, 6, 5]);
  assert.ok(rs.every((r) => r.set.exerciseId === 'barbell-bench-press'));
});

test('a comma does not split a name off its numbers', () => {
  const rs = parseUtterance('bench press, 185 for 8', { unitPref: 'lb' });
  assert.equal(rs.length, 1);
  assert.equal(rs[0].set.weight, 185);
});

test('commands', () => {
  assert.equal(one('undo').command, 'undo');
  assert.equal(one('scratch that').command, 'undo');
  assert.equal(one('rest ninety seconds').seconds, 90);
  assert.equal(one('finish workout').command, 'finish');
  assert.equal(one("what's next").command, 'coach');
  assert.equal(one('same again').command, 'repeat');
  assert.equal(one('note left shoulder felt tight').text, 'left shoulder felt tight');
});

test('corrections amend the previous set', () => {
  const r = one('make that one ninety five', { currentExerciseId: 'barbell-bench-press' });
  assert.equal(r.command, 'amend');
  assert.equal(r.fields.weight, 195);
});

test('naming a lift with no numbers switches focus rather than logging', () => {
  const r = one('next up lat pulldown');
  assert.equal(r.type, 'focus');
  assert.equal(r.exerciseId, 'lat-pulldown');
});

test('an unknown movement is kept as a custom entry, not dropped', () => {
  const s = set('landmine press 95 for 8');
  assert.equal(s.custom, true);
  assert.equal(s.exerciseName, 'Landmine Press');
  assert.equal(s.weight, 95);
});

test('gibberish is rejected rather than guessed at', () => {
  const r = one('mmm hmm what');
  assert.equal(r.type, 'unknown');
  assert.ok(r.reason);
});

test('an alias hit with an unexplained modifier is flagged, not trusted', () => {
  const r = one('jefferson curl 95 for 8');
  assert.equal(r.type, 'set');
  assert.ok(r.warnings.length, 'expected a warning about the ignored word');
  assert.ok(r.confidence < 0.85, `confidence was ${r.confidence}`);
});

test('confidence drops when a field is missing', () => {
  const full = one('bench press 185 for 8');
  const partial = one('bench press 185');
  assert.ok(full.confidence > partial.confidence);
});

test('word order does not matter — exercise, weight and reps in any position', () => {
  const expect = (text, exerciseId, weight, reps) => {
    const r = parseUtterance(text, { unitPref: 'lb' })[0];
    assert.equal(r.type, 'set', `"${text}" did not parse as a set`);
    assert.equal(r.set.exerciseId, exerciseId, `"${text}" → wrong exercise`);
    assert.equal(r.set.weight, weight, `"${text}" → wrong weight`);
    assert.equal(r.set.reps, reps, `"${text}" → wrong reps`);
  };

  // Exercise first, last, and in the middle; weight before and after reps.
  expect('bench press 185 for 8', 'barbell-bench-press', 185, 8);
  expect('185 for 8 bench press', 'barbell-bench-press', 185, 8);
  expect('8 reps of bench press at 185', 'barbell-bench-press', 185, 8);
  expect('bench press for 8 at 185', 'barbell-bench-press', 185, 8);
  expect('at 185 bench press 8 reps', 'barbell-bench-press', 185, 8);
  expect('8 reps bench press 185', 'barbell-bench-press', 185, 8);
  expect('185 pounds bench press 8 reps', 'barbell-bench-press', 185, 8);
  expect('bench press 8 reps 185 pounds', 'barbell-bench-press', 185, 8);
  expect('for 8 reps at 185 on bench press', 'barbell-bench-press', 185, 8);
  expect('squat 5 reps 225', 'back-squat', 225, 5);
  expect('225 squat 5', 'back-squat', 225, 5);
  expect('5 at 225 squat', 'back-squat', 225, 5);
  expect('did 8 at 185 on the bench', 'barbell-bench-press', 185, 8);
  expect('120 for 10 lat pulldown', 'lat-pulldown', 120, 10);
  expect('lat pulldown 10 reps 120 pounds', 'lat-pulldown', 120, 10);
});
