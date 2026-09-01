/**
 * Transcript repair.
 *
 * Speech recognisers are tuned for ordinary English, and gym speech is not
 * ordinary English. "five reps" comes back as "fiber wraps", "squat" as
 * "squad", "six" as "sex". The recogniser is confident and wrong, so the fix
 * has to happen after it.
 *
 * Two mechanisms, both safe by construction:
 *
 *   1. candidates() produces every plausible reading of an utterance — the raw
 *      text, a repaired version, and the same for each alternative the
 *      recogniser offered. The caller parses all of them and keeps whichever
 *      parses best, so a bad repair can only ever lose, never win.
 *
 *   2. repair() applies a domain substitution list. It is allowed to be
 *      aggressive precisely because of rule 1.
 */

/** Multi-word confusions, applied first — longest wins. */
const PHRASES = [
  [/\bfiber wraps?\b/g, 'five reps'],
  [/\bfive wraps?\b/g, 'five reps'],
  [/\bfiver apps?\b/g, 'five reps'],
  [/\bfor eps\b/g, 'four reps'],
  [/\bate reps?\b/g, 'eight reps'],
  [/\bfree reps?\b/g, 'three reps'],
  [/\btree reps?\b/g, 'three reps'],
  [/\bsex reps?\b/g, 'six reps'],
  [/\btin reps?\b/g, 'ten reps'],
  [/\bwon rep\b/g, 'one rep'],
  [/\bdead lift(s)?\b/g, 'deadlift$1'],
  [/\blat pull down\b/g, 'lat pulldown'],
  [/\bpull up(s)?\b/g, 'pullup$1'],
  [/\bpush up(s)?\b/g, 'pushup$1'],
  [/\bour pee\b/g, 'rpe'],
  [/\bare pe\b/g, 'rpe'],
  [/\br p e\b/g, 'rpe'],
  [/\bper hand\b/g, 'each hand'],
];

/**
 * Single-token confusions. Only words that have no plausible meaning in a
 * workout log are listed — "for", "to" and "four" are deliberately absent
 * because all three are load-bearing in real phrases ("for 8", "to failure").
 */
const WORDS = new Map(Object.entries({
  // "reps"
  wraps: 'reps', wrap: 'reps', raps: 'reps', rap: 'reps', wrapped: 'reps',
  rips: 'reps', ribs: 'reps', reppes: 'reps', repp: 'rep', rebs: 'reps',
  // "sets"
  sats: 'sets', sits: 'sets', sects: 'sets',
  // numbers
  won: 'one', ate: 'eight', tree: 'three', sex: 'six', sick: 'six',
  nein: 'nine', fiver: 'five', tin: 'ten', tenn: 'ten',
  // exercises
  squad: 'squat', squads: 'squats', swat: 'squat',
  bunch: 'bench', bensch: 'bench', bench: 'bench',
  girl: 'curl', girls: 'curls', kernel: 'curl',
  presses: 'press', pressed: 'press',
  rose: 'rows', roe: 'row',
  // units
  pounce: 'pounds', pound: 'pounds', kilo: 'kilos',
  // effort
  failure: 'failure', fail: 'failure',
}));

/** Apply the domain substitutions. Returns text unchanged when nothing hits. */
export function repair(text) {
  let t = ` ${String(text || '').toLowerCase()} `;
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  t = t
    .split(/\s+/)
    .map((w) => {
      const bare = w.replace(/[^a-z0-9']/g, '');
      const fixed = WORDS.get(bare);
      return fixed === undefined ? w : w.replace(bare, fixed);
    })
    .join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Every reading worth trying, best-guess first, de-duplicated.
 * `alternatives` is what the recogniser offered (result[0..n].transcript).
 */
export function candidates(text, alternatives = []) {
  const out = [];
  const push = (s) => {
    const v = String(s || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };

  push(text);
  push(repair(text));
  for (const alt of alternatives) {
    push(alt);
    push(repair(alt));
  }
  return out;
}

/**
 * Parse every candidate and keep the best reading.
 *
 * `parse` returns the array parseUtterance() gives back. A reading wins if it
 * produces more complete sets, then on confidence. The original transcript is
 * first in the list and ties go to whatever came earlier, so a repair only
 * displaces it by being strictly better.
 */
export function bestReading(text, alternatives, parse) {
  let best = null;
  for (const candidate of candidates(text, alternatives)) {
    const results = parse(candidate);
    const sets = results.filter((r) => r.type === 'set');
    const complete = sets.filter((r) => r.set.reps !== undefined
      && (r.set.weight !== undefined || r.set.bodyweight || r.set.durationSec || r.set.distanceM));

    const score = {
      complete: complete.length,
      sets: sets.length,
      actionable: results.filter((r) => r.type !== 'unknown').length,
      confidence: sets.length ? Math.min(...sets.map((r) => r.confidence)) : 0,
    };

    if (!best
      || score.complete > best.score.complete
      || (score.complete === best.score.complete && score.actionable > best.score.actionable)
      || (score.complete === best.score.complete && score.actionable === best.score.actionable
          && score.confidence > best.score.confidence + 0.001)) {
      best = { text: candidate, results, score };
    }
  }
  return best;
}
