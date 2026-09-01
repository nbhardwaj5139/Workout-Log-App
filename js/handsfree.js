/**
 * Hands-free mode: a wake phrase, then the set.
 *
 * The problem it solves: with the mic simply left on, every word you say to
 * your training partner — and every lyric the recogniser picks out of your
 * music — gets parsed as a set. So in hands-free mode nothing is logged until
 * a wake phrase is heard. Two shapes both work:
 *
 *   "log it, bench press 185 for 8"   → wake and set in one breath
 *   "log it" … (beep) … "185 for 8"   → wake, then the set within the window
 *
 * Everything else is ignored, which is what makes it safe to leave running
 * with the phone on the bench.
 */

export const WAKE_PHRASES = [
  'log it', 'log that', 'log this', 'log set', 'log',
  'hey lift', 'ok lift', 'okay lift',
  'next set', 'add set',
];

/** How long after a bare wake phrase we keep listening for the set. */
export const ARM_WINDOW_MS = 9000;

const clean = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Look for a wake phrase at the start of an utterance.
 * Longest phrase wins, so "log it" is not mistaken for bare "log".
 * Returns { matched, phrase, rest }.
 */
export function detectWake(text, phrases = WAKE_PHRASES) {
  const t = clean(text);
  if (!t) return { matched: false, phrase: null, rest: '' };

  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    const p = clean(phrase);
    if (t === p) return { matched: true, phrase: p, rest: '' };
    if (t.startsWith(`${p} `)) {
      return { matched: true, phrase: p, rest: t.slice(p.length + 1).trim() };
    }
  }
  return { matched: false, phrase: null, rest: '' };
}

/**
 * Decide what an utterance means while hands-free is on.
 *
 * state: { armedUntil }   now: ms timestamp
 * Returns one of:
 *   { action: 'log', text }        parse and log this
 *   { action: 'arm' }              wake heard alone — open the window
 *   { action: 'ignore', reason }   not for us
 */
export function routeUtterance(text, state, now = Date.now(), phrases = WAKE_PHRASES) {
  const wake = detectWake(text, phrases);

  if (wake.matched) {
    return wake.rest
      ? { action: 'log', text: wake.rest, via: 'wake+set' }
      : { action: 'arm', via: 'wake' };
  }

  if (state.armedUntil && now < state.armedUntil) {
    return { action: 'log', text: clean(text), via: 'armed' };
  }

  return { action: 'ignore', reason: 'no wake phrase', via: 'idle' };
}
