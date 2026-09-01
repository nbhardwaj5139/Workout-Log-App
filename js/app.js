/**
 * VoiceLift — UI wiring.
 *
 * Flow of one spoken set:
 *   Recognizer -> parseUtterance -> store.addSet -> coach.reviewSet
 *     -> toast + spoken confirmation -> re-render today + coach card.
 *
 * The same path serves the text box, so everything is usable (and testable)
 * without a microphone.
 */

import { parseUtterance } from './parser.js';
import { EXERCISES, getExercise } from './exercises.js';
import * as store from './store.js';
import * as A from './analytics.js';
import { advise, reviewSet, sessionFlags, speakAdvice, RULES } from './coach.js';
import { renderLine, renderBars, renderHBars, renderTable } from './charts.js';
import { Recognizer, speak, speechSupported, speechUnavailableReason } from './speech.js';
import { ScreenLock, wakeLockSupported } from './wakelock.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let state = store.load();
let session = null;          // the open session, if any
let currentExerciseId = null;
let lastSetRef = null;       // { sessionId, setId } for undo / amend
let restTimer = null;
let installPrompt = null;   // the deferred beforeinstallprompt event
let resumeMicOnReturn = false;

const screenLock = new ScreenLock((held) => {
  const el = document.getElementById('screen-lock');
  if (el) el.hidden = !held;
});

/** The screen is held awake only while the mic is live or a rest timer runs. */
function syncScreenLock() {
  screenLock.sync(recognizer.wanted || restTimer !== null);
}

const unit = () => state.settings.unit;
const persist = () => store.save(state);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtNum = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
const fmtWeight = (w) => `${fmtNum(w)} ${unit()}`;
const fmtVolume = (v) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

function fmtDuration(sec) {
  if (sec === undefined || sec === null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function fmtDistance(m) {
  if (!m) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** One-line human description of a logged set. */
function describeSet(set) {
  const bits = [];
  if ((set.sets || 1) > 1) bits.push(`${set.sets} ×`);
  if (set.weight !== undefined) bits.push(`${fmtNum(set.weight)}${unit()}${set.perSide ? '/hand' : ''}`);
  else if (set.bodyweight) bits.push('bodyweight');
  if (set.reps !== undefined) bits.push(`× ${set.reps}`);
  if (set.durationSec) bits.push(fmtDuration(set.durationSec));
  if (set.distanceM) bits.push(fmtDistance(set.distanceM));
  return bits.join(' ') || '—';
}

const FLAG_ICON = { stop: '⛔', caution: '⚠️', info: 'ℹ️' };

function flagHTML(f) {
  return `<div class="flag flag-${f.level}">
    <span class="flag-icon" aria-hidden="true">${FLAG_ICON[f.level]}</span>
    <div><div class="flag-title">${escapeHTML(f.title)}</div>
    <p class="flag-detail">${escapeHTML(f.detail)}</p></div>
  </div>`;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

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

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function toast(html, { level = 'ok', actions = [], ttl = 14000 } = {}) {
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
      btn.className = 'btn btn-ghost';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { a.run(); node.remove(); });
      bar.appendChild(btn);
    }
    node.appendChild(bar);
  }
  area.prepend(node);
  while (area.children.length > 3) area.lastElementChild.remove();
  if (ttl) setTimeout(() => node.remove(), ttl);
  return node;
}

// ---------------------------------------------------------------------------
// Rest timer
// ---------------------------------------------------------------------------

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 800);
  } catch { /* sound is optional */ }
}

function startRest(seconds, label = 'Rest') {
  stopRest();
  const total = Math.max(5, Math.round(seconds));
  const until = Date.now() + total * 1000;
  const host = $('#rest-timer');
  host.hidden = false;
  $('#rest-label').textContent = `${label} · ${fmtDuration(total)}`;

  const tick = () => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    $('#rest-remaining').textContent = fmtDuration(left) || '0s';
    $('#rest-fill').style.width = `${(left / total) * 100}%`;
    if (left <= 0) {
      stopRest();
      beep();
      speak('Time', state.settings.speak);
    }
  };
  tick();
  restTimer = setInterval(tick, 250);
  syncScreenLock();
}

function stopRest() {
  if (restTimer) clearInterval(restTimer);
  restTimer = null;
  $('#rest-timer').hidden = true;
  syncScreenLock();
}

