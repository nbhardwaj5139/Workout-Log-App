/**
 * VoiceLift — UI wiring.
 *
 * One job: get what you said into the log, correctly.
 *   speech (or typing) -> parseUtterance -> store.addSet -> confirmation
 * Anything the app is unsure about surfaces as a tappable correction rather
 * than a silent guess.
 */

import { parseUtterance } from './parser.js';
import { getExercise } from './exercises.js';
import * as store from './store.js';
import { setVolume, sessionTotals, dayKey, groupConsecutive } from './totals.js';
import { Recognizer, speak, speechSupported, speechUnavailableReason, isIOS, isStandalone } from './speech.js';
import { ScreenLock } from './wakelock.js';
import { routeUtterance, detectWake, WAKE_PHRASES, ARM_WINDOW_MS } from './handsfree.js';
import { bestReading } from './repair.js';
import * as voicelog from './voicelog.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let state = store.load();
let session = null;
let currentExerciseId = null;
let lastSetRef = null;
let installPrompt = null;
let resumeMicOnReturn = false;
let handsFree = false;
const armed = { armedUntil: 0 };
let armTimer = null;

const unit = () => state.settings.unit;
const persist = () => store.save(state);

const screenLock = new ScreenLock();

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Cross-fade between two DOM states using the View Transitions API.
 *
 * Used for tab switching only, and never for logging a set. Two of these
 * fired back to back wedged the renderer for over a minute in testing, and
 * logging two sets in quick succession is completely normal — so the log
 * animates with plain CSS, which cannot stall. The guard below also refuses
 * to start a second transition while one is running.
 */
let transitionBusy = false;
function withTransition(update) {
  if (!document.startViewTransition || reducedMotion() || transitionBusy) { update(); return; }
  transitionBusy = true;
  const t = document.startViewTransition(update);
  t.finished.finally(() => { transitionBusy = false; });
}

/** Set ids give each row a stable identity, so a re-render moves rows. */
let knownSetIds = new Set();

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtNum = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
const fmtVolume = (v) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

function fmtDuration(sec) {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

const fmtDistance = (m) => (!m ? '' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** The set as a lifter reads it: "185 lb × 8". */
function describeSet(set) {
  const bits = [];
  if (set.weight !== undefined) {
    bits.push(`${fmtNum(set.weight)}<span class="set-unit">${unit()}${set.perSide ? '/hand' : ''}</span>`);
  } else if (set.bodyweight) {
    bits.push('<span class="set-unit">bodyweight</span>');
  }
  if (set.reps !== undefined) bits.push(`× ${set.reps}`);
  if (set.durationSec) bits.push(fmtDuration(set.durationSec));
  if (set.distanceM) bits.push(fmtDistance(set.distanceM));
  return bits.join(' ') || '—';
}

const plainSet = (set) => describeSet(set).replace(/<[^>]+>/g, '');

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function openSession() {
  if (session && !session.endedAt) return session;
  const res = store.ensureSession(state);
  state = res.state;
  session = res.session;
  persist();
  return session;
}

function refreshSessionRef() {
  session = state.sessions.find((s) => s.id === (session && session.id)) || store.currentSession(state);
}

const lastSet = () => (session && session.sets.length ? session.sets[session.sets.length - 1] : null);

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function toast(html, { level = 'ok', actions = [], ttl = 6000 } = {}) {
  const area = $('#toast-area');
  const node = document.createElement('div');
  node.className = `toast toast-${level}`;
  node.innerHTML = html;
  if (actions.length) {
    const bar = document.createElement('div');
    bar.className = 'toast-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { a.run(); dismiss(node); });
      bar.appendChild(btn);
    }
    node.appendChild(bar);
  }
  area.prepend(node);
  // dismiss() only *starts* an exit animation — the node lives on until it
  // ends. Counting it as present here spins forever, so count only the
  // toasts that are not already on their way out.
  const live = () => [...area.children].filter((n) => !n.classList.contains('is-leaving'));
  while (live().length > 1) dismiss(live().at(-1));
  if (ttl) setTimeout(() => dismiss(node), ttl);
}

/** Let a toast animate out rather than vanishing mid-sentence. */
function dismiss(node) {
  if (!node || node.classList.contains('is-leaving')) return;
  if (reducedMotion()) { node.remove(); return; }
  node.classList.add('is-leaving');
  node.addEventListener('animationend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 400);
}

// ---------------------------------------------------------------------------
// Audio cues — in hands-free mode these are the entire interface
// ---------------------------------------------------------------------------

let audioCtx = null;

function tone(freq, ms = 120, when = 0) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  } catch { /* audio is a nicety, never a dependency */ }
}

