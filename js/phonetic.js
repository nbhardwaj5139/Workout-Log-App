/**
 * A compact phonetic key, for matching what a word SOUNDS like.
 *
 * Letter-distance alone is a poor judge of speech errors: "bensch" and
 * "bench" are two edits apart on paper but identical out loud, while "curl"
 * and "hurl" are one edit apart and sound nothing alike. Reducing both sides
 * to a rough pronunciation and comparing that catches the first case without
 * inventing the second.
 *
 * This is a simplified Metaphone — enough for a 58-exercise vocabulary, not a
 * general English pronouncer.
 */

const DIGRAPHS = [
  [/^kn/, 'n'], [/^gn/, 'n'], [/^pn/, 'n'], [/^wr/, 'r'], [/^ps/, 's'],
  [/^x/, 's'], [/^wh/, 'w'],
  [/x/g, 'ks'],
  [/ough/g, 'f'], [/augh/g, 'af'], [/tch/g, 'ch'], [/sch/g, 'x'],
  [/ph/g, 'f'], [/gh/g, 'g'], [/ck/g, 'k'], [/dge/g, 'j'], [/dg/g, 'j'],
  [/qu/g, 'kw'], [/sh/g, 'x'], [/ch/g, 'x'], [/th/g, '0'],
  [/mb$/g, 'm'],
];

const VOWELS = /[aeiou]/;

/** Reduce a word to a rough pronunciation key. */
export function phoneticKey(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';

  for (const [re, to] of DIGRAPHS) w = w.replace(re, to);

  // Soft c and g depend on the following letter.
  w = w.replace(/c([eiy])/g, 's$1').replace(/c/g, 'k');
  w = w.replace(/g([eiy])/g, 'j$1');
  w = w.replace(/z/g, 's').replace(/v/g, 'f').replace(/y/g, 'i');

  const first = w[0];
  // Vowels carry little information after the first letter; drop them.
  let body = w.slice(1).replace(/[aeiou]/g, '');
  body = body.replace(/(.)\1+/g, '$1');           // collapse doubles

  const head = VOWELS.test(first) ? first : first;
  return (head + body).replace(/(.)\1+/g, '$1');
}

/** 0..1 similarity of two words by sound. */
export function phoneticSimilarity(a, b) {
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;

  const m = ka.length; const n = kb.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ka[i - 1] === kb[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** Number words, for repairing digits the recogniser fumbled. */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
];

const NUMBER_KEYS = NUMBER_WORDS.map((w) => ({ word: w, key: phoneticKey(w) }));

/**
 * Never snapped, however number-like they sound. "for" keys identically to
 * "four", and "for 8" is how reps are stated — rewriting it would break the
 * single most common phrase in the app.
 */
const PROTECTED = new Set([
  'for', 'to', 'too', 'at', 'with', 'and', 'the', 'a', 'an', 'of', 'on', 'in',
  'is', 'was', 'set', 'sets', 'rep', 'reps', 'rpe', 'rir', 'by', 'x', 'plate',
  'plates', 'each', 'side', 'hand', 'per', 'then', 'same', 'more', 'up', 'down',
]);

/**
 * Snap a token to a number word when it sounds like one and is not already a
 * real word we care about. "fife" -> five, "sevin" -> seven, "tin" -> ten.
 */
export function snapToNumberWord(token, threshold = 0.85) {
  const t = String(token || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t || NUMBER_WORDS.includes(t) || PROTECTED.has(t)) return null;
  const key = phoneticKey(t);
  let best = null;
  for (const n of NUMBER_KEYS) {
    const score = n.key === key ? 1 : phoneticSimilarity(t, n.word);
    if (!best || score > best.score) best = { word: n.word, score };
  }
  return best && best.score >= threshold ? best.word : null;
}