// ---------------------------------------------------------------------------
// Handling what was said
// ---------------------------------------------------------------------------

function lastSet() {
  if (!session || !session.sets.length) return null;
  return session.sets[session.sets.length - 1];
}

function handleUtterance(raw, source = 'voice') {
  const results = parseUtterance(raw, {
    currentExerciseId,
    lastSet: lastSet(),
    unitPref: unit(),
  });
  for (const result of results) dispatch(result, raw, source);
  renderWorkout();
  renderTrends();
  renderSheet();
}

function dispatch(result, raw, source) {
  if (result.type === 'set') return logSet(result, source);
  if (result.type === 'focus') return focusExercise(result);
  if (result.type === 'command') return runCommand(result);

  toast(`<div class="toast-heard">heard “${escapeHTML(result.raw || raw)}”</div>
    <div class="toast-main">${escapeHTML(result.reason)}</div>
    <p class="small muted">Try “bench press 185 for 8”. Naming the exercise once is enough — after that just say the numbers.</p>`,
  { level: 'bad' });
  speak("Didn't catch that", state.settings.speak);
  return null;
}

function logSet(result, source) {
  openSession();
  const payload = { ...result.set, source, confidence: result.confidence };
  const res = store.addSet(state, session.id, payload);
  state = res.state;
  refreshSessionRef();
  const saved = res.set;
  lastSetRef = { sessionId: session.id, setId: saved.id };
  currentExerciseId = saved.exerciseId || currentExerciseId;
  persist();

  const flags = reviewSet(saved, {
    sessions: state.sessions,
    currentSession: session,
    settings: state.settings,
  });

  const low = result.confidence < 0.7;
  const body = `<div class="toast-heard">heard “${escapeHTML(saved.raw || '')}”</div>
    <div class="toast-main">${escapeHTML(saved.exerciseName)} — ${escapeHTML(describeSet(saved))}${saved.rpe !== undefined ? ` @ RPE ${saved.rpe}` : ''}</div>
    ${result.warnings.map((w) => `<p class="small muted">${escapeHTML(w)}</p>`).join('')}
    ${low ? '<p class="small muted">Low confidence — check it.</p>' : ''}
    ${flags.map(flagHTML).join('')}`;

  toast(body, {
    level: flags.some((f) => f.level === 'stop') ? 'bad' : low ? 'low' : 'ok',
    actions: [
      { label: 'Edit', run: () => openEdit(saved.id) },
      { label: 'Undo', run: () => undoLast() },
    ],
  });

  const spoken = [`${saved.exerciseName}, ${describeSet(saved).replace('×', 'by')}`];
  const worst = flags.find((f) => f.level === 'stop') || flags.find((f) => f.level === 'caution');
  if (worst) spoken.push(worst.title);
  speak(spoken.join('. '), state.settings.speak);

  if (state.settings.autoRest && saved.kind !== 'distance_duration') {
    const ex = getExercise(saved.exerciseId);
    startRest(ex && ex.compound ? 150 : 75, 'Rest');
  }
  return saved;
}

function focusExercise(result) {
  currentExerciseId = result.exerciseId || currentExerciseId;
  openSession();
  const tip = currentExerciseId
    ? advise({
      exerciseId: currentExerciseId,
      sessions: state.sessions,
      currentSession: session,
      settings: state.settings,
    })
    : null;
  toast(`<div class="toast-main">On to ${escapeHTML(result.exerciseName)}</div>
    ${tip ? `<p class="small muted">${escapeHTML(tip.headline)} — ${escapeHTML(tip.detail)}</p>` : ''}`);
  if (tip) speak(speakAdvice(tip), state.settings.speak);
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
  toast(`<div class="toast-main">Removed ${escapeHTML(victim.exerciseName)} ${escapeHTML(describeSet(victim))}</div>`);
  speak('Removed', state.settings.speak);
  renderWorkout();
  renderTrends();
  renderSheet();
}

