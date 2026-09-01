/**
 * Screen Wake Lock.
 *
 * Without this the phone dims and locks between sets, which kills speech
 * recognition and means unlocking with chalky hands mid-workout. The lock is
 * held only while it earns its battery cost — while the mic is live or a rest
 * timer is counting — and the OS drops it whenever the tab is backgrounded, so
 * it has to be re-acquired on every return to visibility.
 */

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

export class ScreenLock {
  constructor(onChange = () => {}) {
    this.sentinel = null;
    this.wanted = false;
    this.onChange = onChange;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.wanted) this.acquire();
      });
    }
  }

  get held() { return Boolean(this.sentinel); }

  async acquire() {
    this.wanted = true;
    if (!wakeLockSupported || this.sentinel || document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.onChange(false);
      });
      this.onChange(true);
    } catch {
      // Denied, low battery, or unsupported — the app still works, the screen
      // just sleeps on its own schedule.
      this.sentinel = null;
    }
  }

  async release() {
    this.wanted = false;
    if (!this.sentinel) return;
    try { await this.sentinel.release(); } catch { /* already gone */ }
    this.sentinel = null;
    this.onChange(false);
  }

  /** Hold the lock only while something actually needs it. */
  sync(shouldHold) {
    if (shouldHold) this.acquire();
    else this.release();
  }
}
