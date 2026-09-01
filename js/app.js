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

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let state = store.load();
let session = null;
let currentExerciseId = null;
let lastSetRef = null;
let installPrompt = null;
let resumeMicOnReturn = false;

const unit = () => state.settings.unit;
const persist = () => store.save(state);

const screenLock = new ScreenLock();

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
      btn.addEventListener('click', () => { a.run(); node.remove(); });
      bar.appendChild(btn);
    }
    node.appendChild(bar);
  }
  area.prepend(node);
  while (area.children.length > 1) area.lastElementChild.remove();
  if (ttl) setTimeout(() => node.remove(), ttl);
}

// ---------------------------------------------------------------------------
// Handling what was said
// ---------------------------------------------------------------------------

function handleUtterance(raw, source = 'voice') {
  const results = parseUtterance(raw, {
    currentExerciseId,
    lastSet: lastSet(),
    unitPref: unit(),
  });
  for (const result of results) dispatch(result, raw, source);
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
    ],
  });

  speak(`${saved.exerciseName}, ${plainSet(saved).replace('×', 'by')}`, state.settings.speak);
  return saved;
}

function undoLast() {
  refreshSessionRef();
  if (!session || !session.sets.length) {
    toast('<div class="toast-main">Nothing to undo</div>', { level: 'low' });
    return;
  }
  const victim = session.sets[session.sets.length - 1];
  state = store.deleteSet(state, session.id, victim.id);
  refreshSessionRef();
  persist();
  lastSetRef = null;
  toast(`<div class="toast-main">Removed ${escapeHTML(victim.exerciseName)} ${escapeHTML(plainSet(victim))}</div>`);
  speak('Removed', state.settings.speak);
  render();
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
        ${g.sets.map((s, i) => `<li><button class="set-row" type="button" data-set="${s.id}">
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
  onInterim: (t) => { $('#transcript').textContent = t; },
  onFinal: (t) => {
    $('#transcript').textContent = '';
    handleUtterance(t, 'voice');
  },
  onState: (s) => {
    screenLock.sync(recognizer.wanted);
    $('#mic').setAttribute('aria-pressed', s === 'listening' ? 'true' : 'false');
    if (s === 'listening') $('#transcript').textContent = 'Listening…';
    else if (s === 'idle') $('#transcript').textContent = '';
  },
  onError: (msg) => toast(`<div class="toast-main">${escapeHTML(msg)}</div>`, { level: 'low' }),
});

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
    recognizer.toggle();
  });

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
      $$('.tab-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t.id === `tab-${btn.dataset.tab}`));
      window.scrollTo({ top: 0 });
    });
  });

  $('#theme-toggle').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'light' ? 'dark' : now === 'dark' ? '' : 'light';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('voicelift.theme', next);
  });

  $('#sheet-filter').addEventListener('input', renderHistory);
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