function runCommand(result) {
  refreshSessionRef();
  switch (result.command) {
    case 'undo':
      return undoLast();

    case 'rest':
      startRest(result.seconds);
      speak(`Resting ${result.seconds} seconds`, state.settings.speak);
      return null;

    case 'note': {
      if (!session) openSession();
      const notes = [session.notes, result.text].filter(Boolean).join(' · ');
      state = store.setNotes(state, session.id, notes);
      refreshSessionRef();
      persist();
      toast(`<div class="toast-main">Noted</div><p class="small muted">${escapeHTML(result.text)}</p>`);
      return null;
    }

    case 'coach': {
      if (!currentExerciseId) {
        toast('<div class="toast-main">Tell me the exercise first</div><p class="small muted">Say “next up squats” and I’ll pull your history.</p>', { level: 'low' });
        return null;
      }
      openSession();
      const tip = advise({
        exerciseId: currentExerciseId,
        sessions: state.sessions,
        currentSession: session,
        settings: state.settings,
      });
      toast(`<div class="toast-main">${escapeHTML(tip.headline)}</div><p class="small muted">${escapeHTML(tip.detail)}</p>`);
      speak(speakAdvice(tip), state.settings.speak);
      return null;
    }

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
        rpe: o.rpe ?? undefined,
        rir: o.rir ?? undefined,
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
      toast(`<div class="toast-main">Corrected → ${escapeHTML(describeSet(fixed))}</div>`);
      speak('Fixed', state.settings.speak);
      return null;
    }

    case 'finish':
    case 'new': {
      if (!session || !session.sets.length) {
        toast('<div class="toast-main">No sets logged yet</div>', { level: 'low' });
        return null;
      }
      const stats = A.sessionStats(session, state.settings);
      state = store.endSession(state, session.id);
      persist();
      session = null;
      currentExerciseId = null;
      lastSetRef = null;
      stopRest();
      toast(`<div class="toast-main">Workout saved</div>
        <p class="small muted">${stats.hardSets} sets · ${fmtVolume(stats.volume)} ${unit()} moved · ~${stats.calories.kcal} kcal. It’s in the Sheet tab and the charts.</p>`);
      speak(`Workout saved. ${stats.hardSets} sets.`, state.settings.speak);
      if (result.command === 'new') openSession();
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering: Workout tab
// ---------------------------------------------------------------------------

function renderWorkout() {
  refreshSessionRef();
  renderSessionMeta();
  renderCoach();
  renderTodaySummary();
  renderTodaySets();
}

function renderSessionMeta() {
  const meta = $('#session-meta');
  if (!session || !session.sets.length) {
    meta.textContent = state.sessions.length ? `${state.sessions.length} workouts logged` : '';
    return;
  }
  const mins = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000);
  const stats = A.sessionStats(session, state.settings);
  meta.textContent = `${mins} min · ${stats.hardSets} sets`;
}

function renderCoach() {
  const host = $('#coach-card');
  if (!currentExerciseId) {
    host.innerHTML = `<div class="coach-kicker">Coach</div>
      <div class="coach-headline">Name a lift to get started</div>
      <p class="coach-detail">Say the exercise once — “bench press 185 for 8” — and from then on the numbers alone are enough.
      After each set I’ll tell you what to put on the bar next, based on your own history.</p>`;
    return;
  }

  const tip = advise({
    exerciseId: currentExerciseId,
    sessions: state.sessions,
    currentSession: session || { id: null, sets: [] },
    settings: state.settings,
  });
  const ex = getExercise(currentExerciseId);
  const sFlags = session ? sessionFlags({
    sessions: state.sessions, currentSession: session, settings: state.settings,
  }) : [];

  host.innerHTML = `
    <div class="coach-kicker">Next set · ${escapeHTML(ex ? ex.name : 'current lift')}</div>
    <div class="coach-headline">${escapeHTML(tip.headline)}</div>
    <p class="coach-detail">${escapeHTML(tip.detail)}</p>
    ${tip.warmup.length ? `<div class="coach-warmup">${tip.warmup.map((w) => `<span class="chip">${fmtNum(w.weight)}${unit()} × ${w.reps}${w.note ? ` · ${w.note}` : ''}</span>`).join('')}</div>` : ''}
    <div class="coach-warmup">
      <span class="chip">rest ${fmtDuration(tip.restSec)}</span>
      ${tip.target && tip.target.sets ? `<span class="chip">${tip.target.sets} set${tip.target.sets === 1 ? '' : 's'}</span>` : ''}
    </div>
    ${[...tip.flags, ...sFlags].map(flagHTML).join('')}
    <p class="coach-basis">Based on: ${escapeHTML(tip.basis.join(' · '))}</p>`;
}

function renderTodaySummary() {
  const host = $('#today-summary');
  if (!session || !session.sets.length) { host.innerHTML = ''; return; }
  const s = A.sessionStats(session, state.settings);
  const cells = [
    ['Sets', s.hardSets],
    ['Reps', s.reps],
    [`Volume (${unit()})`, fmtVolume(s.volume)],
    ['Est. kcal', s.calories.kcal],
    ['Exercises', s.exercises],
  ];
  host.innerHTML = cells.map(([label, value]) => `<div class="stat">
    <div class="stat-value">${escapeHTML(String(value))}</div>
    <div class="stat-label">${escapeHTML(label)}</div></div>`).join('');
}

function renderTodaySets() {
  const host = $('#today-sets');
  if (!session || !session.sets.length) {
    host.innerHTML = '<p class="empty-note">Nothing logged yet today. Hit the mic and say your first set.</p>';
    return;
  }

  // Group consecutive sets of the same exercise, the way a lifter thinks.
  const groups = [];
  for (const set of session.sets) {
    const key = set.exerciseId || set.exerciseName;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sets.push(set);
    else groups.push({ key, name: set.exerciseName, sets: [set] });
  }

  host.innerHTML = groups.map((g) => {
    const vol = g.sets.reduce((n, s) => n + A.setVolume(s, state.settings), 0);
    const top = g.sets.reduce((m, s) => Math.max(m, A.e1rmValue(s, state.settings) || 0), 0);
    return `<div class="set-group">
      <div class="set-group-head">
        <span class="set-group-name">${escapeHTML(g.name)}</span>
        <span class="set-group-meta">${g.sets.length} set${g.sets.length > 1 ? 's' : ''}${vol ? ` · ${fmtVolume(vol)} ${unit()}` : ''}${top ? ` · e1RM ${Math.round(top)}` : ''}</span>
      </div>
      <ul class="set-list">
        ${g.sets.map((s, i) => `<li><button class="set-row" type="button" data-set="${s.id}">
          <span class="set-index">${i + 1}</span>
          <span class="set-main">${escapeHTML(describeSet(s))}</span>
          <span class="spacer"></span>
          <span class="set-sub">${s.rpe !== undefined ? `RPE ${s.rpe}` : ''}${s.confidence !== undefined && s.confidence < 0.7 ? ' · check' : ''}</span>
        </button></li>`).join('')}
      </ul>
    </div>`;
  }).join('');

  $$('#today-sets .set-row').forEach((btn) => {
    btn.addEventListener('click', () => openEdit(btn.dataset.set));
  });
}

// ---------------------------------------------------------------------------
// Edit dialog
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
  for (const name of ['weight', 'reps', 'sets', 'rpe', 'durationSec', 'distanceM']) {
    form.elements[name].value = set[name] ?? '';
  }

  const onClose = () => {
    dialog.removeEventListener('close', onClose);
    const action = dialog.returnValue;
    if (action === 'cancel' || !action) return;
    if (action === 'delete') {
      state = store.deleteSet(state, owner.id, setId);
    } else {
      const patch = {};
      for (const name of ['weight', 'reps', 'sets', 'rpe', 'durationSec', 'distanceM']) {
        const v = form.elements[name].value;
        patch[name] = v === '' ? undefined : Number(v);
      }
      if (patch.rpe !== undefined) patch.rir = Math.max(0, 10 - patch.rpe);
      patch.confidence = 1;
      patch.source = 'edited';
      state = store.updateSet(state, owner.id, setId, patch);
    }
    refreshSessionRef();
    persist();
    renderWorkout();
    renderTrends();
    renderSheet();
  };
  dialog.addEventListener('close', onClose);
  dialog.showModal();
}

