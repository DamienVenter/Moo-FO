// MOO-FO — Controls (Agent U)
// Unified keyboard + touch input. Exposes a single normalized `state`
// { x:-1..1, z:-1..1, beam:bool, warp:bool } that main.js feeds to the UFO.
//
// Conventions (per SPEC): +X = world east (screen right), pressing W/Up means
// "fly away from camera" = world -Z, S/Down = +Z. Diagonals are normalized so
// |(x,z)| <= 1. Keyboard and touch are merged additively then clamped.

import { IS_MOBILE } from './config.js';

const JOY_RADIUS = 56; // max knob travel in px (dynamic-origin virtual stick)

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

function div(cls, parent) {
  const d = document.createElement('div');
  d.className = cls;
  if (parent) parent.appendChild(d);
  return d;
}

export class Controls {
  constructor({ onPause } = {}) {
    this.onPause = typeof onPause === 'function' ? onPause : () => {};

    /** Normalized, combined keyboard+touch input. Mutated in place. */
    this.state = { x: 0, z: 0, beam: false, warp: false };

    /** Capability detection: touch events present AND coarse pointer. */
    this.isTouch = IS_MOBILE || (
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) &&
      !!window.matchMedia?.('(pointer: coarse)').matches
    );

    // --- internal input sources -----------------------------------------
    this._keys = new Set();        // currently held key codes
    this._joyId = null;            // pointerId driving the joystick
    this._joyOrigin = { x: 0, y: 0 };
    this._joyVec = { x: 0, z: 0 }; // -1..1 each, length <= 1
    this._beamHeld = false;        // touch BEAM button
    this._warpHeld = false;        // touch WARP button

