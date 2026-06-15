// MOO-FO audio manager. WebAudio playback of the procedurally generated WAVs
// in assets/audio/. No imports needed — fully self-contained.
//
//   const audio = new AudioManager();
//   await audio.init();                      // after first user gesture
//   audio.play('moo1', { volume: 0.8, ratejitter: 0.06 });
//   audio.startLoop('ufo_hum', { volume: 0.5 });
//   audio.setLoopVolume('ufo_hum', 0.9);
//   audio.stopLoop('ufo_hum');
//   audio.setMuted(true);

const SOUND_NAMES = [
  'ufo_hum', 'beam', 'warp',
  'moo1', 'moo2', 'moo3',
  'abduct', 'golden', 'chicken',
  'gunshot', 'hit', 'explosion',
  'tick', 'combo', 'click',
  'ufo_buy', 'ufo_equip', 'beam_buy', 'beam_equip',
  'start', 'win', 'lose',
  'jingle', 'waterfall',
  'bark', 'baa', 'quack',
  'scream', 'tractor', 'hoot',
  'horse',
];

const MUTE_KEY = 'moofo-muted';
const MAX_ONESHOTS = 12;     // simultaneous one-shot cap (mobile-friendly)
const MUTE_RAMP = 0.03;      // s — master gain ramp on mute/unmute
const LOOP_VOL_RAMP = 0.08;  // s — setLoopVolume smoothing
const LOOP_STOP_FADE = 0.1;  // s — stopLoop fade-out

export class AudioManager {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._buffers = new Map();   // name -> AudioBuffer
    this._loops = new Map();     // name -> { source, gain }
    this._initPromise = null;
    this._muted = false;
    this._oneShots = 0;
    this._warned = new Set();
  }

  /** Create the AudioContext and fetch+decode every sound. Safe to call more
   *  than once (returns the same promise). Call after a user gesture. */
  async init() {
    if (!this._initPromise) this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this._ctx = new Ctx();
    // Call sites guarantee a user gesture happened, but resume defensively.
    try { await this._ctx.resume(); } catch (_) { /* ignore */ }

    // Restore persisted mute state before anything plays.
    try { this._muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { /* ignore */ }
    this._master = this._ctx.createGain();
    this._master.gain.value = this._muted ? 0 : 1;
    this._master.connect(this._ctx.destination);

    // Load everything in parallel; a missing/corrupt file must never break
    // the game — it just logs one warning and that sound stays silent.
    const results = await Promise.allSettled(SOUND_NAMES.map(async (name) => {
      const res = await fetch(`assets/audio/${name}.wav`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const buffer = await new Promise((resolve, reject) => {
        const p = this._ctx.decodeAudioData(bytes, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      });
      this._buffers.set(name, buffer);
    }));
    results.forEach((r, i) => {
      if (r.status === 'rejected') this._warnOnce(SOUND_NAMES[i], r.reason);
    });
  }

  _warnOnce(name, reason) {
    if (this._warned.has(name)) return;
    this._warned.add(name);
    console.warn(`[audio] sound "${name}" unavailable`, reason ?? '');
  }

  /** Fire-and-forget one-shot. ratejitter randomizes playbackRate by ±jitter. */
  play(name, { volume = 1, rate = 1, ratejitter = 0 } = {}) {
    const buffer = this._buffers.get(name);
    if (!this._ctx || !buffer) { this._warnOnce(name); return; }
    if (this._oneShots >= MAX_ONESHOTS) return;
    this._oneShots++;

    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value =
      Math.max(0.05, rate * (1 + (Math.random() * 2 - 1) * ratejitter));
    const gain = this._ctx.createGain();
    gain.gain.value = Math.max(0, volume);
    source.connect(gain);
    gain.connect(this._master);
    source.onended = () => {
      this._oneShots--;
      try { source.disconnect(); gain.disconnect(); } catch (_) { /* ignore */ }
    };
    source.start();
  }

  /** Start a seamless loop (ufo_hum, beam, waterfall). Idempotent: if the loop
   *  is already running this just ramps it to the requested volume. */
  startLoop(name, { volume = 1 } = {}) {
    if (!this._ctx) return;
    if (this._loops.has(name)) { this.setLoopVolume(name, volume); return; }
    const buffer = this._buffers.get(name);
    if (!buffer) { this._warnOnce(name); return; }

    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this._ctx.createGain();
    gain.gain.value = Math.max(0, volume);
    source.connect(gain);
    gain.connect(this._master);
    source.start();
    this._loops.set(name, { source, gain });
  }

  /** Smoothly retarget a running loop's volume (~80 ms ramp). */
  setLoopVolume(name, v) {
    const loop = this._loops.get(name);
    if (!loop) return;
    this._ramp(loop.gain.gain, Math.max(0, v), LOOP_VOL_RAMP);
  }

  /** Fade a loop out over ~100 ms, then stop and free it. */
  stopLoop(name) {
    const loop = this._loops.get(name);
    if (!loop) return;
    this._loops.delete(name); // allow an immediate clean restart
    this._ramp(loop.gain.gain, 0, LOOP_STOP_FADE);
    const stopAt = this._ctx.currentTime + LOOP_STOP_FADE + 0.02;
    try { loop.source.stop(stopAt); } catch (_) { /* ignore */ }
    loop.source.onended = () => {
      try { loop.source.disconnect(); loop.gain.disconnect(); } catch (_) { /* ignore */ }
    };
  }

  /** Mute/unmute via a smooth 30 ms master ramp; persisted to localStorage. */
  setMuted(b) {
    this._muted = !!b;
    try { localStorage.setItem(MUTE_KEY, this._muted ? '1' : '0'); } catch (_) { /* ignore */ }
    if (!this._ctx) return; // applied on init from storage
    if (!this._muted && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    this._ramp(this._master.gain, this._muted ? 0 : 1, MUTE_RAMP);
  }

  get muted() {
    return this._muted;
  }

  _ramp(param, target, dur) {
    const now = this._ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + dur);
  }
}