// ---------------------------------------------------------------------------
// Rendering: Trends tab
// ---------------------------------------------------------------------------

function loggedExercises() {
  const counts = new Map();
  for (const s of state.sessions) {
    for (const set of s.sets) {
      if (!set.exerciseId) continue;
      counts.set(set.exerciseId, (counts.get(set.exerciseId) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ id, n, name: (getExercise(id) || {}).name || id }));
}

function inRange(sessions, days) {
  if (!days) return sessions;
  const cutoff = Date.now() - days * 86400000;
  return sessions.filter((s) => new Date(s.date).getTime() >= cutoff);
}

function renderTrends() {
  const select = $('#trend-exercise');
  const options = loggedExercises();
  const previous = select.value;
  select.innerHTML = options.length
    ? options.map((o) => `<option value="${o.id}">${escapeHTML(o.name)} (${o.n})</option>`).join('')
    : '<option value="">— nothing logged yet —</option>';
  if (options.some((o) => o.id === previous)) select.value = previous;
  else if (options.some((o) => o.id === currentExerciseId)) select.value = currentExerciseId;

  const days = Number($('#trend-range').value || 90);
  const scoped = inRange(state.sessions, days);
  const exId = select.value;

  // Headline stats
  const totalVol = scoped.reduce((n, s) => n + A.sessionStats(s, state.settings).volume, 0);
  const totalKcal = scoped.reduce((n, s) => n + A.sessionCalories(s, state.settings).kcal, 0);
  const ratio = A.acwr(state.sessions, state.settings);
  $('#headline-stats').innerHTML = [
    ['Workouts', scoped.length],
    [`Volume (${unit()})`, fmtVolume(totalVol)],
    ['Est. kcal', totalKcal],
    ['Load ratio', ratio.ratio ?? '—'],
  ].map(([l, v]) => `<div class="stat"><div class="stat-value">${escapeHTML(String(v))}</div><div class="stat-label">${escapeHTML(l)}</div></div>`).join('');

  // Estimated 1RM for the chosen lift
  const exName = exId ? (getExercise(exId) || {}).name : '';
  const e1rm = exId ? A.e1rmSeries(scoped, exId, state.settings) : [];
  renderLine($('#chart-e1rm'), {
    title: exId ? `${exName} — estimated 1RM` : 'Estimated 1RM',
    subtitle: e1rm.length > 1
      ? `${fmtNum(e1rm[0].value)} → ${fmtNum(e1rm.at(-1).value)} ${unit()} (${e1rm.at(-1).value >= e1rm[0].value ? '+' : ''}${fmtNum(e1rm.at(-1).value - e1rm[0].value)})`
      : 'best set of each session, Epley/Brzycki estimate',
    points: e1rm.map((p) => ({ date: p.date, value: p.value, note: describeSet(p.set) })),
    format: (v) => `${Math.round(v)}`,
  });

  // Volume for the chosen lift
  const exVol = exId ? A.volumeSeries(scoped, exId, state.settings) : [];
  renderBars($('#chart-ex-volume'), {
    title: exId ? `${exName} — volume per session` : 'Volume per session',
    subtitle: `weight × reps, in ${unit()}`,
    bars: exVol.map((p) => ({ label: p.date.slice(5), value: p.value, tipLabel: p.date })),
    format: fmtVolume,
  });

  // Whole-body weekly tonnage
  const weekly = A.weeklyVolume(scoped, state.settings);
  renderBars($('#chart-weekly'), {
    title: 'Weekly training volume',
    subtitle: 'total tonnage across every lift — the progressive-overload picture',
    bars: weekly.map((w) => ({
      label: w.week.slice(5), value: w.volume, tipLabel: `week of ${w.week}`,
      sub: `${w.sessions} sessions · ${w.sets} sets`,
    })),
    format: fmtVolume,
  });

  // Calories
  renderBars($('#chart-calories'), {
    title: 'Estimated energy per session',
    subtitle: `MET model at ${fmtNum(state.settings.bodyweight)} ${unit()} bodyweight — an estimate, not a measurement`,
    bars: A.caloriesSeries(scoped, state.settings).map((p) => ({ label: p.date.slice(5), value: p.value, tipLabel: p.date })),
    format: (v) => `${Math.round(v)}`,
  });

  // Muscle balance
  const muscles = A.muscleWeeklySets(state.sessions, state.settings, 7);
  renderHBars($('#chart-muscles'), {
    title: 'Hard sets per muscle, last 7 days',
    subtitle: `secondary work counts half · ${RULES.weeklySetsPerMuscleCap}+ is usually past the point of return`,
    rows: Object.entries(muscles).sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ label: m, value: v })),
    format: (v) => fmtNum(v),
    capAt: RULES.weeklySetsPerMuscleCap,
  });

  renderPRs();
}

