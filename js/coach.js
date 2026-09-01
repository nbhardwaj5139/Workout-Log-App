/**
 * Coaching + safety engine.
 *
 * Two jobs:
 *   1. advise()  — what to load on the next set of the exercise in progress.
 *   2. reviewSet() / sessionFlags() — flag the things that get people hurt:
 *      load jumps, within-session performance collapse, stacked volume,
 *      no recovery between sessions.
 *
 * Every rule here is a rule of thumb from strength-training practice, not a
 * medical judgement, and each flag carries the reasoning so a lifter can
 * disagree with it. Nothing in this file should ever be read as clinical
 * advice; the UI says as much.
 */

import { getExercise } from './exercises.js';
import {
  e1rmValue, estimate1RM, setsFor, sessionStats, acwr, muscleWeeklySets,
  loadForReps, dayKey,
} from './analytics.js';

// Tunables, all in one place so they are easy to argue with.
export const RULES = {
  maxLoadJumpPct: 0.10,        // >10% heavier than recent best = flag
  dropOffPct: 0.075,           // 7.5% e1RM fade within a session = stop signal
  repDropForStop: 3,           // reps lost vs first working set at same load
  maxSetsPerExercise: 6,       // beyond this, returns diminish fast
  weeklySetsPerMuscleCap: 22,  // upper end of productive weekly volume
  recoveryHours: 48,           // per muscle group, for heavy work
  acwrSpike: 1.5,
  acwrLow: 0.8,
  stagnationSessions: 3,
  deloadFactor: 0.88,
};

const pct = (x) => `${Math.round(x * 100)}%`;

function increment(ex, unit) {
  if (!ex) return unit === 'kg' ? 2.5 : 5;
  if (unit === 'kg') return ex.increment >= 10 ? 5 : 2.5;
  return ex.increment;
}

