// MOO-FO — Controls
// Unified keyboard + touch + gamepad input with rebindable keys.
// Exposes `state` { x:-1..1, z:-1..1, beam:bool, warp:bool } (camera-relative
// rotation is applied by main), plus `orbit` (-1..1 manual camera input) and
// mouse-drag orbit deltas. main.js calls poll() once per frame.
//
// Default keys: WASD/arrows fly, Space beam, Shift warp, Q/E camera.
// Gamepad (standard mapping): left stick fly, right stick camera,
// RT/A beam, LB/LT warp, Start pause.

import { IS_MOBILE } from './config.js';

const JOY_RADIUS = 56; // max knob travel in px (dynamic-origin virtual stick)
const BINDS_KEY = 'moofo-binds';

const DEFAULT_BINDS = Object.freeze({
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  beam: 'Space',
  warp: 'ShiftLeft',
  camLeft: 'KeyZ',     // Q is reserved for the campaign COMPLETE action
  camRight: 'KeyC',
});

// Arrows always work for movement regardless of binds.
const ARROWS = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right' };

const PAD_DEADZONE = 0.18;

function keyLabel(code) {
  if (!code) return '—';
  const special = {
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', CapsLock: 'CAPS',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=',
  };
  if (special[code]) return special[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

function div(cls, parent) {
  const d = document.createElement('div');
  d.className = cls;
  if (parent) parent.appendChild(d);
  return d;
}

export class Controls {
  constructor({ onPause, onComplete } = {}) {
    this.onPause = typeof onPause === 'function' ? onPause : () => {};
    this.onComplete = typeof onComplete === 'function' ? onComplete : () => {};

    /** Normalized, combined keyboard+touch+gamepad input. Mutated in place. */
    this.state = { x: 0, z: 0, beam: false, warp: false };

    /** Manual camera orbit input, -1..1 (keys + right stick). */
    this.orbit = 0;

    this.isTouch = IS_MOBILE || (
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) &&
      !!window.matchMedia?.('(pointer: coarse)').matches
    );

    // --- key bindings -----------------------------------------------------
    this.binds = { ...DEFAULT_BINDS };
    try {
      const saved = JSON.parse(localStorage.getItem(BINDS_KEY) || 'null');
      if (saved) for (const k of Object.keys(DEFAULT_BINDS)) if (saved[k]) this.binds[k] = saved[k];
    } catch (_) { /* corrupted storage — defaults */ }
    // Q is now the COMPLETE key — migrate any saved camera bind off it.
    if (this.binds.camLeft === 'KeyQ') this.binds.camLeft = 'KeyZ';
    if (this.binds.camRight === 'KeyQ') this.binds.camRight = 'KeyC';
    this._capture = null;     // { action, resolve } while rebinding

    // --- internal input sources -------------------------------------------
    this._keys = new Set();
    this._joyId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._joyVec = { x: 0, z: 0 };
    this._beamHeld = false;
    this._warpHeld = false;

    // gamepad
    this.gamepadConnected = false;
    this._padIndex = null;
    this._padVec = { x: 0, z: 0 };
    this._padBeam = false;
    this._padWarp = false;
    this._padOrbit = 0;
    this._padPauseWas = false;
    this._padConfirmWas = false;

    // mouse-drag camera orbit
    this._dragId = null;
    this._dragDelta = 0;      // accumulated px since last consume

    this._buildTouchDOM();
    this._bindKeyboard();
    this._bindTouch();
    this._bindMouseOrbit();
    this._bindGamepadEvents();
  }

  // ======================================================================
  // Public API
  // ======================================================================

  get bindLabels() {
    const out = {};
    for (const k of Object.keys(this.binds)) out[k] = keyLabel(this.binds[k]);
    return out;
  }

  /** Capture the next keydown as the new bind. Resolves label, or null on Esc. */
  rebind(action) {
    if (!(action in this.binds)) return Promise.resolve(null);
    if (this._capture) this._capture.resolve(null);
    return new Promise((resolve) => {
      this._capture = { action, resolve };
    });
  }

  resetBinds() {
    this.binds = { ...DEFAULT_BINDS };
    this._saveBinds();
  }

  _saveBinds() {
    try { localStorage.setItem(BINDS_KEY, JSON.stringify(this.binds)); } catch (_) { /* full */ }
  }

  setTouchVisible(visible) {
    this.touchRoot.classList.toggle('mf-hidden', !visible);
    if (!visible) this._releaseAllTouch();
  }

  anyKeyOnce(cb) {
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPtr, true);
      cb();
    };
    const onKey = (e) => {
      if (e.repeat || e.code === 'Escape' || e.code === 'KeyP') return;
      done();
    };
    const onPtr = () => done();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPtr, true);
  }

  /** Mouse-drag camera rotation accumulated since last call (px, + = right). */
  consumeDragDelta() {
    const d = this._dragDelta;
    this._dragDelta = 0;
    return d;
  }

  /** Per-frame: poll gamepad + refresh orbit. Call once from the main loop. */
  poll() {
    this._pollGamepad();
    const k = this._keys;
    const keyOrbit = (k.has(this.binds.camRight) ? 1 : 0) - (k.has(this.binds.camLeft) ? 1 : 0);
    this.orbit = Math.max(-1, Math.min(1, keyOrbit + this._padOrbit));
  }

  // ======================================================================
  // Gamepad
  // ======================================================================

  _bindGamepadEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      this._padIndex = e.gamepad.index;
      this.gamepadConnected = true;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this._padIndex) {
        this._padIndex = null;
        this.gamepadConnected = false;
        this._padVec.x = this._padVec.z = 0;
        this._padBeam = this._padWarp = false;
        this._padOrbit = 0;
        this._recompute();
      }
    });
  }

  _pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = this._padIndex !== null ? pads[this._padIndex] : null;
    if (!pad) {
      for (const p of pads) if (p && p.connected) { pad = p; this._padIndex = p.index; break; }
    }
    this.gamepadConnected = !!pad;
    if (!pad) return;

    const dz = (v) => (Math.abs(v) < PAD_DEADZONE ? 0 : (v - Math.sign(v) * PAD_DEADZONE) / (1 - PAD_DEADZONE));
    const nx = dz(pad.axes[0] || 0);
    const nz = dz(pad.axes[1] || 0);
    this._padOrbit = dz(pad.axes[2] || 0);

    const btn = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
    const beam = btn(7) || btn(0);          // RT or A
    const warp = btn(4) || btn(6);          // LB or LT
    const pause = btn(9);                   // Start
    const confirm = btn(0);                 // A doubles as menu confirm

    if (pause && !this._padPauseWas) this.onPause();
    this._padPauseWas = pause;

    // A press edge → synthesize Enter so menus confirm with the pad.
    if (confirm && !this._padConfirmWas) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
    }
    this._padConfirmWas = confirm;

    if (nx !== this._padVec.x || nz !== this._padVec.z ||
        beam !== this._padBeam || warp !== this._padWarp) {
      this._padVec.x = nx;
      this._padVec.z = nz;
      this._padBeam = beam;
      this._padWarp = warp;
      this._recompute();
    }
  }

  // ======================================================================
  // DOM (touch layer)
  // ======================================================================

  _buildTouchDOM() {
    const root = div('mf-touch mf-hidden');
    root.id = 'mf-touch';

    this._joyZone = div('mf-joy-zone', root);
    this._joyBase = div('mf-joy-base', this._joyZone);
    this._joyKnob = div('mf-joy-knob', this._joyBase);
    this._joyBase.style.display = 'none';

    const btns = div('mf-touch-btns', root);
    this._btnWarp = document.createElement('button');
    this._btnWarp.type = 'button';
    this._btnWarp.className = 'mf-hold-btn mf-hold-warp';
    this._btnWarp.innerHTML = '<span class="mf-hold-ico"><svg width="16" height="22" viewBox="0 0 16 22" aria-hidden="true"><polygon points="9,0 1,12 7,12 5,22 15,8 9,8" fill="#ffe14d"/></svg></span><span class="mf-hold-txt">WARP</span>';
    this._btnBeam = document.createElement('button');
    this._btnBeam.type = 'button';
    this._btnBeam.className = 'mf-hold-btn mf-hold-beam';
    this._btnBeam.innerHTML = '<span class="mf-hold-ico"><svg width="28" height="18" viewBox="0 0 28 18" aria-hidden="true"><ellipse cx="14" cy="11" rx="13" ry="4.6" fill="#9aa7b8"/><ellipse cx="14" cy="8" rx="6.5" ry="4.8" fill="#7ce8ff"/><circle cx="6" cy="11.4" r="1.2" fill="#7cfc9a"/><circle cx="14" cy="12.6" r="1.2" fill="#7cfc9a"/><circle cx="22" cy="11.4" r="1.2" fill="#7cfc9a"/></svg></span><span class="mf-hold-txt">BEAM</span>';
    btns.appendChild(this._btnWarp);
    btns.appendChild(this._btnBeam);

    this._btnPause = document.createElement('button');
    this._btnPause.type = 'button';
    this._btnPause.className = 'mf-touch-pause';
    this._btnPause.setAttribute('aria-label', 'Pause');
    this._btnPause.innerHTML = '<svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true"><rect x="3" y="2" width="5" height="18" rx="1.5" fill="#fff"/><rect x="12" y="2" width="5" height="18" rx="1.5" fill="#fff"/></svg>';
    root.appendChild(this._btnPause);

    document.body.appendChild(root);
    this.touchRoot = root;

    for (const el of [root, this._joyZone, this._btnBeam, this._btnWarp, this._btnPause]) {
      el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ======================================================================
  // Keyboard
  // ======================================================================

  _isGameCode(code) {
    if (code in ARROWS) return true;
    for (const k of Object.keys(this.binds)) if (this.binds[k] === code) return true;
    return false;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;

      // rebind capture mode swallows everything except Esc (= cancel)
      if (this._capture) {
        e.preventDefault();
        if (e.repeat) return;
        const cap = this._capture;
        this._capture = null;
        if (code === 'Escape') { cap.resolve(null); return; }
        // steal the key from any action that already uses it
        for (const k of Object.keys(this.binds)) {
          if (k !== cap.action && this.binds[k] === code) this.binds[k] = '';
        }
        this.binds[cap.action] = code;
        this._saveBinds();
        this._recompute();
        cap.resolve(keyLabel(code));
        return;
      }

      if (code === 'Escape' || code === 'KeyP') {
        if (!e.repeat) this.onPause();
        e.preventDefault();
        return;
      }
      if (code === 'KeyQ') {   // campaign COMPLETE (no-op outside a completable run)
        if (!e.repeat) this.onComplete();
        e.preventDefault();
        return;
      }
      if (this._isGameCode(code)) {
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
  // Mouse-drag camera orbit (desktop)
  // ======================================================================

  _bindMouseOrbit() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      this._dragId = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._dragId) return;
      this._dragDelta += e.movementX || 0;
    });
    const end = (e) => { if (e.pointerId === this._dragId) this._dragId = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ======================================================================
  // Touch (Pointer Events, per-pointer-id tracking)
  // ======================================================================

  _bindTouch() {
    const zone = this._joyZone;

    zone.addEventListener('pointerdown', (e) => {
      if (this._joyId !== null) return;
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
    const b = this.binds;
    const held = (action) => {
      if (b[action] && k.has(b[action])) return true;
      for (const code of Object.keys(ARROWS)) if (ARROWS[code] === action && k.has(code)) return true;
      return false;
    };
    let kx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    let kz = (held('back') ? 1 : 0) - (held('forward') ? 1 : 0);
    if (kx !== 0 && kz !== 0) {
      kx *= Math.SQRT1_2;
      kz *= Math.SQRT1_2;
    }

    let x = kx + this._joyVec.x + this._padVec.x;
    let z = kz + this._joyVec.z + this._padVec.z;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }

    this.state.x = x;
    this.state.z = z;
    this.state.beam = held('beam') || this._beamHeld || this._padBeam;
    this.state.warp = held('warp') || (b.warp === 'ShiftLeft' && k.has('ShiftRight')) || this._warpHeld || this._padWarp;
  }
}