function renderPRs() {
  const host = $('#pr-card');
  const prs = [...A.personalRecords(state.sessions, state.settings).values()]
    .filter((p) => p.bestE1rm || p.longest || p.farthest)
    .sort((a, b) => (b.bestE1rm?.value || 0) - (a.bestE1rm?.value || 0))
    .slice(0, 12);

  if (!prs.length) {
    host.innerHTML = '<h2>Personal records</h2><p class="empty-note">Log a few sessions and your bests show up here.</p>';
    return;
  }
  host.innerHTML = '<h2>Personal records</h2>';
  renderTable(host,
    ['Exercise', 'Best est. 1RM', 'Heaviest', 'Most reps', 'When'],
    prs.map((p) => [
      escapeHTML(p.name),
      p.bestE1rm ? `${Math.round(p.bestE1rm.value)} ${unit()}` : '—',
      p.heaviest ? `${fmtNum(p.heaviest.value)} ${unit()}` : (p.longest ? fmtDuration(p.longest.value) : '—'),
      p.bestReps ? p.bestReps.value : (p.farthest ? fmtDistance(p.farthest.value) : '—'),
      A.dayKey((p.bestE1rm || p.heaviest || p.longest || p.farthest).date),
    ]));
}

// ---------------------------------------------------------------------------
// Rendering: Sheet tab
// ---------------------------------------------------------------------------

