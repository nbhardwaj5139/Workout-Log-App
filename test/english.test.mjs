import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUtterance } from '../js/parser.js';
import { bestReading } from '../js/repair.js';

/**
 * The English this app has to understand, as a spec.
 *
 * Every line is something a person would plausibly say mid-workout. If a
 * phrasing shows up in real use and fails, it belongs here first and the fix
 * comes second.
 */
const BENCH = 'barbell-bench-press';
const SQUAT = 'back-squat';
const DL = 'deadlift';
const CURL = 'dumbbell-curl';

const CORPUS = [
  // --- plain -------------------------------------------------------------
  ['bench press 185 for 8', {e:BENCH,w:185,r:8}],
  ['bench 185 8 reps', {e:BENCH,w:185,r:8}],
  ['8 reps at 185 on bench', {e:BENCH,w:185,r:8}],
  ['185 for 8 on bench press', {e:BENCH,w:185,r:8}],
  // --- "times" as the multiplier ----------------------------------------
  ['bench press 185 times 8', {e:BENCH,w:185,r:8}],
  ['185 times 8 on bench', {e:BENCH,w:185,r:8}],
  ['I benched 185 eight times', {e:BENCH,w:185,r:8}],
  ['squat 225 five times', {e:SQUAT,w:225,r:5}],
  // --- "a set of" --------------------------------------------------------
  ['a set of 8 at 185 on bench', {e:BENCH,w:185,r:8}],
  ['just did a set of ten on bench at 185', {e:BENCH,w:185,r:10}],
  ['second set 185 for 8 bench', {e:BENCH,w:185,r:8}],
  // --- action verbs ------------------------------------------------------
  ['hit 185 for 8 on bench', {e:BENCH,w:185,r:8}],
  ['knocked out 8 at 185 on bench', {e:BENCH,w:185,r:8}],
  ['banged out 10 on bench at 135', {e:BENCH,w:135,r:10}],
  ['cranked out 12 curls at 30', {e:CURL,w:30,r:12}],
  ['I got 8 at 185 on bench', {e:BENCH,w:185,r:8}],
  ['managed 6 at 225 on squat', {e:SQUAT,w:225,r:6}],
  // --- exercise as a verb -------------------------------------------------
  ['benched 185 for 8', {e:BENCH,w:185,r:8}],
  ['squatted 225 for 5', {e:SQUAT,w:225,r:5}],
  ['deadlifted 315 for 3', {e:DL,w:315,r:3}],
  // --- trailing commentary -----------------------------------------------
  ['bench press 185 for 8 felt easy', {e:BENCH,w:185,r:8}],
  ['squat 225 for 5 that was heavy', {e:SQUAT,w:225,r:5}],
  ['185 for 8 nice', {e:BENCH,w:185,r:8}, {ctx:BENCH}],
  // --- failure / partials -------------------------------------------------
  ['only got 6', {r:6}, {ctx:BENCH}],
  ['failed at 6', {r:6}, {ctx:BENCH}],
  ['got 6 that time', {r:6}, {ctx:BENCH}],
  // --- warmups ------------------------------------------------------------
  ['warm up set 135 for 5 on bench', {e:BENCH,w:135,r:5,warmup:true}],
  ['warmup 95 for 10', {w:95,r:10,warmup:true}, {ctx:BENCH}],
  // --- relative load ------------------------------------------------------
  ['add ten for 8', {w:195,r:8}, {ctx:BENCH,last:{weight:185,reps:8}}],
  ['up five for 6', {w:190,r:6}, {ctx:BENCH,last:{weight:185,reps:8}}],
  ['drop twenty for 12', {w:165,r:12}, {ctx:BENCH,last:{weight:185,reps:8}}],
  ['went up to 205 for 3', {w:205,r:3}, {ctx:BENCH}],
  ['dropped to 135 for 12', {w:135,r:12}, {ctx:BENCH}],
  // --- switching exercise -------------------------------------------------
  ['moving to squats', {focus:SQUAT}],
  ['switch to squats', {focus:SQUAT}],
  ['now doing squats', {focus:SQUAT}],
  ['starting deadlifts', {focus:DL}],
  // --- already supported, guard against regressions -----------------------
  ['three sets of ten on lat pulldown at 120', {e:'lat-pulldown',w:120,r:10}],
  ['squat two plates for five', {e:SQUAT,w:225,r:5}],
  ['pull ups bodyweight 12', {e:'pull-up',r:12}],
  ['make that 195', {cmd:'amend'}, {ctx:BENCH}],
  ['same again', {cmd:'repeat'}, {ctx:BENCH}],
  ['undo', {cmd:'undo'}],
];

test('the ways people actually say a set', () => {
  const failures = [];

  for (const [text, want, opts = {}] of CORPUS) {
    const ctx = { unitPref: 'lb', currentExerciseId: opts.ctx, lastSet: opts.last };
    const best = bestReading(text, [], (t) => parseUtterance(t, ctx));
    const r = best.results[0];
    let ok = false;
    let got = '';

    if (want.cmd) {
      ok = r.type === 'command' && r.command === want.cmd;
      got = `${r.type}:${r.command || ''}`;
    } else if (want.focus) {
      ok = r.type === 'focus' && r.exerciseId === want.focus;
      got = `${r.type}:${r.exerciseId || ''}`;
    } else if (r.type === 'set') {
      const s = r.set;
      ok = (want.e === undefined || s.exerciseId === want.e)
        && (want.w === undefined || s.weight === want.w)
        && (want.r === undefined || s.reps === want.r)
        && (want.warmup === undefined || Boolean(s.warmup) === want.warmup);
      got = `${s.exerciseId} w=${s.weight} r=${s.reps}${s.warmup ? ' warmup' : ''}`;
    } else {
      got = `${r.type}: ${r.reason || ''}`;
    }

    if (!ok) failures.push(`  "${text}" -> ${got}`);
  }

  assert.equal(failures.length, 0, `${failures.length} of ${CORPUS.length} phrasings failed:\n${failures.join('\n')}`);
});