function roundTo(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

const flag = (level, title, detail, tag) => ({ level, title, detail, tag });

// ---------------------------------------------------------------------------
// Per-set review — runs the moment a set is logged
// ---------------------------------------------------------------------------

/**
 * Look at a set that was just logged against this session and the history.
 * Returns flags ordered most serious first.
 */
export function reviewSet(set, { sessions, currentSession, settings }) {
  const flags = [];
  const ex = getExercise(set.exerciseId);
  const unit = settings.unit;
  const sessionSets = (currentSession.sets || []).filter((s) => s.exerciseId === set.exerciseId && s.id !== set.id);
  const history = setsFor(sessions, set.exerciseId);

  // --- Load jump against recent history -------------------------------
  if (set.weight && history.length) {
    const cutoff = Date.now() - 60 * 86400000;
    const recent = history.filter((h) => new Date(h.date).getTime() >= cutoff && h.weight);
    const bestRecent = recent.reduce((m, h) => Math.max(m, h.weight), 0);
    if (bestRecent && set.weight > bestRecent * (1 + RULES.maxLoadJumpPct)) {
      const jump = set.weight / bestRecent - 1;
      flags.push(flag(
        jump > 0.2 ? 'stop' : 'caution',
        `${pct(jump)} heavier than anything logged in 60 days`,
        `Your best recent ${ex ? ex.name : set.exerciseName} was ${bestRecent}${unit}. Jumping past ~10% at once is where form breaks down. If this is a deliberate PR attempt, use safeties or a spotter and keep it to a single.`,
        'load-jump',
      ));
    }
  }

  // --- Within-session fade --------------------------------------------
  if (sessionSets.length >= 1 && set.reps) {
    const priorE = sessionSets.map((s) => e1rmValue(s, settings)).filter((v) => v !== null);
    const thisE = e1rmValue(set, settings);
    const best = priorE.length ? Math.max(...priorE) : null;
    if (best && thisE !== null && thisE < best * (1 - RULES.dropOffPct)) {
      flags.push(flag(
        'caution',
        `Output down ${pct(1 - thisE / best)} from your best set today`,
        'That size of fade inside one exercise usually means the productive part is over. One more set at a lighter load, or move on — pushing through it buys fatigue, not progress.',
        'fade',
      ));
    }
    const sameLoad = sessionSets.filter((s) => s.weight === set.weight && s.reps);
    if (sameLoad.length) {
      const first = sameLoad[0].reps;
      if (first - set.reps >= RULES.repDropForStop) {
        flags.push(flag(
          'caution',
          `Reps at ${set.weight}${unit} fell from ${first} to ${set.reps}`,
          'Losing three or more reps at the same load is a clear fatigue signal. Drop the weight ~10% or call it for this movement.',
          'rep-drop',
        ));
      }
    }
  }

  // --- Effort reported --------------------------------------------------
  if (set.rpe !== undefined && set.rpe >= 9.5) {
    flags.push(flag(
      'caution',
      `RPE ${set.rpe} logged`,
      'Training to or past failure on compounds is expensive to recover from. Keep 1–2 reps in reserve on the remaining sets.',
      'rpe',
    ));
  }

  // --- Set count on this exercise --------------------------------------
  const doneSets = sessionSets.reduce((n, s) => n + (s.sets || 1), 0) + (set.sets || 1);
  if (ex && ex.compound && doneSets > RULES.maxSetsPerExercise) {
    flags.push(flag(
      'info',
      `${doneSets} sets of ${ex.name} today`,
      `Past about ${RULES.maxSetsPerExercise} hard sets on one compound, extra sets add fatigue faster than they add stimulus.`,
      'set-count',
    ));
  }

  // --- Novel max attempt ------------------------------------------------
  if (set.reps && set.reps <= 2 && history.length) {
    const bestE = history.reduce((m, h) => Math.max(m, e1rmValue(h, settings) || 0), 0);
    const thisE = e1rmValue(set, settings);
    if (bestE && thisE && thisE > bestE * 1.05) {
      flags.push(flag('info', 'That is a personal best', 'Logged as a PR. Bank it and stop there — chasing a second attempt on the same day is where most training injuries happen.', 'pr'));
    }
  }

  return flags.sort((a, b) => ({ stop: 0, caution: 1, info: 2 }[a.level] - { stop: 0, caution: 1, info: 2 }[b.level]));
}

// ---------------------------------------------------------------------------
// Session-wide flags
// ---------------------------------------------------------------------------

export function sessionFlags({ sessions, currentSession, settings, now = new Date() }) {
  const flags = [];
  const past = sessions.filter((s) => s.id !== currentSession.id);

  const ratio = acwr([...past, currentSession], settings, now);
  if (ratio.ratio !== null && past.length >= 6) {
    if (ratio.ratio > RULES.acwrSpike) {
      flags.push(flag(
        'caution',
        `This week's workload is ${ratio.ratio}x your 4-week average`,
        'Ramping total tonnage more than about 50% above your recent norm is the classic pattern behind overuse injuries. Hold volume flat next session.',
        'acwr-high',
      ));
    } else if (ratio.ratio < RULES.acwrLow) {
      flags.push(flag('info', `Workload is ${ratio.ratio}x your 4-week average`, 'You are training below your recent baseline. Fine if it is a deload; worth a nudge if it is drift.', 'acwr-low'));
    }
  }

  const weekly = muscleWeeklySets([...past, currentSession], settings, 7, now);
  for (const [muscle, sets] of Object.entries(weekly)) {
    if (sets > RULES.weeklySetsPerMuscleCap) {
      flags.push(flag('info', `${Math.round(sets)} weekly sets for ${muscle}`, `Most people stop gaining past roughly ${RULES.weeklySetsPerMuscleCap} hard sets per muscle per week, and joints feel it first. Consider trimming.`, 'weekly-volume'));
    }
  }

  // Same muscle group hammered inside the recovery window.
  const todayMuscles = new Set(Object.keys(sessionStats(currentSession, settings).muscles));
  for (const s of past) {
    const hours = (now - new Date(s.date)) / 3600000;
    if (hours <= 0 || hours > RULES.recoveryHours) continue;
    const stats = sessionStats(s, settings);
    for (const [m, n] of Object.entries(stats.muscles)) {
      if (n >= 8 && todayMuscles.has(m)) {
        flags.push(flag(
          'caution',
          `${m} trained ${Math.round(hours)}h ago`,
          `You put ${Math.round(n)} hard sets into ${m} on ${dayKey(s.date)}. Muscle typically needs ~${RULES.recoveryHours}h between heavy sessions; keep today's work lighter or pick another movement.`,
          'recovery',
        ));
      }
    }
  }

  const seen = new Set();
  return flags.filter((f) => {
    const k = `${f.tag}:${f.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Next-set recommendation
// ---------------------------------------------------------------------------

function lastSessionTopSet(sessions, exerciseId, settings, excludeSessionId) {
  const bySession = new Map();
  for (const s of sessions) {
    if (s.id === excludeSessionId) continue;
    const rows = s.sets.filter((x) => x.exerciseId === exerciseId);
    if (rows.length) bySession.set(s.id, { date: s.date, rows });
  }
  const ordered = [...bySession.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!ordered.length) return null;
  const last = ordered[0];
  const top = last.rows.reduce((best, r) => {
    const v = e1rmValue(r, settings);
    return !best || (v !== null && v > (e1rmValue(best, settings) || 0)) ? r : best;
  }, null);
  return { date: last.date, top, rows: last.rows, sessionsBack: ordered.length };
}

/** A warm-up ramp to a target working load. */
export function warmupRamp(target, ex, unit) {
  if (!target || target < 45) return [];
  const step = increment(ex, unit);
  const barbell = ex && ex.equipment === 'barbell';
  const empty = barbell ? (unit === 'kg' ? 20 : 45) : null;
  const ramp = [];
  if (empty && target > empty * 1.4) ramp.push({ weight: empty, reps: 8, note: 'empty bar' });
  for (const [f, reps] of [[0.55, 5], [0.7, 3], [0.85, 2]]) {
    const w = roundTo(target * f, step);
    if (w > (ramp.at(-1)?.weight || 0) && w < target) ramp.push({ weight: w, reps });
  }
  return ramp;
}

/**
 * What to do next on `exerciseId`.
 * Returns { headline, detail, target:{weight,reps,sets,unit}, restSec, warmup, flags, basis }
 */
export function advise({ exerciseId, sessions, currentSession, settings, now = new Date() }) {
  const ex = getExercise(exerciseId);
  const unit = settings.unit;
  const step = increment(ex, unit);
  const basis = [];
  const flags = [];

  const todaySets = (currentSession.sets || []).filter((s) => s.exerciseId === exerciseId);
  const past = sessions.filter((s) => s.id !== currentSession.id);
  const last = lastSessionTopSet(sessions, exerciseId, settings, currentSession.id);
  const repRange = ex ? ex.repRange : [8, 12];

  const restSec = ex && ex.compound
    ? (repRange[0] <= 5 ? 180 : 150)
    : 75;

  // --- No history anywhere --------------------------------------------
  if (!todaySets.length && !last) {
    return {
      headline: ex ? `First time logging ${ex.name}` : 'First time logging this',
      detail: `No history to work from, so start deliberately: pick a load you could do ${repRange[1] + 4} times, do ${repRange[1]} reps, and stop with 3–4 reps still in the tank. Today is for finding the groove and getting a number on the board — next session has something to build on.`,
      target: { reps: repRange[1], sets: 2, unit },
      restSec,
      warmup: [],
      flags: [flag('info', 'Unknown starting load', 'The first session of any new movement is the highest-risk one. Under-load it on purpose.', 'novel')],
      basis: ['no previous sets for this exercise'],
    };
  }

  // --- Mid-exercise: react to what has happened today -------------------
  if (todaySets.length) {
    const withE = todaySets.map((s) => ({ s, e: e1rmValue(s, settings) })).filter((r) => r.e !== null);
    const bestToday = withE.length ? Math.max(...withE.map((r) => r.e)) : null;
    const latest = todaySets[todaySets.length - 1];
    const latestE = e1rmValue(latest, settings);
    const doneSets = todaySets.reduce((n, s) => n + (s.sets || 1), 0);
    basis.push(`${doneSets} set${doneSets === 1 ? '' : 's'} logged today`);

    const faded = bestToday && latestE !== null && latestE < bestToday * (1 - RULES.dropOffPct);
    const maxed = latest.rpe !== undefined && latest.rpe >= 9.5;
    const enough = ex && ex.compound && doneSets >= RULES.maxSetsPerExercise;

    if (enough) {
      return {
        headline: `Wrap up ${ex.name}`,
        detail: `${doneSets} hard sets is a full dose for one compound. Anything more today mostly buys soreness. Move to the next movement.`,
        target: null,
        restSec,
        warmup: [],
        flags: [flag('info', 'Volume target met', `Past ~${RULES.maxSetsPerExercise} sets the stimulus-to-fatigue trade goes the wrong way.`, 'set-count')],
        basis,
      };
    }

    if (faded || maxed) {
      const backoff = latest.weight ? roundTo(latest.weight * 0.9, step) : null;
      return {
        headline: backoff ? `Drop to ${backoff}${unit}` : 'Back off the intensity',
        detail: faded
          ? `Your last set came in about ${pct(1 - latestE / bestToday)} below your best today. Take ~10% off and get quality reps, or finish here. Grinding a fading set is the classic way to tweak something.`
          : `You reported RPE ${latest.rpe}. Keep 1–2 reps in reserve from here.`,
        target: { weight: backoff ?? undefined, reps: latest.reps ? Math.max(repRange[0], latest.reps - 2) : repRange[0], sets: 1, unit },
        restSec: restSec + 30,
        warmup: [],
        flags: [flag('caution', faded ? 'Performance fading' : 'Effort at ceiling', 'Reduce load rather than repeat it.', faded ? 'fade' : 'rpe')],
        basis,
      };
    }

    // Steady state: repeat the load, aim for the same reps.
    const easy = latest.rpe !== undefined && latest.rpe <= 7;
    const target = {
      weight: latest.weight !== undefined
        ? (easy ? roundTo(latest.weight * 1.025, step) : latest.weight)
        : undefined,
      reps: latest.reps,
      sets: 1,
      unit,
    };
    if (latest.durationSec) { target.durationSec = latest.durationSec; delete target.reps; }
    return {
      headline: target.weight
        ? `${target.weight}${unit} x ${target.reps ?? repRange[0]}`
        : `Repeat ${latest.reps ?? ''} reps`.trim(),
      detail: easy
        ? `Last set was RPE ${latest.rpe} — there is room. Small bump, same reps, stop when the bar speed changes.`
        : 'Match the last set. Stop the set when rep speed drops noticeably rather than grinding to failure.',
      target,
      restSec,
      warmup: [],
      flags,
      basis,
    };
  }

  // --- First set of this exercise today, with history --------------------
  const top = last.top;
  const topE = e1rmValue(top, settings);
  basis.push(`last session ${dayKey(last.date)}: ${top.weight ?? 'bodyweight'}${top.weight ? unit : ''} x ${top.reps ?? '-'}`);

  // Stagnation check across recent sessions.
  const recentBests = past
    .filter((s) => s.sets.some((x) => x.exerciseId === exerciseId))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, RULES.stagnationSessions)
    .map((s) => Math.max(...s.sets.filter((x) => x.exerciseId === exerciseId).map((x) => e1rmValue(x, settings) || 0)));
  const stagnant = recentBests.length >= RULES.stagnationSessions
    && Math.max(...recentBests) <= recentBests[recentBests.length - 1] * 1.01;

  const lastHitTop = top.reps !== undefined && top.reps >= repRange[1];
  const lastEasy = top.rpe === undefined || top.rpe <= 8;

  let target;
  let headline;
  let detail;

  if (stagnant) {
    const deload = top.weight ? roundTo(top.weight * RULES.deloadFactor, step) : undefined;
    target = { weight: deload, reps: repRange[1], sets: 3, unit };
    headline = deload ? `Deload: ${deload}${unit} x ${repRange[1]}` : `Deload ${ex ? ex.name : ''}`.trim();
    detail = `Your estimated max on this lift has been flat for ${RULES.stagnationSessions} sessions. That is a recovery problem more often than an effort problem. Take ~12% off for one session, keep the reps crisp, then come back and push.`;
    flags.push(flag('info', 'Progress has plateaued', 'A planned light session beats grinding the same weight a fourth time.', 'stagnation'));
  } else if (lastHitTop && lastEasy) {
    const bump = ex && (ex.primary.includes('quads') || ex.primary.includes('glutes') || ex.primary.includes('hamstrings') || ex.id === 'deadlift')
      ? 1.05 : 1.025;
    const w = top.weight ? roundTo(top.weight * bump, step) : undefined;
    target = { weight: w, reps: repRange[0], sets: 3, unit };
    headline = w ? `${w}${unit} x ${repRange[0]}` : `Add reps: ${repRange[1] + 2}`;
    detail = w
      ? `You finished ${top.reps} reps at ${top.weight}${unit} last time${top.rpe !== undefined ? ` at RPE ${top.rpe}` : ''}, so the top of the range is yours. One increment up, back down to ${repRange[0]} reps, and work back up over the coming sessions. That is ${pct(bump - 1)} — deliberately small, because ${pct(RULES.maxLoadJumpPct)} is where technique starts to slip.`
      : `You hit the top of the rep range. Add reps or add load next.`;
  } else if (top.reps !== undefined && top.reps < repRange[0]) {
    const w = top.weight ? roundTo(top.weight * 0.95, step) : undefined;
    target = { weight: w, reps: repRange[0], sets: 3, unit };
    headline = w ? `${w}${unit} x ${repRange[0]}` : `${repRange[0]} reps`;
    detail = `Last session you only got ${top.reps} reps, under the ${repRange[0]}–${repRange[1]} range this lift trains best in. Take 5% off and earn the range back before adding weight again.`;
  } else {
    target = { weight: top.weight, reps: Math.min(repRange[1], (top.reps || repRange[0]) + 1), sets: 3, unit };
    headline = top.weight ? `${top.weight}${unit} x ${target.reps}` : `${target.reps} reps`;
    detail = `Same load as last time, one more rep. Stay at this weight until you hit ${repRange[1]} reps on every set, then add the smallest increment. Slow and boring is what keeps you training.`;
  }

  if (ex && ex.kind === 'duration') {
    const lastDur = top.durationSec || repRange[0];
    target = { durationSec: Math.round(lastDur * 1.1), sets: 3, unit };
    headline = `${target.durationSec}s hold`;
    detail = `Last time you held ${lastDur}s. Add about 10% and stop the set when position breaks, not when the clock does.`;
  }

  const daysSince = Math.round((now - new Date(last.date)) / 86400000);
  if (daysSince >= 21 && target.weight) {
    const rusty = roundTo(target.weight * 0.9, step);
    flags.push(flag(
      'caution',
      `${daysSince} days since you last did this`,
      `After three weeks off a movement, your tissue tolerance drops faster than your strength does. Start at ${rusty}${unit} today and expect to be back within two sessions.`,
      'layoff',
    ));
    target.weight = rusty;
    headline = `${rusty}${unit} x ${target.reps ?? repRange[0]}`;
  }

  return {
    headline,
    detail,
    target,
    restSec,
    warmup: warmupRamp(target.weight, ex, unit),
    flags,
    basis: [...basis, topE ? `estimated 1RM ~${Math.round(topE)}${unit}` : null].filter(Boolean),
  };
}

/** Short spoken form of a recommendation, for text-to-speech. */
export function speakAdvice(advice) {
  if (!advice) return '';
  const parts = [advice.headline];
  const stop = advice.flags.find((f) => f.level === 'stop' || f.level === 'caution');
  if (stop) parts.push(stop.title);
  return parts.join('. ');
}

export { estimate1RM, loadForReps };