function renderSheet() {
  const host = $('#sheet-host');
  const filter = ($('#sheet-filter').value || '').trim().toLowerCase();
  const rows = [];

  for (const s of [...state.sessions].sort((a, b) => new Date(b.date) - new Date(a.date))) {
    for (const set of [...s.sets].reverse()) {
      if (filter && !`${set.exerciseName}`.toLowerCase().includes(filter)) continue;
      rows.push([
        A.dayKey(set.ts || s.date),
        escapeHTML(set.exerciseName),
        set.sets || 1,
        set.reps ?? '',
        set.weight !== undefined ? fmtNum(set.weight) : (set.bodyweight ? 'BW' : ''),
        set.rpe ?? '',
        set.durationSec ? fmtDuration(set.durationSec) : '',
        set.distanceM ? fmtDistance(set.distanceM) : '',
        A.e1rmValue(set, state.settings) ? Math.round(A.e1rmValue(set, state.settings)) : '',
        Math.round(A.setVolume(set, state.settings)) || '',
        set.raw ? escapeHTML(set.raw) : '',
      ]);
    }
  }

  host.innerHTML = '';
  if (!rows.length) {
    host.innerHTML = '<p class="empty-note" style="padding:1rem">No rows yet. Log a workout, or load the sample history from Settings.</p>';
    return;
  }
  renderTable(host,
    ['Date', 'Exercise', 'Sets', 'Reps', `Weight (${unit()})`, 'RPE', 'Time', 'Distance', 'Est. 1RM', 'Volume', 'What you said'],
    rows.slice(0, 500));
  if (rows.length > 500) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.style.padding = '.6rem 1rem';
    note.textContent = `Showing the newest 500 of ${rows.length} rows — export the CSV for the lot.`;
    host.appendChild(note);
  }
}

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

// ---------------------------------------------------------------------------
// Rendering: Settings
// ---------------------------------------------------------------------------