    this._buildTouchDOM();
    this._bindKeyboard();
    this._bindTouch();
  }

  // ======================================================================
  // Public API
  // ======================================================================

  /** Show/hide the mobile control layer (joystick, BEAM/WARP, pause). */
  setTouchVisible(visible) {
    this.touchRoot.classList.toggle('mf-hidden', !visible);
    if (!visible) this._releaseAllTouch();
  }

  /** Fire cb exactly once on the next keydown or tap (menus). */
  anyKeyOnce(cb) {
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPtr, true);
      cb();
    };
    const onKey = (e) => {
      if (e.repeat || e.code === 'Escape' || e.code === 'KeyP') return; // don't eat pause
      done();
    };
    const onPtr = () => done();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPtr, true);
  }

  // ======================================================================
  // DOM
  // ======================================================================

  _buildTouchDOM() {
    const root = div('mf-touch mf-hidden');
    root.id = 'mf-touch';

    // Left half: dynamic-origin joystick capture zone.
    this._joyZone = div('mf-joy-zone', root);
    this._joyBase = div('mf-joy-base', this._joyZone);
    this._joyKnob = div('mf-joy-knob', this._joyBase);
    this._joyBase.style.display = 'none';

    // Bottom-right: BEAM + WARP hold buttons.
    const btns = div('mf-touch-btns', root);
    this._btnWarp = document.createElement('button');
    this._btnWarp.type = 'button';
    this._btnWarp.className = 'mf-hold-btn mf-hold-warp';
    this._btnWarp.innerHTML = '<span class="mf-hold-ico">⚡</span><span class="mf-hold-txt">WARP</span>';
    this._btnBeam = document.createElement('button');
    this._btnBeam.type = 'button';
    this._btnBeam.className = 'mf-hold-btn mf-hold-beam';
    this._btnBeam.innerHTML = '<span class="mf-hold-ico">🛸</span><span class="mf-hold-txt">BEAM</span>';
    btns.appendChild(this._btnWarp);
    btns.appendChild(this._btnBeam);

    // Top-center pause button.
    this._btnPause = document.createElement('button');
    this._btnPause.type = 'button';
    this._btnPause.className = 'mf-touch-pause';
    this._btnPause.setAttribute('aria-label', 'Pause');
    this._btnPause.textContent = '⏸';
    root.appendChild(this._btnPause);

    document.body.appendChild(root);
    this.touchRoot = root;

    // Belt & braces vs. browser gestures (CSS also sets touch-action:none).
    for (const el of [root, this._joyZone, this._btnBeam, this._btnWarp, this._btnPause]) {
      el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ======================================================================
  // Keyboard
  // ======================================================================

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (code === 'Escape' || code === 'KeyP') {
        if (!e.repeat) this.onPause();
        e.preventDefault();
        return;
      }
      if (MOVE_CODES.has(code)) {
        e.preventDefault();
        if (!this._keys.has(code)) {
          this._keys.add(code);
          this._recompute();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this._keys.delete(e.code)) this._recompute();
    });

    // Keys must never stick when focus leaves the game.
    const clearAll = () => {
      if (this._keys.size === 0) return;
      this._keys.clear();
      this._recompute();
    };
    window.addEventListener('blur', clearAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearAll();
    });
  }

  // ======================================================================
  // Touch (Pointer Events, per-pointer-id tracking)
  // ======================================================================

  _bindTouch() {
    const zone = this._joyZone;

    zone.addEventListener('pointerdown', (e) => {
      if (this._joyId !== null) return; // one finger drives the stick
      this._joyId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      this._joyOrigin.x = e.clientX;
      this._joyOrigin.y = e.clientY;
      this._joyBase.style.display = '';
      this._joyBase.style.left = `${e.clientX}px`;
      this._joyBase.style.top = `${e.clientY}px`;
      this._joyKnob.style.transform = 'translate(-50%, -50%)';
      this._joyVec.x = 0;
      this._joyVec.z = 0;
      this._recompute();
      e.preventDefault();
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joyId) return;
      let dx = e.clientX - this._joyOrigin.x;
      let dy = e.clientY - this._joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx = (dx / len) * JOY_RADIUS;
        dy = (dy / len) * JOY_RADIUS;
      }
      this._joyKnob.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`;
      // Screen up (dy<0) = away from camera = world -Z. Screen right = +X.
      this._joyVec.x = dx / JOY_RADIUS;
      this._joyVec.z = dy / JOY_RADIUS;
      this._recompute();
      e.preventDefault();
    });

    const joyEnd = (e) => {
      if (e.pointerId !== this._joyId) return;
      this._releaseJoy();
    };
    zone.addEventListener('pointerup', joyEnd);
    zone.addEventListener('pointercancel', joyEnd);
    zone.addEventListener('lostpointercapture', joyEnd);

    // BEAM / WARP hold buttons — each tracks its own pointer id so the
    // joystick finger and button fingers never interfere.
    this._bindHoldButton(this._btnBeam, (held) => { this._beamHeld = held; });
    this._bindHoldButton(this._btnWarp, (held) => { this._warpHeld = held; });

    this._btnPause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPause();
    });
  }

  _bindHoldButton(el, setHeld) {
    let pid = null;
    el.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (_) { /* noop */ }
      el.classList.add('mf-pressed');
      setHeld(true);
      this._recompute();
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      el.classList.remove('mf-pressed');
      setHeld(false);
      this._recompute();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  _releaseJoy() {
    this._joyId = null;
    this._joyVec.x = 0;
    this._joyVec.z = 0;
    this._joyBase.style.display = 'none';
    this._recompute();
  }

  _releaseAllTouch() {
    this._releaseJoy();
    this._beamHeld = false;
    this._warpHeld = false;
    this._btnBeam.classList.remove('mf-pressed');
    this._btnWarp.classList.remove('mf-pressed');
    this._recompute();
  }

  // ======================================================================
  // Merge sources → this.state
  // ======================================================================

  _recompute() {
    const k = this._keys;
    let kx = ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0) -
             ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0);
    let kz = ((k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0) -
             ((k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0);
    if (kx !== 0 && kz !== 0) { // normalize keyboard diagonals
      kx *= Math.SQRT1_2;
      kz *= Math.SQRT1_2;
    }

    let x = kx + this._joyVec.x;
    let z = kz + this._joyVec.z;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }

    this.state.x = x;
    this.state.z = z;
    this.state.beam = k.has('Space') || this._beamHeld;
    this.state.warp = k.has('ShiftLeft') || k.has('ShiftRight') || this._warpHeld;
  }
}
