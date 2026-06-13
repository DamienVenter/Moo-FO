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
  'start', 'win', 'lose',
  'music_title', 'music_play', 'music_chase',
];

// Names of the looping base-music tracks (not the chase layer, which is a
// simultaneous overlay rather than a selectable base track).
const MUSIC_BASE_NAMES = ['music_title', 'music_play'];
const MUSIC_CHASE_NAME = 'music_chase';

const MUTE_KEY = 'moofo-muted';
const MAX_ONESHOTS = 12;     // simultaneous one-shot cap (mobile-friendly)
const MUTE_RAMP = 0.03;      // s — master gain ramp on mute/unmute
const LOOP_VOL_RAMP = 0.08;  // s — setLoopVolume smoothing
const LOOP_STOP_FADE = 0.1;  // s — stopLoop fade-out
const MUSIC_LOOP_DUR = 16.0; // s — every music track is exactly this long, so
                             // base + chase stay phase-locked to a shared epoch

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

    // --- Music subsystem ---
    this._musicGain = null;       // master-music trim, under _master
    this._musicVolume = 1;        // setMusicVolume() target (pre-init safe)
    this._musicBase = null;       // { name, source, gain } current base loop
    this._musicChase = null;      // { source, gain } the chase overlay layer
    this._musicIntensity = 0;     // last-requested chase layer gain (0..1)
    this._pendingMusic = null;    // queued playMusic() before init
    this._musicEpoch = null;      // shared loop-phase reference (ctx time)
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

    // Dedicated music bus under _master (so mute applies, and music has its
    // own volume independent of SFX).
    this._musicGain = this._ctx.createGain();
    this._musicGain.gain.value = Math.max(0, this._musicVolume);
    this._musicGain.connect(this._master);

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

    // Apply any music requested before init finished.
    if (this._pendingMusic) {
      const { name, fade } = this._pendingMusic;
      this._pendingMusic = null;
      this.playMusic(name, { fade });
    }
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

  /** Start a seamless loop (ufo_hum, beam). Idempotent: if the loop is
   *  already running this just ramps it to the requested volume. */
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

  // -------------------------------------------------------------------------
  // Music subsystem
  //
  // Layout:  destination <- _master (mute) <- _musicGain (music trim)
  //                                              |- base loop  (gain)
  //                                              `- chase layer (gain)
  // All tracks are MUSIC_LOOP_DUR-second seamless loops. Base and chase are
  // started against ONE shared epoch (this._musicEpoch) and entered at the
  // matching loop phase, so they stay sample-aligned ("phase-locked") forever,
  // even when the base track is swapped out.
  // -------------------------------------------------------------------------

  /** Start `name` as the looping base track, crossfading from the current one.
   *  No-op if `name` is already the active base. Queues if called before init. */
  playMusic(name, { fade = 1.2 } = {}) {
    if (!MUSIC_BASE_NAMES.includes(name)) { this._warnOnce(name); return; }
    if (!this._ctx) { this._pendingMusic = { name, fade }; return; }
    if (this._musicBase && this._musicBase.name === name) return; // idempotent

    const buffer = this._buffers.get(name);
    if (!buffer) { this._warnOnce(name); return; }

    // Establish a shared loop epoch the first time any music starts.
    if (this._musicEpoch == null) this._musicEpoch = this._ctx.currentTime;

    // Fade out (and stop) whatever base is currently playing.
    const prev = this._musicBase;
    if (prev) this._stopVoice(prev, fade);

    // Start the new base, phase-aligned to the epoch, faded up from 0.
    const voice = this._startMusicVoice(name, buffer, 0);
    this._ramp(voice.gain.gain, 1, Math.max(0.001, fade));
    voice.name = name;
    this._musicBase = voice;

    // Ensure the chase layer is running (it always loops alongside the base,
    // its audible level controlled separately by setMusicIntensity).
    this._ensureChaseLayer();
  }

  /** Fade the chase tension LAYER's gain to v (0..1). It loops in sync with the
   *  base track. 0 = silent. Safe before init (remembered for when music starts). */
  setMusicIntensity(v, { fade = 0.8 } = {}) {
    const target = Math.max(0, Math.min(1, v));
    this._musicIntensity = target;
    if (!this._ctx) return;
    this._ensureChaseLayer();
    if (this._musicChase) {
      this._ramp(this._musicChase.gain.gain, target, Math.max(0.001, fade));
    }
  }

  /** Fade out and stop all music (base + chase layer). */
  stopMusic({ fade = 0.6 } = {}) {
    this._pendingMusic = null;
    this._musicIntensity = 0;
    if (!this._ctx) return;
    if (this._musicBase) { this._stopVoice(this._musicBase, fade); this._musicBase = null; }
    if (this._musicChase) { this._stopVoice(this._musicChase, fade); this._musicChase = null; }
    this._musicEpoch = null; // next playMusic() re-establishes the loop grid
  }

  /** Optional master-music trim (0..1+), independent of SFX. Default full. */
  setMusicVolume(v) {
    this._musicVolume = Math.max(0, v);
    if (!this._ctx || !this._musicGain) return;
    this._ramp(this._musicGain.gain, this._musicVolume, LOOP_VOL_RAMP);
  }

  /** Make sure the chase layer loop exists and tracks the requested intensity. */
  _ensureChaseLayer() {
    if (!this._ctx || this._musicChase) return;
    const buffer = this._buffers.get(MUSIC_CHASE_NAME);
    if (!buffer) { this._warnOnce(MUSIC_CHASE_NAME); return; }
    if (this._musicEpoch == null) this._musicEpoch = this._ctx.currentTime;
    this._musicChase = this._startMusicVoice(
      MUSIC_CHASE_NAME, buffer, this._musicIntensity);
  }

  /** Create + start a looping music BufferSource at the shared loop phase,
   *  routed through its own gain under _musicGain. Returns { source, gain }. */
  _startMusicVoice(name, buffer, startGain) {
    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this._ctx.createGain();
    gain.gain.value = Math.max(0, startGain);
    source.connect(gain);
    gain.connect(this._musicGain);
    // Enter the loop at the phase matching the shared epoch so all music
    // voices are sample-aligned regardless of when they (re)start.
    const elapsed = this._ctx.currentTime - this._musicEpoch;
    let phase = elapsed % MUSIC_LOOP_DUR;
    if (phase < 0) phase += MUSIC_LOOP_DUR;
    try { source.start(this._ctx.currentTime, phase); }
    catch (_) { try { source.start(); } catch (__) { /* ignore */ } }
    return { source, gain };
  }

  /** Fade a music voice's gain to 0 then stop+free it. */
  _stopVoice(voice, fade) {
    if (!voice) return;
    const f = Math.max(0.001, fade);
    this._ramp(voice.gain.gain, 0, f);
    const stopAt = this._ctx.currentTime + f + 0.02;
    try { voice.source.stop(stopAt); } catch (_) { /* ignore */ }
    voice.source.onended = () => {
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch (_) { /* ignore */ }
    };
  }

  _ramp(param, target, dur) {
    const now = this._ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + dur);
  }
}