function renderSettings() {
  $('#set-unit').value = state.settings.unit;
  $('#set-bodyweight').value = state.settings.bodyweight;
  $('#bw-unit').textContent = `(${state.settings.unit})`;
  $('#set-speak').checked = state.settings.speak;
  $('#set-autorest').checked = state.settings.autoRest;

  $('#rules-list').innerHTML = [
    `Flags a working weight more than <b>${Math.round(RULES.maxLoadJumpPct * 100)}%</b> above anything you have logged in 60 days.`,
    `Calls the end of an exercise when output fades <b>${Math.round(RULES.dropOffPct * 100)}%</b> below your best set that day, or reps drop by <b>${RULES.repDropForStop}</b> at the same load.`,
    `Nudges you off a compound past <b>${RULES.maxSetsPerExercise}</b> hard sets in one session.`,
    `Warns when a muscle passes <b>${RULES.weeklySetsPerMuscleCap}</b> hard sets in a week, or gets hit again inside <b>${RULES.recoveryHours}h</b>.`,
    `Watches the ratio of this week's tonnage to your 4-week average and flags above <b>${RULES.acwrSpike}</b>.`,
    `Suggests a <b>${Math.round((1 - RULES.deloadFactor) * 100)}%</b> deload when estimated max has been flat for <b>${RULES.stagnationSessions}</b> sessions.`,
    'Progression is double-progression: earn the top of the rep range at an easy RPE, then add one increment and start again at the bottom.',
  ].map((r) => `<div>${r}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const recognizer = new Recognizer({
  onInterim: (t) => { $('#transcript').textContent = t; },
  onFinal: (t) => {
    $('#transcript').textContent = '';
    handleUtterance(t, 'voice');
  },
  onState: (s) => {
    syncScreenLock();
    const mic = $('#mic');
    mic.setAttribute('aria-pressed', s === 'listening' ? 'true' : 'false');
    $('#mic-status').textContent = s === 'listening'
      ? 'Listening — say your set.'
      : s === 'blocked'
        ? 'Microphone blocked. Type instead, or allow the mic in site settings.'
        : 'Tap the mic, then just talk.';
  },
  onError: (msg) => toast(`<div class="toast-main">${escapeHTML(msg)}</div>`, { level: 'low' }),
});

function wire() {
  $('#mic').addEventListener('click', () => {
    // Some browsers need a user gesture before speech synthesis works at all.
    speak('', state.settings.speak);
    recognizer.toggle();
  });

  if (!speechSupported) {
    $('#mic').disabled = true;
    $('#mic-status').textContent = speechUnavailableReason();
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
  $('#finish-btn').addEventListener('click', () => {
    runCommand({ command: 'finish' });
    renderWorkout(); renderTrends(); renderSheet();
  });
  $('#rest-skip').addEventListener('click', stopRest);

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t.id === `tab-${btn.dataset.tab}`));
      if (btn.dataset.tab === 'trends') renderTrends();
      if (btn.dataset.tab === 'sheet') renderSheet();
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

  $('#trend-exercise').addEventListener('change', renderTrends);
  $('#trend-range').addEventListener('change', renderTrends);
  $('#sheet-filter').addEventListener('input', renderSheet);

  $('#export-sets').addEventListener('click', () => download(`voicelift-sets-${stamp()}.csv`, store.toCSV(state), 'text/csv'));
  $('#export-sessions').addEventListener('click', () => download(`voicelift-sessions-${stamp()}.csv`, store.toSessionCSV(state), 'text/csv'));
  $('#export-json').addEventListener('click', () => download(`voicelift-backup-${stamp()}.json`, store.toJSON(state), 'application/json'));

  $('#set-unit').addEventListener('change', (e) => {
    state = store.updateSettings(state, { unit: e.target.value });
    persist(); renderSettings(); renderWorkout(); renderTrends(); renderSheet();
  });
  $('#set-bodyweight').addEventListener('change', (e) => {
    state = store.updateSettings(state, { bodyweight: Number(e.target.value) || 180 });
    persist(); renderTrends(); renderWorkout();
  });
  $('#set-speak').addEventListener('change', (e) => {
    state = store.updateSettings(state, { speak: e.target.checked }); persist();
  });
  $('#set-autorest').addEventListener('change', (e) => {
    state = store.updateSettings(state, { autoRest: e.target.checked }); persist();
  });

  $('#load-sample').addEventListener('click', () => {
    if (state.sessions.length && !confirm('This replaces what is currently logged. Export a backup first?\n\nOK to replace, Cancel to keep your data.')) return;
    const sample = store.sampleState();
    state = { ...sample, settings: state.settings };
    session = null;
    currentExerciseId = null;
    persist();
    renderAll();
    toast('<div class="toast-main">Sample history loaded</div><p class="small muted">13 workouts over six weeks, so the charts and the coach have something to work with.</p>');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state = store.importJSON(await file.text());
      session = null;
      persist();
      renderAll();
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
    renderAll();
  });

  // Keyboard: space toggles the mic when not typing.
  document.addEventListener('keydown', (ev) => {
    if (ev.code !== 'Space' || ev.target.matches('input, textarea, select, button')) return;
    ev.preventDefault();
    recognizer.toggle();
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

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstallState();
    toast('<div class="toast-main">Installed</div><p class="small muted">Open it from your home screen from now on.</p>');
  });

  document.addEventListener('visibilitychange', handleVisibility);

  window.addEventListener('offline', () => {
    toast('<div class="toast-main">Offline</div><p class="small muted">Logging still works — everything is stored on the device. Voice recognition needs a connection in most browsers.</p>', { level: 'low' });
  });

  setInterval(renderSessionMeta, 30000);
}

// ---------------------------------------------------------------------------
// Installability, offline, and staying alive on a phone
// ---------------------------------------------------------------------------

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function renderInstallState() {
  const state = $('#install-state');
  const hint = $('#install-hint');
  const btn = $('#install-btn');

  if (isStandalone()) {
    state.textContent = 'Installed. You are running the home-screen app.';
    btn.hidden = true;
  } else if (installPrompt) {
    state.textContent = 'Not installed yet.';
    btn.hidden = false;
  } else if (isIOS()) {
    state.textContent = 'Not installed yet.';
    btn.hidden = true;
    hint.textContent = 'On iPhone: tap the Share button in Safari, then "Add to Home Screen". '
      + 'Installing matters here — the home-screen app gets a full screen and keeps the mic '
      + 'behaving better than a browser tab.';
    return;
  } else {
    state.textContent = 'Not installed. Your browser has not offered an install prompt yet — '
      + 'it usually appears after a visit or two, or in the address bar menu.';
    btn.hidden = true;
  }

  hint.textContent = wakeLockSupported
    ? 'Once installed it works with no signal, and the screen is held awake while the mic is live.'
    : 'Once installed it works with no signal. This browser has no Wake Lock support, so set your '
      + 'screen timeout longer before a session.';
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no service worker, and that is fine — it is a dev-only case.
  if (location.protocol === 'file:') return;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        // A worker that installs while one is already in control is an update,
        // not a first run.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          toast('<div class="toast-main">A new version is ready</div>'
            + '<p class="small muted">Reload to pick it up. Your log is untouched either way.</p>', {
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

/**
 * Phones suspend a backgrounded tab, and iOS tears down speech recognition
 * outright when the screen locks. Stand the mic down cleanly on the way out and
 * put it back when the user returns, rather than leaving a dead recogniser that
 * looks live.
 */
function handleVisibility() {
  if (document.visibilityState === 'hidden') {
    if (recognizer.wanted) {
      resumeMicOnReturn = true;
      recognizer.stop();
    }
    return;
  }
  if (resumeMicOnReturn) {
    resumeMicOnReturn = false;
    recognizer.start();
    toast('<div class="toast-main">Mic restarted</div>'
      + '<p class="small muted">Recognition stops when the screen locks — that is the browser, not the app. '
      + 'Keep the screen on mid-workout and it stays listening.</p>', { level: 'low', ttl: 8000 });
  }
  syncScreenLock();
}

/** Deep links from the home-screen shortcuts: ?listen=1, ?tab=trends */
function applyLaunchParams() {
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  if (tab && $(`.tab-btn[data-tab="${CSS.escape(tab)}"]`)) {
    $(`.tab-btn[data-tab="${CSS.escape(tab)}"]`).click();
  }
  if (params.get('listen') === '1' && speechSupported) recognizer.start();
  if (params.size) history.replaceState(null, '', location.pathname);
}

function renderAll() {
  renderWorkout();
  renderTrends();
  renderSheet();
  renderSettings();
  renderInstallState();
}

function boot() {
  const theme = localStorage.getItem('voicelift.theme');
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  session = store.currentSession(state);
  if (session && session.sets.length) {
    currentExerciseId = session.sets[session.sets.length - 1].exerciseId;
    lastSetRef = { sessionId: session.id, setId: session.sets[session.sets.length - 1].id };
  }
  wire();
  renderAll();
  registerServiceWorker();
  applyLaunchParams();
}

boot();

// Exposed for the dev console and for the smoke test in test/.
window.VoiceLift = {
  get state() { return state; },
  handleUtterance,
  parseUtterance,
  EXERCISES,
};
