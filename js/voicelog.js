/**
 * A rolling record of what the microphone actually heard.
 *
 * "It's not hearing correctly" is unfixable without the words. This keeps the
 * last 200 voice utterances — the raw transcript, every alternative the
 * recogniser offered, which reading was chosen, and what it parsed into — so a
 * bad session can be exported and read rather than remembered.
 *
 * Anything the user marks wrong is flagged, because a list of failures beats a
 * list of everything.
 */

const KEY = 'voicelift.voicelog';
const LIMIT = 200;

export function all() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-LIMIT)));
  } catch { /* a full quota must not break logging */ }
}

export function record(entry) {
  const entries = all();
  entries.push({ ts: new Date().toISOString(), ...entry });
  write(entries);
  return entries[entries.length - 1];
}

/** Flag the most recent entry as misheard, optionally with the truth. */
export function markWrong(shouldHaveBeen = '') {
  const entries = all();
  if (!entries.length) return null;
  entries[entries.length - 1].wrong = true;
  if (shouldHaveBeen) entries[entries.length - 1].shouldHaveBeen = shouldHaveBeen;
  write(entries);
  return entries[entries.length - 1];
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

export const wrongCount = () => all().filter((e) => e.wrong).length;

/** Human-readable export — meant to be pasted straight into a bug report. */
export function toText(entries = all()) {
  if (!entries.length) return 'No voice utterances recorded yet.';

  const lines = [
    'VoiceLift — voice log',
    `${entries.length} utterances, ${entries.filter((e) => e.wrong).length} marked wrong`,
    `exported ${new Date().toISOString()}`,
    `browser: ${typeof navigator === 'undefined' ? 'n/a' : navigator.userAgent}`,
    '',
  ];

  for (const e of entries) {
    lines.push(`[${(e.ts || '').slice(11, 19)}]${e.wrong ? '  *** MARKED WRONG ***' : ''}`);
    lines.push(`  heard      : ${e.raw ?? ''}`);
    if (e.alternatives && e.alternatives.length > 1) {
      lines.push(`  alternates : ${e.alternatives.slice(1).join(' | ')}`);
    }
    if (e.chosen && e.chosen !== e.raw) lines.push(`  used       : ${e.chosen}`);
    lines.push(`  logged as  : ${e.outcome ?? '(nothing)'}`);
    if (e.shouldHaveBeen) lines.push(`  should be  : ${e.shouldHaveBeen}`);
    lines.push('');
  }
  return lines.join('\n');
}