const cue = {
  armed: () => tone(880, 110),                       // "go ahead"
  logged: () => { tone(660, 90); tone(990, 110, 0.1); }, // rising: got it
  rejected: () => tone(320, 180),                    // low: not understood
};

// ---------------------------------------------------------------------------
// Handling what was said
// ---------------------------------------------------------------------------

function handleUtterance(raw, source = 'voice', alternatives = []) {
  const parse = (text) => parseUtterance(text, {
    currentExerciseId,
    lastSet: lastSet(),
    unitPref: unit(),
  });

  // The recogniser's first guess is often not its best one, and gym words get
  // mangled ("five reps" -> "fiber wraps"). Try every reading, keep the one
  // that actually parses.
  const best = bestReading(raw, alternatives, parse);

  if (source === 'voice') {
    const summary = best.results.map((r) => (r.type === 'set'
      ? `${r.set.exerciseName} ${plainSet(r.set)}`
      : r.type === 'command' ? `command: ${r.command}`
        : r.type === 'focus' ? `switched to ${r.exerciseName}`
          : `not understood (${r.reason})`)).join('; ');
    voicelog.record({
      raw, alternatives, chosen: best.text, outcome: summary,
    });
  }

  for (const result of best.results) dispatch(result, raw, source);
  render();
}

function dispatch(result, raw, source) {
  if (result.type === 'set') return logSet(result, source);
  if (result.type === 'focus') {
    currentExerciseId = result.exerciseId;
    toast(`<div class="toast-main">On to ${escapeHTML(result.exerciseName)}</div>
      <p class="small muted">Just say the numbers from here.</p>`);
    return null;
  }
  if (result.type === 'command') return runCommand(result);

  toast(`<div class="toast-heard">heard “${escapeHTML(result.raw || raw)}”</div>
    <div class="toast-main">${escapeHTML(result.reason)}</div>
    <p class="small muted">Try “bench press 185 for 8”. Order doesn’t matter — “185 for 8 bench press” works too.</p>`,
  { level: 'bad' });
  cue.rejected();
  speak("Didn't catch that", state.settings.speak);
  return null;
}

