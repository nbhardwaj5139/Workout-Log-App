/**
 * Web Speech API wrapper.
 *
 * Continuous recognition is unreliable by design: browsers stop the stream on
 * silence, on tab blur, and after network hiccups. The Recognizer restarts
 * itself whenever the user still wants to be listening, which is what makes
 * hands-free logging survive a whole workout.
 *
 * Everything degrades: if recognition is unavailable the app still takes typed
 * input through the same parser, and the UI says why the mic is missing.
 */

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export const speechSupported = Boolean(SR);

export function speechUnavailableReason() {
  if (SR) return null;
  if (typeof window === 'undefined') return 'No browser environment.';
  const ua = navigator.userAgent;
  if (/Firefox/.test(ua)) return 'Firefox does not ship the Web Speech API. Use Chrome, Edge, or Safari for voice — typing still works here.';
  if (!window.isSecureContext) return 'Speech recognition needs HTTPS (or localhost). Serve this page over https and the mic will appear.';
  return 'This browser has no speech recognition. Typing still works.';
}

export class Recognizer {
  constructor({ onInterim, onFinal, onState, onError, lang = 'en-US' } = {}) {
    this.onInterim = onInterim || (() => {});
    this.onFinal = onFinal || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.lang = lang;
    this.wanted = false;
    this.rec = null;
    this.restarts = 0;
  }

  get supported() { return speechSupported; }

  build() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const said = result[0].transcript.trim();
        if (result.isFinal) {
          if (said) {
            this.restarts = 0;
            const alts = [];
            for (let a = 0; a < result.length; a += 1) alts.push(result[a].transcript.trim());
            this.onFinal(said, { confidence: result[0].confidence, alternatives: alts });
          }
        } else {
          interim += ` ${said}`;
        }
      }
      if (interim.trim()) this.onInterim(interim.trim());
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wanted = false;
        this.onState('blocked');
        this.onError('Microphone permission was denied. Allow it in the browser’s site settings, or type your sets instead.');
        return;
      }
      this.onError(`Speech error: ${event.error}. Falling back to typing is always available.`);
    };

    rec.onend = () => {
      if (!this.wanted) { this.onState('idle'); return; }
      // Browsers end the stream on silence; get straight back on the mic.
      this.restarts += 1;
      if (this.restarts > 60) {
        this.wanted = false;
        this.onState('idle');
        this.onError('Speech recognition kept dropping. Tap the mic to try again.');
        return;
      }
      setTimeout(() => {
        if (!this.wanted) return;
        try { rec.start(); } catch { /* already starting */ }
      }, 250);
    };

    rec.onstart = () => this.onState('listening');
    return rec;
  }

  start() {
    if (!SR) { this.onError(speechUnavailableReason()); return false; }
    this.wanted = true;
    this.restarts = 0;
    if (!this.rec) this.rec = this.build();
    try {
      this.rec.start();
    } catch {
      // start() throws if it is already running — that is fine.
    }
    this.onState('listening');
    return true;
  }

  stop() {
    this.wanted = false;
    if (this.rec) {
      try { this.rec.stop(); } catch { /* not running */ }
    }
    this.onState('idle');
  }

  toggle() {
    if (this.wanted) { this.stop(); return false; }
    return this.start();
  }
}

// ---------------------------------------------------------------------------
// Speaking back
// ---------------------------------------------------------------------------

let voice = null;

function pickVoice() {
  if (voice || typeof speechSynthesis === 'undefined') return voice;
  const all = speechSynthesis.getVoices();
  voice = all.find((v) => /en[-_]US/i.test(v.lang) && /natural|google|samantha/i.test(v.name))
    || all.find((v) => /^en/i.test(v.lang))
    || all[0] || null;
  return voice;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener?.('voiceschanged', () => { voice = null; pickVoice(); });
}

/**
 * Say something back. Kept short on purpose — in a gym, a long sentence is
 * finished after you have already started the next set.
 */
export function speak(phrase, enabled = true) {
  if (!enabled || !phrase || typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(phrase);
    const v = pickVoice();
    if (v) utter.voice = v;
    utter.rate = 1.05;
    utter.pitch = 1;
    speechSynthesis.speak(utter);
  } catch {
    // Speaking is a nicety; never let it break logging.
  }
}

export function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch { /* noop */ }
}