function logSet(result, source) {
  openSession();
  const res = store.addSet(state, session.id, { ...result.set, source, confidence: result.confidence });
  state = res.state;
  refreshSessionRef();
  const saved = res.set;
  lastSetRef = { sessionId: session.id, setId: saved.id };
  currentExerciseId = saved.exerciseId || currentExerciseId;
  persist();

  const low = result.confidence < 0.7;
  toast(`<div class="toast-heard">heard “${escapeHTML(saved.raw || '')}”</div>
    <div class="toast-main">${escapeHTML(saved.exerciseName)} · ${escapeHTML(plainSet(saved))}${saved.rpe !== undefined ? ` @ RPE ${saved.rpe}` : ''}</div>
    ${result.warnings.map((w) => `<p class="small muted">${escapeHTML(w)}</p>`).join('')}
    ${low ? '<p class="small muted">Not fully sure of that one — worth a check.</p>' : ''}`, {
    level: low ? 'low' : 'ok',
    actions: [
      { label: 'Edit', run: () => openEdit(saved.id) },
      { label: 'Undo', run: undoLast },
      {
        label: 'Wrong',
        run: () => {
          voicelog.markWrong();
          toast('<div class="toast-main">Flagged as misheard</div>'
            + '<p class="small muted">Kept in the voice log. Settings → Voice log → Copy, and send it over.</p>');
          renderSettings();
        },
      },
    ],
  });

  cue.logged();
  speak(`${saved.exerciseName}, ${plainSet(saved).replace('×', 'by')}`, state.settings.speak);
  queueMicrotask(() => {
    const row = document.querySelector(`.set-row[data-set="${saved.id}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  return saved;
}

function undoLast() {
  refreshSessionRef();
  if (!session || !session.sets.length) {
    toast('<div class="toast-main">Nothing to undo</div>', { level: 'low' });
    return;
  }
  const victim = session.sets[session.sets.length - 1];
  const row = document.querySelector(`.set-row[data-set="${victim.id}"]`);

  const commit = () => {
    state = store.deleteSet(state, session.id, victim.id);
    refreshSessionRef();
    persist();
    lastSetRef = null;
    knownSetIds.delete(victim.id);
    toast(`<div class="toast-main">Removed ${escapeHTML(victim.exerciseName)} ${escapeHTML(plainSet(victim))}</div>`);
    speak('Removed', state.settings.speak);
    render();
  };

  // Let the row fall away first; the re-render then closes the gap.
  if (row && !reducedMotion()) {
    row.classList.add('is-leaving');
    setTimeout(commit, 130);
  } else {
    commit();
  }
}

function runCommand(result) {
  refreshSessionRef();
  switch (result.command) {
    case 'undo':
      return undoLast();

    case 'repeat': {
      const prev = lastSet();
      if (!prev) {
        toast('<div class="toast-main">Nothing to repeat yet</div>', { level: 'low' });
        return null;
      }
      const o = result.overrides || {};
      const copy = {
        ...prev,
        sets: o.sets || 1,
        reps: o.reps ?? prev.reps,
        weight: o.weight ?? prev.weight,
        rpe: o.rpe,
        rir: o.rir,
        durationSec: o.durationSec ?? prev.durationSec,
        raw: result.raw,
      };
      delete copy.id;
      delete copy.ts;
      return logSet({ type: 'set', set: copy, confidence: 0.9, warnings: [] }, 'voice');
    }

    case 'amend': {
      if (!lastSetRef) {
        toast('<div class="toast-main">Nothing to correct yet</div>', { level: 'low' });
        return null;
      }
      const patch = {};
      for (const k of ['reps', 'weight', 'sets', 'rpe', 'rir', 'durationSec', 'distanceM']) {
        if (result.fields[k] !== undefined) patch[k] = result.fields[k];
      }
      state = store.updateSet(state, lastSetRef.sessionId, lastSetRef.setId, patch);
      refreshSessionRef();
      persist();
      const fixed = session.sets.find((s) => s.id === lastSetRef.setId);
      toast(`<div class="toast-main">Fixed → ${escapeHTML(plainSet(fixed))}</div>`);
      speak('Fixed', state.settings.speak);
      return null;
    }

    case 'finish':
    case 'new': {
      if (!session || !session.sets.length) {
        toast('<div class="toast-main">No sets logged yet</div>', { level: 'low' });
        return null;
      }
      const t = sessionTotals(session);
      state = store.endSession(state, session.id);
      persist();
      session = null;
      currentExerciseId = null;
      lastSetRef = null;
      toast(`<div class="toast-main">Workout saved</div>
        <p class="small muted">${t.hardSets} sets · ${t.reps} reps · ${fmtVolume(t.volume)} ${unit()} moved. It’s in History.</p>`);
      speak(`Saved. ${t.hardSets} sets.`, state.settings.speak);
      if (result.command === 'new') openSession();
      return null;
    }

    // Commands the log deliberately does not handle any more.
    case 'rest':
    case 'note':
    case 'coach':
      toast('<div class="toast-main">Not part of the log</div>'
        + '<p class="small muted">This version just records sets. Say the exercise, weight and reps.</p>',
      { level: 'low' });
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  refreshSessionRef();
  renderToday();
  renderHistory();
  renderSettings();
}

function renderSessionMeta() {
  const meta = $('#session-meta');
  if (!session || !session.sets.length) { meta.hidden = true; return; }
  const mins = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000);
  meta.hidden = false;
  meta.textContent = `${mins} min`;
}

const EXAMPLES = [
  'bench press 185 for 8',
  '185 for 8',
  'three sets of ten on lat pulldown at 120',
  'squat two plates for five',
  'pull ups bodyweight 12',
];

function renderToday() {
  renderSessionMeta();
  const head = $('#today-head');
  const host = $('#today-sets');
  const actions = $('#today-actions');

  if (!session || !session.sets.length) {
    head.innerHTML = '';
    actions.hidden = true;
    host.innerHTML = `<div class="empty">
      <div class="empty-title">Say your first set</div>
      <p class="empty-body">Name the exercise once, then just call out the numbers.
        Word order doesn’t matter.</p>
      <div class="examples">
        ${EXAMPLES.map((e) => `<button class="example" type="button" data-example="${escapeHTML(e)}">${escapeHTML(e)}</button>`).join('')}
      </div>
    </div>`;
    knownSetIds = new Set();
    lastTotals = {};
    $$('.example').forEach((btn) => btn.addEventListener('click', () => {
      $('#manual-input').value = btn.dataset.example;
      $('#manual-input').focus();
    }));
    return;
  }

  const t = sessionTotals(session);
  head.innerHTML = `
    <div class="day-title">Today</div>
    <div class="day-totals">
      <div class="total"><span class="total-value">${t.hardSets}</span><span class="total-label">Sets</span></div>
      <div class="total"><span class="total-value">${t.reps}</span><span class="total-label">Reps</span></div>
      <div class="total"><span class="total-value">${fmtVolume(t.volume)}</span><span class="total-label">${escapeHTML(unit())} moved</span></div>
      <div class="total"><span class="total-value">${t.exercises}</span><span class="total-label">Exercises</span></div>
    </div>`;

  host.innerHTML = groupConsecutive(session.sets).map((g) => {
    const vol = g.sets.reduce((n, s) => n + setVolume(s), 0);
    const hard = g.sets.reduce((n, s) => n + (s.sets || 1), 0);
    return `<div class="group">
      <div class="group-head">
        <span class="group-name">${escapeHTML(g.name)}</span>
        <span class="group-meta">${hard} set${hard > 1 ? 's' : ''}${vol ? ` · ${fmtVolume(vol)} ${unit()}` : ''}</span>
      </div>
      <ul class="set-list">
        ${g.sets.map((s, i) => `<li><button class="set-row${knownSetIds.has(s.id) ? '' : ' is-new'}" type="button" data-set="${s.id}">
          <span class="set-index">${i + 1}</span>
          <span class="set-main">${describeSet(s)}</span>
          <span class="spacer"></span>
          ${(s.sets || 1) > 1 ? `<span class="set-tag">×${s.sets} sets</span>` : ''}
          ${s.rpe !== undefined ? `<span class="set-tag">RPE ${s.rpe}</span>` : ''}
          ${s.confidence !== undefined && s.confidence < 0.7 ? '<span class="set-tag warn">check</span>' : ''}
        </button></li>`).join('')}
      </ul>
    </div>`;
  }).join('');

  actions.hidden = false;
  $$('#today-sets .set-row').forEach((btn) => {
    btn.addEventListener('click', () => openEdit(btn.dataset.set));
  });
  knownSetIds = new Set(session.sets.map((s) => s.id));
  bumpTotals(t);
}

// Nudge a total when it actually changes, so the eye catches the update.
let lastTotals = {};
function bumpTotals(t) {
  const cells = $$('#today-head .total-value');
  const order = [t.hardSets, t.reps, t.volume, t.exercises];
  order.forEach((value, i) => {
    if (lastTotals[i] !== undefined && lastTotals[i] !== value && cells[i] && !reducedMotion()) {
      cells[i].classList.add('is-bumped');
      cells[i].addEventListener('animationend', () => cells[i].classList.remove('is-bumped'), { once: true });
    }
    lastTotals[i] = value;
  });
}

function renderHistory() {
  const host = $('#history-host');
  const filter = ($('#sheet-filter').value || '').trim().toLowerCase();
  const done = [...state.sessions]
    .filter((s) => s.sets.length && s.endedAt)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const cards = [];
  for (const s of done) {
    const groups = groupConsecutive(s.sets)
      .filter((g) => !filter || g.name.toLowerCase().includes(filter));
    if (!groups.length) continue;
    const t = sessionTotals(s);
    cards.push(`<div class="day-card">
      <div class="day-card-head">
        <span class="day-card-date">${new Date(s.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span class="day-card-meta">${t.hardSets} sets · ${fmtVolume(t.volume)} ${unit()}</span>
      </div>
      <div class="day-lines">
        ${groups.map((g) => `<div class="day-line">
          <span class="day-line-name">${escapeHTML(g.name)}</span>
          <span class="day-line-sets">${g.sets.map((x) => ((x.sets || 1) > 1 ? `${x.sets}×${plainSet(x)}` : plainSet(x))).join(' · ')}</span>
        </div>`).join('')}
      </div>
    </div>`);
  }

  host.innerHTML = cards.length
    ? cards.join('')
    : `<div class="empty"><div class="empty-title">${filter ? 'No matches' : 'No finished workouts yet'}</div>
       <p class="empty-body">${filter ? 'Try a different exercise name.' : 'Log some sets, then tap Finish workout — it lands here.'}</p></div>`;
}

function renderSettings() {
  $('#set-unit').value = state.settings.unit;
  $('#set-speak').checked = state.settings.speak;
  $('#set-wake').value = state.settings.wakePhrase || 'log it';
  const entries = voicelog.all();
  $('#voicelog-count').textContent = entries.length
    ? `${entries.length} recorded · ${voicelog.wrongCount()} marked wrong`
    : 'Nothing recorded yet — it fills up as you use the mic.';
  renderInstallState();
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function openEdit(setId) {
  refreshSessionRef();
  const owner = state.sessions.find((s) => s.sets.some((x) => x.id === setId));
  if (!owner) return;
  const set = owner.sets.find((x) => x.id === setId);
  const dialog = $('#edit-dialog');
  const form = $('#edit-form');

  $('#edit-title').textContent = set.exerciseName;
  $('#edit-raw').textContent = set.raw ? `Heard: “${set.raw}”` : 'Entered by hand.';
  const fields = ['weight', 'reps', 'sets', 'rpe', 'durationSec', 'distanceM'];
  for (const name of fields) form.elements[name].value = set[name] ?? '';

  const onClose = () => {
    dialog.removeEventListener('close', onClose);
    const action = dialog.returnValue;
    if (action === 'cancel' || !action) return;
    if (action === 'delete') {
      state = store.deleteSet(state, owner.id, setId);
    } else {
      const patch = { confidence: 1, source: 'edited' };
      for (const name of fields) {
        const v = form.elements[name].value;
        patch[name] = v === '' ? undefined : Number(v);
      }
      if (patch.rpe !== undefined) patch.rir = Math.max(0, 10 - patch.rpe);
      state = store.updateSet(state, owner.id, setId, patch);
    }
    refreshSessionRef();
    persist();
    render();
  };
  dialog.addEventListener('close', onClose);
  dialog.showModal();
}

// ---------------------------------------------------------------------------
// Export / install / service worker
// ---------------------------------------------------------------------------

function download(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function renderInstallState() {
  const stateEl = $('#install-state');
  const hint = $('#install-hint');
  const btn = $('#install-btn');

  if (isStandalone()) {
    stateEl.textContent = 'Installed — you are in the home-screen app.';
    btn.hidden = true;
    hint.textContent = isIOS()
      ? 'Heads up: iOS disables web speech recognition in home-screen apps. Use the 🎤 key on your keyboard here, or open the site in Safari for the in-app mic.'
      : 'Works offline.';
    return;
  }
  btn.hidden = !installPrompt;
  stateEl.textContent = 'Not installed.';
  hint.textContent = isIOS()
    ? 'On iPhone: Share → Add to Home Screen. Note that iOS turns off the in-app mic once installed — keyboard dictation still works.'
    : 'Install it and it works offline, fullscreen, with no address bar.';
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          toast('<div class="toast-main">New version ready</div>'
            + '<p class="small muted">Your log is untouched either way.</p>', {
            ttl: 0,
            actions: [{
              label: 'Reload',
              run: () => {
                incoming.postMessage('SKIP_WAITING');
                navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
              },
            }],
          });
        }
      });
    });
  }).catch((err) => console.warn('Service worker registration failed:', err));
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

const recognizer = new Recognizer({
  onInterim: (t) => {
    $('#transcript').textContent = t;
    if (!handsFree || armed.armedUntil > Date.now()) return;
    // Chrome waits for a pause before marking a result final, which is dead
    // air the user is already talking into. Arming off the interim result
    // removes that wait entirely.
    if (detectWake(t, wakePhrases()).matched) armWindow();
  },
  onFinal: (t, meta = {}) => {
    $('#transcript').textContent = '';
    const alts = meta.alternatives || [];
    if (!handsFree) { handleUtterance(t, 'voice', alts); return; }

    const decision = routeUtterance(t, armed, Date.now(), wakePhrases());
    if (decision.action === 'arm') { armWindow(); return; }
    if (decision.action === 'log') {
      disarm();
      // Strip the wake phrase off the alternatives too, so they stay usable.
      const cleanAlts = alts
        .map((a) => { const w = detectWake(a, wakePhrases()); return w.matched ? w.rest : a; })
        .filter(Boolean);
      handleUtterance(decision.text, 'voice', cleanAlts);
      renderStatus();
      return;
    }
    // Ignored: someone talking, or the music. Show it, never log it.
    $('#transcript').textContent = `ignored: “${t}”`;
    setTimeout(() => { $('#transcript').textContent = ''; }, 1800);
  },
  onState: (s) => {
    screenLock.sync(recognizer.wanted);
    $('#mic').setAttribute('aria-pressed', s === 'listening' ? 'true' : 'false');
    if (s === 'idle') { disarm(); handsFree = false; }
    renderStatus();
  },
  onError: (msg) => toast(`<div class="toast-main">${escapeHTML(msg)}</div>`, { level: 'low' }),
});

const wakePhrases = () => {
  const chosen = state.settings.wakePhrase || 'log it';
  // Always accept the built-ins too; a missed wake phrase is worse than a
  // slightly wider net, since nothing logs without one.
  return [...new Set([chosen, ...WAKE_PHRASES])];
};

function armWindow() {
  const wasArmed = armed.armedUntil > Date.now();
  armed.armedUntil = Date.now() + ARM_WINDOW_MS;
  if (!wasArmed) cue.armed();
  renderStatus();
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { disarm(); renderStatus(); }, ARM_WINDOW_MS);
}

function disarm() {
  armed.armedUntil = 0;
  clearTimeout(armTimer);
  armTimer = null;
  $('.composer')?.classList.remove('is-armed');
}

function renderStatus() {
  const el = $('#status');
  const composer = $('.composer');
  if (!recognizer.wanted) {
    el.textContent = '';
    el.classList.remove('is-armed');
    composer.classList.remove('is-armed');
    return;
  }
  const isArmed = armed.armedUntil > Date.now();
  el.classList.toggle('is-armed', isArmed);
  composer.classList.toggle('is-armed', isArmed);
  if (isArmed) el.textContent = 'Go ahead — say the set';
  else if (handsFree) el.textContent = `Hands-free · say “${state.settings.wakePhrase || 'log it'}”`;
  else el.textContent = 'Listening — say the set';
}

/**
 * Phones suspend a backgrounded tab and iOS tears speech recognition down
 * when the screen locks. Stand the mic down cleanly and restart on return
 * rather than leaving a dead recogniser that still looks live.
 */
function handleVisibility() {
  if (document.visibilityState === 'hidden') {
    if (recognizer.wanted) { resumeMicOnReturn = true; recognizer.stop(); }
    return;
  }
  if (resumeMicOnReturn) {
    resumeMicOnReturn = false;
    recognizer.start();
  }
  screenLock.sync(recognizer.wanted);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire() {
  $('#mic').addEventListener('click', () => {
    speak('', state.settings.speak); // unlocks speech synthesis on first gesture
    if (!recognizer.wanted) handsFree = false;
    recognizer.toggle();
  });

  $('#handsfree').addEventListener('click', () => {
    handsFree = !handsFree;
    $('#handsfree').setAttribute('aria-pressed', handsFree ? 'true' : 'false');
    disarm();
    if (handsFree) {
      speak('', state.settings.speak);
      tone(720, 90); // confirm the mode change audibly, since that is the point
      if (!recognizer.wanted) recognizer.start();
      toast(`<div class="toast-main">Hands-free on</div>
        <p class="small muted">Say “${escapeHTML(state.settings.wakePhrase || 'log it')}” then the set — or both in one breath.
        Nothing logs without the wake phrase.</p>`);
    } else {
      recognizer.stop();
    }
    renderStatus();
  });

  if (!speechSupported) $('#handsfree').disabled = true;

  if (!speechSupported) {
    $('#mic').disabled = true;
    const note = $('#mic-note');
    note.hidden = false;
    note.textContent = speechUnavailableReason();
  }

  $('#manual-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = $('#manual-input');
    const value = input.value.trim();
    if (!value) return;
    handleUtterance(value, 'typed');
    input.value = '';
  });

  $('#undo-btn').addEventListener('click', undoLast);
  $('#finish-btn').addEventListener('click', () => { runCommand({ command: 'finish' }); render(); });

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return;
      moveTabIndicator(btn);
      withTransition(() => {
        $$('.tab-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
        $$('.tab').forEach((t) => t.classList.toggle('is-active', t.id === `tab-${btn.dataset.tab}`));
      });
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
  });
  moveTabIndicator($('.tab-btn.is-active'));
  window.addEventListener('resize', () => moveTabIndicator($('.tab-btn.is-active')));

  $('#theme-toggle').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'light' ? 'dark' : now === 'dark' ? '' : 'light';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('voicelift.theme', next);
  });

  $('#sheet-filter').addEventListener('input', renderHistory); // no transition while typing
  $('#export-sets').addEventListener('click', () => download(`voicelift-sets-${stamp()}.csv`, store.toCSV(state), 'text/csv'));
  $('#export-sessions').addEventListener('click', () => download(`voicelift-workouts-${stamp()}.csv`, store.toSessionCSV(state), 'text/csv'));
  $('#export-json').addEventListener('click', () => download(`voicelift-backup-${stamp()}.json`, store.toJSON(state), 'application/json'));

  $('#set-unit').addEventListener('change', (e) => {
    state = store.updateSettings(state, { unit: e.target.value });
    persist(); render();
  });
  $('#set-speak').addEventListener('change', (e) => {
    state = store.updateSettings(state, { speak: e.target.checked });
    persist();
  });
  $('#set-wake').addEventListener('change', (e) => {
    state = store.updateSettings(state, { wakePhrase: e.target.value });
    persist();
    renderStatus();
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state = store.importJSON(await file.text());
      session = null;
      persist();
      render();
      toast('<div class="toast-main">Backup restored</div>');
    } catch (err) {
      toast(`<div class="toast-main">Could not read that file</div><p class="small muted">${escapeHTML(err.message)}</p>`, { level: 'bad' });
    }
    e.target.value = '';
  });

  $('#voicelog-copy').addEventListener('click', async () => {
    const text = voicelog.toText();
    try {
      await navigator.clipboard.writeText(text);
      toast('<div class="toast-main">Voice log copied</div><p class="small muted">Paste it wherever you are reporting the problem.</p>');
    } catch {
      // Clipboard is blocked in plenty of contexts; falling back to a file
      // beats telling the user it failed.
      download(`voicelift-voicelog-${stamp()}.txt`, text, 'text/plain');
      toast('<div class="toast-main">Clipboard blocked — downloaded instead</div>');
    }
  });
  $('#voicelog-download').addEventListener('click', () => {
    download(`voicelift-voicelog-${stamp()}.txt`, voicelog.toText(), 'text/plain');
  });
  $('#voicelog-clear').addEventListener('click', () => {
    voicelog.clear();
    renderSettings();
    toast('<div class="toast-main">Voice log cleared</div>');
  });

  $('#clear-data').addEventListener('click', () => {
    if (!confirm('Erase every workout stored in this browser? This cannot be undone.')) return;
    state = store.clearAll();
    session = null;
    currentExerciseId = null;
    render();
  });

  $('#install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderInstallState();
  });

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    installPrompt = ev;
    renderInstallState();
  });

  document.addEventListener('visibilitychange', handleVisibility);
  setInterval(renderSessionMeta, 30000);
}

/** Slide the pill to sit behind whichever tab is active. */
function moveTabIndicator(btn) {
  const ind = $('#tab-ind');
  if (!ind || !btn) return;
  const bar = btn.parentElement.getBoundingClientRect();
  const box = btn.getBoundingClientRect();
  ind.style.width = `${box.width}px`;
  ind.style.transform = `translateX(${box.left - bar.left}px)`;
}

function boot() {
  const theme = localStorage.getItem('voicelift.theme');
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  session = store.currentSession(state);
  if (session && session.sets.length) {
    const last = session.sets[session.sets.length - 1];
    currentExerciseId = last.exerciseId;
    lastSetRef = { sessionId: session.id, setId: last.id };
  }
  wire();
  render();
  registerServiceWorker();
}

boot();

window.VoiceLift = { get state() { return state; }, handleUtterance, parseUtterance, getExercise };
