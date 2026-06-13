// MOO-FO — UI screens (Agent U)
// Title / countdown / pause (+ settings & key binds) / game-over / win
// screens. All DOM is built here and appended to document.body. Screens are
// keyboard navigable (Enter/Space confirms the primary action, Tab cycles
// real <button>s) and touch friendly.

import { CFG, IS_MOBILE, COLORS } from './config.js';

// 0xRRGGBB → '#rrggbb' (the shared palette stores ints).
function hex(n) {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}
// 0xRRGGBB → {r,g,b} 0..255.
function rgb(n) {
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// Scale an int colour toward black (mirrors three's multiplyScalar) → '#hex'.
function shade(n, k) {
  const c = rgb(n);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}
// Mix two int colours by t (0..1) → '#hex' string.
function mix(a, b, t) {
  const ca = rgb(a), cb = rgb(b);
  const f = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${f(ca.r, cb.r)},${f(ca.g, cb.g)},${f(ca.b, cb.b)})`;
}
// Tiny deterministic PRNG (mulberry32) — stable map decoration per seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rebindable actions (order = row order), label per the controls contract.
const BIND_ACTIONS = [
  ['forward', 'Fly forward'],
  ['back', 'Fly back'],
  ['left', 'Fly left'],
  ['right', 'Fly right'],
  ['beam', 'Tractor beam'],
  ['warp', 'Warp speed'],
  ['camLeft', 'Camera left'],
  ['camRight', 'Camera right'],
];

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function button(cls, parent, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `mf-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  if (parent) parent.appendChild(b);
  return b;
}

/** A BACK button with a drawn (CSS) left-chevron instead of an arrow glyph. */
function backButton(cls, parent, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `mf-btn mf-btn-back ${cls}`;
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  el('span', 'mf-chevron', b);
  el('span', 'mf-back-txt', b, label);
  if (parent) parent.appendChild(b);
  return b;
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** rAF count-up of a numeric stat (ease-out cubic). */
function countUp(node, target, { duration = 900, delay = 0 } = {}) {
  const t0 = performance.now() + delay;
  node.textContent = '0';
  const tick = (now) => {
    const t = Math.max(0, Math.min(1, (now - t0) / duration));
    const v = target * (1 - Math.pow(1 - t, 3));
    node.textContent = fmt(v);
    if (t < 1 && node.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Random starfield as box-shadow stacks (cheap, no extra DOM per star). */
function starShadows(count, maxX, maxY) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(Math.random() * maxX);
    const y = Math.round(Math.random() * maxY);
    const a = (0.3 + Math.random() * 0.7).toFixed(2);
    const r = Math.random() < 0.18 ? 1 : 0;
    out.push(`${x}px ${y}px 0 ${r}px rgba(255,255,255,${a})`);
  }
  return out.join(',');
}

export class UI {
  constructor({
    onStart, onResume, onRestart, onQuitToMenu, onToggleMute, onSelectMode,
    controls,
    // --- campaign additions (all optional / duck-typed) ---
    campaign,
    onStartLevel, onRetryLevel, onNextLevel, onLevelSelect,
  } = {}) {
    this.cb = {
      onStart: onStart || (() => {}),
      onResume: onResume || (() => {}),
      onRestart: onRestart || (() => {}),
      onQuitToMenu: onQuitToMenu || (() => {}),
      onToggleMute: onToggleMute || (() => {}),
      onSelectMode: onSelectMode || (() => {}),
      // Campaign callbacks — default to no-ops so the UI never crashes if
      // the host hasn't wired them up yet.
      onStartLevel: onStartLevel || (() => {}),
      onRetryLevel: onRetryLevel || (() => {}),
      onNextLevel: onNextLevel || (() => {}),
      onLevelSelect: onLevelSelect || (() => {}),
    };
    // Controls instance (binds / bindLabels / rebind / resetBinds /
    // gamepadConnected). Optional & duck-typed so the UI degrades gracefully
    // if it isn't wired up yet.
    this.controls = controls || null;
    // Campaign model: { levels:[{index,target,time}], unlockedCount (getter),
    // isCompleted(i), bestScore(i), starsFor(i) }. Fully optional — every
    // access is guarded so a missing campaign just yields an empty map.
    this.campaign = campaign || null;

    this._startVisible = false;
    this._pauseVisible = false;
    this._endVisible = false;
    this._levelSelectVisible = false;
    this._startArmed = false; // guards double-starts
    this._muted = false;
    this._startView = 'title'; // 'title' | 'modes' — start-overlay sub-view
    this._pauseView = 'root'; // 'root' | 'settings'
    this._capturing = false;  // true while a key-rebind capture is active

    this._buildStart();
    this._buildCountdown();
    this._buildPause();
    this._buildEndShell();
    this._buildLevelSelect();
    this._bindKeys();
  }

  // ----------------------------------------------------------------------
  // Campaign model accessors — every one tolerates a missing/partial
  // campaign object so the level-select & result screens never throw.
  // ----------------------------------------------------------------------

  _levels() {
    const c = this.campaign;
    if (c && Array.isArray(c.levels) && c.levels.length) return c.levels;
    // Fallback: synthesise 20 placeholder levels so the map still renders.
    if (!this._fallbackLevels) {
      this._fallbackLevels = Array.from({ length: 20 }, (_, i) => ({
        index: i + 1, target: 500 + i * 250, time: 90,
      }));
    }
    return this._fallbackLevels;
  }

  _unlockedCount() {
    const c = this.campaign;
    let n = 1;
    try { if (c && c.unlockedCount != null) n = c.unlockedCount | 0; }
    catch (_) { n = 1; }
    return Math.max(1, n);
  }

  _isCompleted(i) {
    try { return !!(this.campaign && this.campaign.isCompleted?.(i)); }
    catch (_) { return false; }
  }

  _bestScore(i) {
    try { return Number(this.campaign?.bestScore?.(i)) || 0; }
    catch (_) { return 0; }
  }

  _starsFor(i) {
    let s = 0;
    try { s = this.campaign?.starsFor?.(i) | 0; }
    catch (_) { s = 0; }
    return Math.max(0, Math.min(3, s));
  }

  // ======================================================================
  // START SCREEN
  // ======================================================================

  _buildStart() {
    const s = el('div', 'mf-screen mf-start mf-hidden');
    s.id = 'mf-start';

    // Starfield backdrop: three parallax-drifting layers (semi-transparent so
    // the 3D scene shows through) + occasional CSS shooting stars. The same
    // layers become hyperspace streaks on exit.
    const stars = el('div', 'mf-stars', s);
    const layerA = el('div', 'mf-stars-layer mf-stars-a', stars);
    const layerB = el('div', 'mf-stars-layer mf-stars-b', stars);
    const layerC = el('div', 'mf-stars-layer mf-stars-c', stars);
    layerA.style.boxShadow = starShadows(90, 2000, 1400);
    layerB.style.boxShadow = starShadows(55, 2000, 1400);
    layerC.style.boxShadow = starShadows(36, 2000, 1400);
    el('div', 'mf-shooting-star', stars);
    el('div', 'mf-shooting-star mf-shooting-star-b', stars);

    const panel = el('div', 'mf-start-panel', s);

    // The start overlay hosts two sub-views that swap with a slide/flip:
    //   • title  — logo / tagline / PLAY
    //   • modes  — the three mode cards
    // Both live inside the same panel so the hyperspace exit still wraps them.
    const titleView = el('div', 'mf-startview mf-startview-title', panel);
    this._startTitleView = titleView;

    // CSS-art scene: the UFO sweeps in from off-screen on a curve, settles
    // into its bob, then switches on the beam that loops the cow.
    const scene = el('div', 'mf-title-scene', titleView);
    const ufoFly = el('div', 'mf-ufo-fly', scene); // entrance-sweep wrapper
    const ufo = el('div', 'mf-ufo-art', ufoFly);
    el('div', 'mf-ufo-dome', ufo);
    const body = el('div', 'mf-ufo-body', ufo);
    for (let i = 0; i < 3; i++) {
      const l = el('div', 'mf-ufo-light', body);
      l.style.setProperty('--i', i);
    }
    el('div', 'mf-beam-cone', scene);
    const cowWrap = el('div', 'mf-beam-rider', scene);
    const cow = el('div', 'mf-cow-art', cowWrap);
    const cowBody = el('div', 'mf-cow-body', cow);
    el('div', 'mf-cow-spot mf-cow-spot-a', cowBody);
    el('div', 'mf-cow-spot mf-cow-spot-b', cowBody);
    el('div', 'mf-cow-udder', cowBody);
    const head = el('div', 'mf-cow-head', cow);
    el('div', 'mf-cow-ear mf-cow-ear-l', head);
    el('div', 'mf-cow-ear mf-cow-ear-r', head);
    el('div', 'mf-cow-snout', head);
    el('div', 'mf-cow-eye mf-cow-eye-l', head);
    el('div', 'mf-cow-eye mf-cow-eye-r', head);
    for (let i = 0; i < 4; i++) el('div', `mf-cow-leg mf-cow-leg-${i}`, cow);
    el('div', 'mf-cow-tail', cow);

    // Logo: chunky letters, staggered boing-in, layered glow.
    const logo = el('h1', 'mf-logo', titleView);
    logo.setAttribute('aria-label', 'MOO-FO');
    'MOO-FO'.split('').forEach((ch, i) => {
      const span = el('span', ch === '-' ? 'mf-logo-ch mf-logo-dash' : 'mf-logo-ch', logo, ch);
      span.style.setProperty('--i', i);
    });

    // Tagline, revealed by a beam-of-light wipe sweeping across it.
    // (Controls now live in Settings — no instruction clutter here.)
    const tagWrap = el('div', 'mf-tagline-wrap', titleView);
    el('div', 'mf-tagline', tagWrap, 'ABDUCT ALL THE COWS');
    el('div', 'mf-tagline-beam', tagWrap);

    this._bestEl = el('div', 'mf-best mf-hidden', titleView);

    // PLAY no longer starts the game directly — it opens the mode selector.
    this._startBtn = button('mf-btn-primary mf-btn-start', titleView, 'PLAY',
      () => this._pressPlay());

    // Mode-select sub-view (built once, hidden until PLAY is pressed).
    this._buildModeSelect(panel);

    el('div', 'mf-hyper-flash', s); // hyperspace white flash (exit only)
    el('div', 'mf-vignette-static', s);

    document.body.appendChild(s);
    this._startEl = s;
  }

  /**
   * Mode-select sub-view: three rectangular mode cards. FREE PLAY is playable
   * and runs the normal start flow; CAMPAIGN / MULTIPLAYER are locked and show
   * a "coming soon" pulse instead of starting. Built once, lives in the panel
   * beside the title view, toggled by .mf-startview-on.
   */
  _buildModeSelect(panel) {
    const view = el('div', 'mf-startview mf-startview-modes', panel);
    this._startModesView = view;

    const head = el('div', 'mf-modes-head', view);
    this._modesBackBtn = backButton('mf-modes-back', head, 'BACK',
      () => this._setStartView('title'));
    el('h2', 'mf-panel-title mf-modes-title', head, 'SELECT MODE');

    const grid = el('div', 'mf-mode-grid', view);

    // CAMPAIGN is now playable (opens LEVEL SELECT). MULTIPLAYER stays locked
    // ("coming soon"). FREE PLAY runs the normal start flow.
    const MODES = [
      { key: 'campaign',    name: 'CAMPAIGN',    sub: '20 missions across the farm galaxy', locked: false },
      { key: 'multiplayer', name: 'MULTIPLAYER', sub: 'Beam-off against your friends',       locked: true },
      { key: 'freeplay',    name: 'FREE PLAY',   sub: '90-second high-score rush',           locked: false },
    ];

    this._modeCards = {};
    for (const m of MODES) {
      const card = el('button', `mf-mode-card mf-mode-${m.key}${m.locked ? ' mf-mode-locked' : ''}`, grid);
      card.type = 'button';
      el('div', 'mf-mode-scrim', card);
      const txt = el('div', 'mf-mode-text', card);
      el('div', 'mf-mode-name', txt, m.name);
      el('div', 'mf-mode-sub', txt, m.sub);
      if (m.locked) {
        const ribbon = el('div', 'mf-mode-ribbon', card, 'COMING SOON');
        card.addEventListener('click', (e) => {
          e.preventDefault();
          this._comingSoon(card, ribbon, m.key);
        });
      } else if (m.key === 'campaign') {
        card.addEventListener('click', (e) => {
          e.preventDefault();
          this.cb.onSelectMode(m.key);
          this.showLevelSelect();
        });
        this._campaignCard = card;
      } else {
        card.addEventListener('click', (e) => {
          e.preventDefault();
          this._selectMode(m.key);
        });
        this._freePlayCard = card;
      }
      this._modeCards[m.key] = card;
    }
  }

  /** Swap between the title and mode-select sub-views (slide/flip). */
  _setStartView(name) {
    if (name === this._startView) return;
    this._startView = name;
    const toModes = name === 'modes';
    this._startTitleView.classList.toggle('mf-startview-on', !toModes);
    this._startModesView.classList.toggle('mf-startview-on', toModes);
    if (toModes) {
      // Restart the entrance animation for the cards every time.
      this._startModesView.classList.remove('mf-startview-anim');
      void this._startModesView.offsetWidth;
      this._startModesView.classList.add('mf-startview-anim');
      (this._freePlayCard || this._modesBackBtn).focus({ preventScroll: true });
    } else {
      this._startBtn.focus({ preventScroll: true });
    }
  }

  /** Locked card tapped → flash the ribbon + a brief toast, do NOT start. */
  _comingSoon(card, ribbon, key) {
    this.cb.onSelectMode(key); // harmless hook; does not start the game
    ribbon.classList.remove('mf-ribbon-pulse');
    void ribbon.offsetWidth;
    ribbon.classList.add('mf-ribbon-pulse');
    this._showToast('Coming soon!');
  }

  /** FREE PLAY chosen → run the normal start flow (same as old PLAY/START). */
  _selectMode(key) {
    this.cb.onSelectMode(key);
    this._pressStart();
  }

  /** Brief inline toast inside the start overlay (auto-dismisses). */
  _showToast(msg) {
    if (!this._toastEl) {
      this._toastEl = el('div', 'mf-toast', this._startEl);
    }
    const t = this._toastEl;
    t.textContent = msg;
    t.classList.remove('mf-toast-show');
    void t.offsetWidth;
    t.classList.add('mf-toast-show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('mf-toast-show'), 1400);
  }

  showStart(highscore = 0) {
    this._lastHighscore = highscore;
    // Any campaign result overlay is stale once we're back at the title.
    this.hideEnd();
    if (this._levelSelectVisible) this.hideLevelSelect();
    this._startEl.classList.remove('mf-hidden', 'mf-exit');
    // Always reset to the TITLE view (so quit-to-menu re-entry starts clean).
    this._startView = 'title';
    this._startTitleView.classList.add('mf-startview-on');
    this._startModesView.classList.remove('mf-startview-on', 'mf-startview-anim');
    if (this._toastEl) this._toastEl.classList.remove('mf-toast-show');
    if (highscore > 0) {
      this._bestEl.textContent = '';
      el('span', 'mf-best-cup', this._bestEl);   // drawn trophy mark (CSS art)
      el('span', 'mf-best-txt', this._bestEl, `BEST ${fmt(highscore)}`);
      this._bestEl.classList.remove('mf-hidden');
    } else {
      this._bestEl.classList.add('mf-hidden');
    }
    // Replay entrance animations on every show.
    this._startEl.classList.remove('mf-anim');
    void this._startEl.offsetWidth;
    this._startEl.classList.add('mf-anim');
    this._startVisible = true;
    this._startArmed = true;
    this._startBtn.focus({ preventScroll: true });
  }

  /**
   * Hyperspace exit: stars stretch into streaks, the logo + panel whoosh out
   * toward the camera, then a quick white flash. Resolves when done (~900ms).
   */
  hideStart() {
    if (!this._startVisible) return Promise.resolve();
    this._startVisible = false;
    this._startEl.classList.add('mf-exit');
    return new Promise((resolve) => {
      setTimeout(() => {
        this._startEl.classList.add('mf-hidden');
        this._startEl.classList.remove('mf-exit', 'mf-anim');
        resolve();
      }, 900);
    });
  }

  /** PLAY pressed → open the mode selector (does NOT start the game). */
  _pressPlay() {
    if (!this._startArmed) return;
    this._setStartView('modes');
  }

  /** Actually begin the game (FREE PLAY card, or Enter on the focused card). */
  _pressStart() {
    if (!this._startArmed) return;
    this._startArmed = false;
    this.cb.onStart();
  }

  // ======================================================================
  // LEVEL SELECT — a hand-illustrated, scrolling minimap of the MOO-FO farm
  // world, richer than the in-game minimap. A hi-res <canvas> (DPR-scaled)
  // paints the world ONCE into an offscreen cache; we only re-blit the
  // visible slice on scroll / day-phase change. 20 numbered UFO nodes are
  // absolutely-positioned DOM buttons aligned to a worn dirt road that
  // winds — uniquely per segment — up the map; a locked BEACH world teases
  // beyond the FINISH. Own overlay so it floats over the start screen and
  // re-tints with the live day cycle.
  // ======================================================================

  _buildLevelSelect() {
    const s = el('div', 'mf-screen mf-levelsel mf-hidden');
    s.id = 'mf-levelsel';

    // Day-cycle scrim — driven by --mf-phase-glow (set on :root by the HUD).
    el('div', 'mf-ls-sky', s);

    // Everything below lives in one centred column sized to the panel width so
    // the header lines up with the framed map (no off-centre drift).
    const shell = el('div', 'mf-ls-shell', s);

    // Header: BACK · CAMPAIGN title · worlds indicator.
    const head = el('div', 'mf-ls-head', shell);
    this._lsBackBtn = backButton('mf-ls-back', head, 'BACK',
      () => this._closeLevelSelect());
    const titleWrap = el('div', 'mf-ls-titlewrap', head);
    el('h2', 'mf-panel-title mf-ls-title', titleWrap, 'CAMPAIGN');
    // Worlds indicator: FARM (active, drawn check) · BEACH (locked, drawn lock).
    const worlds = el('div', 'mf-ls-worlds', head);
    const wFarm = el('div', 'mf-ls-world mf-ls-world-on', worlds);
    el('span', 'mf-ls-world-mark mf-ls-world-check', wFarm);
    el('span', 'mf-ls-world-name', wFarm, 'FARM');
    const wBeach = el('div', 'mf-ls-world mf-ls-world-locked', worlds);
    el('span', 'mf-ls-world-mark mf-ls-world-lock', wBeach);
    el('span', 'mf-ls-world-name', wBeach, 'BEACH');

    // Scroll viewport for the tall map — this IS the big framed panel.
    const scroll = el('div', 'mf-ls-scroll', shell);
    this._lsScroll = scroll;
    const stage = el('div', 'mf-ls-stage', scroll);
    this._lsStage = stage;
    // The painted minimap canvas (sticky to the viewport; we blit the slice).
    const canvas = el('canvas', 'mf-ls-canvas', stage);
    this._lsCanvas = canvas;
    this._lsCtx = canvas.getContext('2d');
    // A spacer that gives the scroll container its full virtual height.
    this._lsSpacer = el('div', 'mf-ls-spacer', stage);
    // Node/marker layer (also tall — scrolls with the content).
    this._lsNodeLayer = el('div', 'mf-ls-nodes', stage);

    // Wheel + drag + keyboard scrolling all funnel through the container's
    // native scrollTop; a scroll listener re-blits the canvas slice.
    scroll.addEventListener('scroll', () => this._lsOnScroll(), { passive: true });
    this._lsBindDrag(scroll);

    document.body.appendChild(s);
    this._levelSelEl = s;

    // Offscreen cache canvas (filled once per layout in _lsPaintWorld).
    this._lsCache = document.createElement('canvas');
    this._lsCacheCtx = this._lsCache.getContext('2d');
    this._lsLayout = null;       // memoised geometry {pts, w, h, ...}
    this._lsPhase = null;        // last painted --mf-phase-glow
    this._lsRaf = 0;
  }

  // -- pointer-drag scrolling (touch + mouse) on the viewport --------------
  _lsBindDrag(scroll) {
    let dragging = false, lastY = 0, moved = 0, vel = 0, lastT = 0, momRaf = 0;
    const stopMom = () => { if (momRaf) cancelAnimationFrame(momRaf); momRaf = 0; };
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.mf-ls-node')) return; // let nodes click
      dragging = true; moved = 0; vel = 0;
      lastY = e.touches ? e.touches[0].clientY : e.clientY;
      lastT = performance.now();
      stopMom();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = y - lastY;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vel = dy / dt;
      lastY = y; lastT = now;
      moved += Math.abs(dy);
      scroll.scrollTop -= dy;
      if (e.cancelable && moved > 6) e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      // gentle inertial fling
      let v = vel * 16;
      const decay = () => {
        v *= 0.92;
        scroll.scrollTop -= v;
        if (Math.abs(v) > 0.4) momRaf = requestAnimationFrame(decay);
        else momRaf = 0;
      };
      if (Math.abs(v) > 1) decay();
    };
    scroll.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    scroll.addEventListener('touchstart', onDown, { passive: true });
    scroll.addEventListener('touchmove', onMove, { passive: false });
    scroll.addEventListener('touchend', onUp);
  }

  // -- geometry: compute node points + a windy, per-segment-unique road -----
  // Returns layout in CSS px for the current viewport width. ~3 nodes per
  // screen-height: nodeStep = visibleHeight / 3 (clamped). Map runs bottom
  // (level 1, near START) → top (FINISH → BEACH teaser).
  _lsComputeLayout() {
    const scroll = this._lsScroll;
    // The scroll viewport now IS the framed panel, so its client box already
    // reflects the big panel size (min(820px,94vw) wide). The canvas fills the
    // full panel width — no centred narrow column, no navy gutters.
    const vw = scroll.clientWidth || 360;
    const vh = scroll.clientHeight || 560;
    const W = Math.max(280, vw);              // map fills the whole panel width
    const levels = this._levels();
    const n = levels.length;

    // ~3 nodes visible per screen → short road between levels. Scale the step
    // to the viewport so exactly ~3 nodes show regardless of panel height.
    const nodeStep = Math.max(150, Math.min(300, vh / 3));
    // Top padding must reserve room ABOVE the last level for the FINISH chip
    // (~0.7 step up) AND the full BEACH "coming soon" teaser band (~1.6 steps
    // higher) — otherwise the beach renders off-canvas. So scale it to the
    // step, not just the viewport.
    const topPad = Math.max(vh * 0.40, nodeStep * 2.6);
    const botPad = Math.max(130, vh * 0.24);  // room below level 1 / START
    const H = topPad + botPad + (n - 1) * nodeStep;

    const midX = W * 0.5;
    const margin = 46;                         // keep the 64px markers on-canvas
    const maxSway = Math.max(20, W * 0.36);    // wider maps lean more gracefully
    const amp = W * 0.24;                       // base sway amplitude
    const clampX = (x) => Math.max(margin, Math.min(W - margin, x));
    // Per-node x derived from the level index so each stretch is unique:
    // two interfering sine waves of different freq → varied lean & S-bends.
    const seed = rng(20240613);
    const phase = seed() * 6.283;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const y = H - botPad - i * nodeStep;
      const a = Math.sin(i * 0.9 + phase);
      const b = Math.sin(i * 0.41 + 1.7);
      const c = Math.sin(i * 2.3 + 0.6) * 0.32;   // occasional sharper kink
      let sway = (a * 0.62 + b * 0.5 + c) * amp;
      sway = Math.max(-maxSway, Math.min(maxSway, sway));
      pts.push({ x: clampX(midX + sway), y, index: levels[i].index ?? i + 1, target: Number(levels[i].target) || 0 });
    }
    const finish = { x: clampX(midX + Math.sin(n * 0.9 + phase) * amp * 0.4), y: H - botPad - (n - 1 + 0.7) * nodeStep };
    const start = { x: pts[0].x, y: pts[0].y + nodeStep * 0.7 };
    const beach = { x: midX, y: finish.y - nodeStep * 1.25 };

    return { W, H, vw, vh, pts, start, finish, beach, nodeStep, topPad, botPad, midX, amp };
  }

  /**
   * Paint the full illustrated world ONCE into the offscreen cache at the
   * current width/height (DPR-scaled). Layered: grass base → soft patches →
   * crop fields → forest border → river+lake+dam+waterfall → mountain →
   * ponds → pastures → farm cluster → the winding dirt road → vignette.
   * Beach teaser is painted at the very top.
   */
  _lsPaintWorld(layout) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { W, H } = layout;
    const cache = this._lsCache;
    cache.width = Math.round(W * dpr);
    cache.height = Math.round(H * dpr);
    const g = this._lsCacheCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const R = rng(0x5eed1234);

    // 1) LUSH GRASS BASE — vertical gradient between the palette greens.
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, shade(COLORS.grassC, 0.96));
    base.addColorStop(0.5, hex(COLORS.grassA));
    base.addColorStop(1, shade(COLORS.grassB, 0.92));
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    // soft multi-tone grass patches (big translucent blobs)
    const patchCols = [COLORS.grassC, COLORS.grassB, 0x9fbf4a, 0x57b98a, 0x2f7d3a];
    for (let i = 0; i < Math.round(H / 26); i++) {
      const x = R() * W, y = R() * H, r = 26 + R() * 70;
      const col = patchCols[(R() * patchCols.length) | 0];
      const rad = g.createRadialGradient(x, y, 0, x, y, r);
      rad.addColorStop(0, mix(col, 0xffffff, 0.04));
      rad.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.5;
      g.fillStyle = rad;
      g.beginPath(); g.ellipse(x, y, r, r * 0.7, R() * 3.14, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;

    // faint gentle texture: short grass flecks
    g.globalAlpha = 0.10;
    for (let i = 0; i < Math.round(W * H / 1400); i++) {
      const x = R() * W, y = R() * H;
      g.strokeStyle = R() < 0.5 ? shade(COLORS.grassB, 0.8) : mix(COLORS.grassC, 0xffffff, 0.2);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 3, y - 2 - R() * 2); g.stroke();
    }
    g.globalAlpha = 1;

    // gentle TERRAIN CONTOURS — faint rolling-hill bands so the ground reads
    // as sculpted land, not a flat sheet of green.
    g.save();
    g.globalAlpha = 0.06;
    g.strokeStyle = '#06321a';
    g.lineWidth = 6;
    for (let cy = H * 0.05; cy < H; cy += 46 + (cy % 90)) {
      g.beginPath();
      for (let x = -10; x <= W + 10; x += 18) {
        const yy = cy + Math.sin(x * 0.012 + cy * 0.02) * 10;
        x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.restore();
    // matching faint highlight contours just above each shade band
    g.save();
    g.globalAlpha = 0.05;
    g.strokeStyle = mix(COLORS.grassC, 0xffffff, 0.5);
    g.lineWidth = 3;
    for (let cy = H * 0.05; cy < H; cy += 46 + (cy % 90)) {
      g.beginPath();
      for (let x = -10; x <= W + 10; x += 18) {
        const yy = cy - 3 + Math.sin(x * 0.012 + cy * 0.02) * 10;
        x < 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.restore();

    // helper: soft drop-shadow blob
    const shadow = (x, y, w, h) => {
      g.save(); g.globalAlpha = 0.20; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.283); g.fill(); g.restore();
    };

    // 2) TILLED CROP FIELDS — must always read as a ploughed field, never a
    // blank rounded box. Built from: a soil base, raised furrow ridges
    // (alternating light/dark bands = tilled rows), thin seed-row dashes along
    // the crown of each ridge, a few crop dots, and a dark earthy outline.
    // `crop` tints the rows so corn/pumpkin/veg patches read differently.
    const drawField = (x, y, w, h, rot, stripe, crop) => {
      g.save();
      g.translate(x, y); g.rotate(rot);
      // soft cast shadow so the field sits ON the grass, not floating
      g.save(); g.globalAlpha = 0.18; g.fillStyle = '#000';
      this._roundRect(g, -w / 2 + 3, -h / 2 + 4, w, h, 9); g.fill(); g.restore();
      // soil base
      g.fillStyle = shade(COLORS.field, 0.92);
      this._roundRect(g, -w / 2, -h / 2, w, h, 9); g.fill();
      g.save();
      this._roundRect(g, -w / 2, -h / 2, w, h, 9); g.clip();
      // raised furrow RIDGES across the field (vertical bands, sunlit + shade)
      let band = 0;
      for (let fx = -w / 2; fx < w / 2; fx += stripe, band++) {
        // lit crown of the ridge
        g.fillStyle = shade(COLORS.field, band % 2 ? 1.18 : 1.06);
        g.fillRect(fx, -h / 2, stripe * 0.62, h);
        // shaded trough between ridges
        g.fillStyle = shade(COLORS.field, 0.74);
        g.fillRect(fx + stripe * 0.62, -h / 2, stripe * 0.38, h);
        // thin seed-row dash line down the ridge crown
        g.strokeStyle = crop ? this._withAlpha(crop, 0.55) : 'rgba(60,40,20,0.5)';
        g.lineWidth = 1.4;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(fx + stripe * 0.30, -h / 2 + 3);
        g.lineTo(fx + stripe * 0.30, h / 2 - 3);
        g.stroke();
        g.setLineDash([]);
      }
      // scattered little crop dots (rows of plants) for a hint of growth
      if (crop) {
        g.fillStyle = crop;
        for (let cx = -w / 2 + stripe * 0.3; cx < w / 2; cx += stripe) {
          for (let cy = -h / 2 + 5; cy < h / 2 - 2; cy += 7) {
            g.beginPath(); g.arc(cx, cy + (R() - 0.5) * 2, 1.3, 0, 6.283); g.fill();
          }
        }
      }
      g.restore();
      // dark earthy outline so the patch reads as a bordered, tilled plot
      g.strokeStyle = shade(COLORS.field, 0.5); g.lineWidth = 2.2;
      this._roundRect(g, -w / 2, -h / 2, w, h, 9); g.stroke();
      g.restore();
    };
    drawField(W * 0.70, H * 0.30, W * 0.30, H * 0.085, -0.05, 11, '#f2d24a'); // corn
    drawField(W * 0.22, H * 0.60, W * 0.22, H * 0.06, 0.08, 10, '#e8923a');   // pumpkin
    drawField(W * 0.78, H * 0.74, W * 0.24, H * 0.05, 0.04, 10, '#7dbf4a'); // veg
    drawField(W * 0.16, H * 0.21, W * 0.20, H * 0.05, -0.03, 10, '#5fae3a');  // veg (top-left)
    drawField(W * 0.52, H * 0.84, W * 0.22, H * 0.05, 0.05, 11, '#cf6f3a');   // squash (low)

    // 3) DARK FOREST BORDER RING — little tree blobs around the edge.
    const treeBlob = (x, y, s, deep) => {
      shadow(x + s * 0.2, y + s * 0.7, s * 0.9, s * 0.4);
      g.fillStyle = deep ? shade(0x2f7d3a, 0.85) : '#3fae5e';
      g.beginPath(); g.arc(x - s * 0.5, y, s * 0.62, 0, 6.283);
      g.arc(x + s * 0.5, y, s * 0.62, 0, 6.283);
      g.arc(x, y - s * 0.5, s * 0.7, 0, 6.283); g.fill();
      g.fillStyle = deep ? '#2f7d3a' : '#4cbf68';
      g.beginPath(); g.arc(x - s * 0.2, y - s * 0.3, s * 0.5, 0, 6.283); g.fill();
    };
    const ring = 16;
    for (let y = ring; y < H; y += 30 + R() * 14) {
      treeBlob(ring + R() * 10, y, 10 + R() * 5, true);
      treeBlob(W - ring - R() * 10, y + 14, 10 + R() * 5, true);
    }
    for (let x = ring; x < W; x += 34 + R() * 14) {
      treeBlob(x, ring + R() * 8, 9 + R() * 4, true);
    }

    // 4) RIVER → LAKE → DAM → WATERFALL. A winding blue ribbon down the map,
    // a lake near the top fed by a thin waterfall off the mountain.
    // River hugs the LEFT third of the map so it never shares a column with
    // the centred dirt road — blue ribbon left, tan path centre = no confusion.
    const riverX = (t) => W * (0.20 + Math.sin(t * 7.5 + 1.1) * 0.10 + Math.sin(t * 3.1) * 0.04);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // river bed / bank toe
    g.strokeStyle = shade(COLORS.water, 0.55); g.lineWidth = 26;
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.02) { const x = riverX(t), y = t * H; t ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    // water body
    const riverGrad = g.createLinearGradient(0, 0, W, 0);
    riverGrad.addColorStop(0, shade(COLORS.water, 0.85));
    riverGrad.addColorStop(0.5, hex(COLORS.water));
    riverGrad.addColorStop(1, mix(COLORS.water, 0xffffff, 0.15));
    g.strokeStyle = riverGrad; g.lineWidth = 19;
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.02) { const x = riverX(t), y = t * H; t ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    // ripple highlights
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    for (let t = 0.04; t < 1; t += 0.05) {
      const x = riverX(t), y = t * H;
      g.beginPath(); g.moveTo(x - 5, y); g.quadraticCurveTo(x, y - 3, x + 5, y); g.stroke();
    }

    // lake near the top
    const lake = { x: riverX(0.14), y: H * 0.14, rx: W * 0.16, ry: H * 0.05 };
    g.fillStyle = shade(COLORS.water, 0.6);
    g.beginPath(); g.ellipse(lake.x, lake.y + 3, lake.rx + 4, lake.ry + 3, 0, 0, 6.283); g.fill();
    const lakeGrad = g.createRadialGradient(lake.x - lake.rx * 0.3, lake.y - lake.ry * 0.4, 2, lake.x, lake.y, lake.rx);
    lakeGrad.addColorStop(0, mix(COLORS.water, 0xffffff, 0.25));
    lakeGrad.addColorStop(1, hex(COLORS.waterDeep));
    g.fillStyle = lakeGrad;
    g.beginPath(); g.ellipse(lake.x, lake.y, lake.rx, lake.ry, 0, 0, 6.283); g.fill();
    // dam wall across the lake outflow
    g.fillStyle = shade(COLORS.stone, 1.0);
    this._roundRect(g, lake.x - lake.rx * 0.7, lake.y + lake.ry - 3, lake.rx * 1.4, 8, 2); g.fill();
    g.fillStyle = shade(COLORS.stone, 1.25);
    g.fillRect(lake.x - lake.rx * 0.7, lake.y + lake.ry - 3, lake.rx * 1.4, 2);

    // 5) GIANT MOUNTAIN in the top-left corner (rocky body + snow cap +
    // a thin waterfall line feeding the lake).
    const mtn = { x: W * 0.12, y: H * 0.055, w: W * 0.34, h: H * 0.10 };
    shadow(mtn.x + mtn.w * 0.1, mtn.y + mtn.h, mtn.w * 0.6, mtn.h * 0.25);
    g.fillStyle = shade(COLORS.rockGray, 0.8);
    g.beginPath();
    g.moveTo(mtn.x - mtn.w / 2, mtn.y + mtn.h);
    g.lineTo(mtn.x - mtn.w * 0.12, mtn.y - mtn.h * 0.4);
    g.lineTo(mtn.x + mtn.w * 0.18, mtn.y + mtn.h * 0.1);
    g.lineTo(mtn.x + mtn.w * 0.5, mtn.y + mtn.h);
    g.closePath(); g.fill();
    g.fillStyle = hex(COLORS.rockGray);   // sunlit face
    g.beginPath();
    g.moveTo(mtn.x - mtn.w * 0.12, mtn.y - mtn.h * 0.4);
    g.lineTo(mtn.x + mtn.w * 0.18, mtn.y + mtn.h * 0.1);
    g.lineTo(mtn.x + mtn.w * 0.5, mtn.y + mtn.h);
    g.lineTo(mtn.x + mtn.w * 0.08, mtn.y + mtn.h);
    g.closePath(); g.fill();
    // snow cap
    g.fillStyle = hex(COLORS.snow);
    g.beginPath();
    g.moveTo(mtn.x - mtn.w * 0.12, mtn.y - mtn.h * 0.4);
    g.lineTo(mtn.x - mtn.w * 0.02, mtn.y - mtn.h * 0.05);
    g.lineTo(mtn.x + mtn.w * 0.02, mtn.y - mtn.h * 0.18);
    g.lineTo(mtn.x + mtn.w * 0.07, mtn.y - mtn.h * 0.02);
    g.lineTo(mtn.x + mtn.w * 0.18, mtn.y + mtn.h * 0.1);
    g.lineTo(mtn.x - mtn.w * 0.12, mtn.y - mtn.h * 0.05);
    g.closePath(); g.fill();
    // thin waterfall line into the lake
    g.strokeStyle = 'rgba(223,241,255,0.9)'; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(mtn.x + mtn.w * 0.16, mtn.y + mtn.h * 0.2);
    g.quadraticCurveTo(lake.x - lake.rx * 0.4, (mtn.y + lake.y) / 2, lake.x - lake.rx * 0.2, lake.y - lake.ry);
    g.stroke();

    // 6) PONDS dotted around — with floating lily pads + a tiny bloom dot.
    const lilyDots = (cx, cy, rx, ry, count) => {
      for (let k = 0; k < count; k++) {
        const a = R() * 6.283, rr = R();
        const lx = cx + Math.cos(a) * rx * 0.7 * rr;
        const ly = cy + Math.sin(a) * ry * 0.7 * rr;
        const lr = 2.2 + R() * 2.4;
        g.fillStyle = '#3f9e54';
        g.beginPath(); g.ellipse(lx, ly, lr, lr * 0.8, 0, 0.5, 6.0); g.fill();
        if (R() < 0.4) { g.fillStyle = '#ffd9ef'; g.beginPath(); g.arc(lx, ly - lr * 0.3, lr * 0.4, 0, 6.283); g.fill(); }
      }
    };
    for (const p of [{ x: W * 0.82, y: H * 0.52, r: W * 0.07 }, { x: W * 0.18, y: H * 0.83, r: W * 0.05 }]) {
      g.fillStyle = shade(COLORS.water, 0.6);
      g.beginPath(); g.ellipse(p.x, p.y + 2, p.r + 2, p.r * 0.7 + 2, 0, 0, 6.283); g.fill();
      g.fillStyle = hex(COLORS.water);
      g.beginPath(); g.ellipse(p.x, p.y, p.r, p.r * 0.7, 0, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(p.x, p.y, p.r * 0.6, p.r * 0.42, 0, 0, 3.14); g.stroke();
      lilyDots(p.x, p.y, p.r, p.r * 0.7, 5);
    }
    // a few lily pads on the lake too
    lilyDots(lake.x, lake.y, lake.rx, lake.ry, 6);

    // 7) FENCED PASTURES — grazed-grass plots with mowed mowing stripes, a few
    // grass tufts, a post-and-rail fence (posts + connecting rail) and a soft
    // shadow. Never a flat light-green box.
    const pasture = (x, y, w, h) => {
      const x0 = x - w / 2, y0 = y - h / 2;
      // soft shadow
      g.save(); g.globalAlpha = 0.14; g.fillStyle = '#000';
      this._roundRect(g, x0 + 2, y0 + 3, w, h, 7); g.fill(); g.restore();
      // grazed grass base (a touch lighter / yellower than the wild grass)
      g.fillStyle = mix(COLORS.grassA, 0xeaf6c8, 0.22);
      this._roundRect(g, x0, y0, w, h, 7); g.fill();
      g.save();
      this._roundRect(g, x0, y0, w, h, 7); g.clip();
      // alternating mowed stripes
      for (let sx = x0, k = 0; sx < x0 + w; sx += 10, k++) {
        g.fillStyle = k % 2
          ? mix(COLORS.grassB, 0xffffff, 0.10)
          : mix(COLORS.grassA, 0x9fbf4a, 0.18);
        g.globalAlpha = 0.55;
        g.fillRect(sx, y0, 10, h);
      }
      g.globalAlpha = 1;
      // little grass tufts
      g.strokeStyle = shade(COLORS.grassB, 0.7); g.lineWidth = 1;
      for (let t = 0; t < (w * h) / 90; t++) {
        const tx = x0 + R() * w, ty = y0 + 2 + R() * (h - 4);
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - 1.4, ty - 2.6);
        g.moveTo(tx, ty); g.lineTo(tx + 1.4, ty - 2.6); g.stroke();
      }
      g.restore();
      // post-and-rail fence: top + bottom rails then corner/edge posts
      g.strokeStyle = shade(COLORS.wood, 0.85); g.lineWidth = 2;
      this._roundRect(g, x0, y0, w, h, 7); g.stroke();
      g.fillStyle = shade(COLORS.woodDark, 1.0);
      const posts = Math.max(2, Math.round(w / 16));
      for (let i = 0; i <= posts; i++) {
        const px = x0 + (w * i) / posts;
        g.fillRect(px - 1.4, y0 - 1.5, 2.8, h + 3);
      }
    };
    pasture(W * 0.20, H * 0.46, W * 0.17, H * 0.05);
    pasture(W * 0.80, H * 0.42, W * 0.17, H * 0.055);
    pasture(W * 0.30, H * 0.90, W * 0.17, H * 0.05);
    pasture(W * 0.66, H * 0.55, W * 0.15, H * 0.045);

    // 8) CENTRAL FARM CLUSTER — little top-down building sprites.
    // Scale to the panel so the cluster reads big on a wide desktop map.
    this._lsDrawFarm(g, W * 0.46, H * 0.66, Math.max(1, Math.min(1.7, W / 520)));

    // 8b) CRAFTED PROPS — scattered trees, bushes, rocks, hay bales, fence
    // lines: the hand-painted detail that beats the plain in-game minimap.
    this._lsDrawProps(g, layout, R);

    // 9) THE ROAD — the showpiece, painted in main-map style (see _lsDrawRoad).
    this._lsDrawRoad(g, layout);

    // START / FINISH markers painted on the road.
    this._lsDrawFlag(g, layout.start.x, layout.start.y, hex(COLORS.uiGreen), 'START');
    this._lsDrawFlag(g, layout.finish.x, layout.finish.y, hex(COLORS.gold), 'FINISH');

    // 10) BEACH — COMING SOON teaser vignette above the FINISH.
    this._lsDrawBeach(g, layout);

    // 11) soft VIGNETTE so the illustration reads as crafted, not flat.
    const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
  }

  // Worn DIRT road exactly evoking world.js _road(): a tan body (COLORS.road),
  // a darker soft edge under it (road*0.85), and TWO wheel-track lines
  // (road*0.72). Drawn as one smooth bezier through the node points with
  // rounded caps; windiness already lives in the per-node x offsets.
  _lsDrawRoad(g, layout) {
    const all = [layout.start, ...layout.pts, layout.finish];
    // Trace the road centreline. `nx` shifts the path along its local NORMAL
    // (perpendicular to travel) so the two wheel tracks hug the curve properly
    // on bends instead of sliding sideways like a flat x-offset would.
    const trace = (nx = 0) => {
      g.beginPath();
      g.moveTo(all[0].x, all[0].y);
      for (let i = 1; i < all.length; i++) {
        const p0 = all[i - 1], p1 = all[i];
        const lean = Math.sin(i * 1.7 + 0.5) * (layout.W * 0.10);
        let cx = (p0.x + p1.x) / 2 + lean;
        let cy = (p0.y + p1.y) / 2;
        let ex = p1.x, ey = p1.y;
        if (nx) {
          // unit normal of this segment (road runs mostly bottom→top)
          const dx = p1.x - p0.x, dy = p1.y - p0.y;
          const len = Math.hypot(dx, dy) || 1;
          const ox = (-dy / len) * nx, oy = (dx / len) * nx;
          cx += ox; cy += oy; ex += ox; ey += oy;
        }
        g.quadraticCurveTo(cx, cy, ex, ey);
      }
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    const road = COLORS.road;                          // 0xc2a25e — warm tan
    // ground shadow, well offset so the dirt path clearly sits ON the map
    g.save(); g.globalAlpha = 0.26; g.strokeStyle = '#000'; g.lineWidth = 34;
    g.translate(0, 3); trace(); g.stroke(); g.restore();
    // soft DARKER EARTH edge under the path
    g.strokeStyle = shade(road, 0.70); g.lineWidth = 30; trace(); g.stroke();
    // tan DIRT BASE — the wide warm body of the road
    g.strokeStyle = hex(road); g.lineWidth = 24; trace(); g.stroke();
    // sunlit highlight band so the dirt looks raised, not painted on
    g.strokeStyle = shade(road, 1.12); g.lineWidth = 17; trace(); g.stroke();
    g.strokeStyle = hex(road); g.lineWidth = 11; trace(); g.stroke();
    // TWO darker WHEEL TRACKS along the normals — the signature double-track.
    g.strokeStyle = shade(road, 0.62); g.lineWidth = 4.5;
    for (const off of [-6, 6]) { trace(off); g.stroke(); }
    // faint worn dust between the tracks
    g.strokeStyle = shade(road, 1.2); g.lineWidth = 2; trace(); g.stroke();
  }

  // Crafted hand-painted props scattered over the world: standalone trees,
  // bushes, rocks, hay bales and a couple of split-rail fence lines. Placed
  // deterministically (shared R) and kept clear of the central road column.
  _lsDrawProps(g, layout, R) {
    const { W, H } = layout;
    const shadow = (x, y, w, h, a = 0.2) => {
      g.save(); g.globalAlpha = a; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.283); g.fill(); g.restore();
    };
    // a leafy round tree with a trunk + sunlit canopy
    const tree = (x, y, s) => {
      shadow(x + s * 0.3, y + s * 0.95, s * 1.0, s * 0.4);
      g.strokeStyle = shade(COLORS.woodDark, 1.05); g.lineWidth = Math.max(2, s * 0.3);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y + s * 0.9); g.lineTo(x, y + s * 0.2); g.stroke();
      g.fillStyle = shade(0x2f7d3a, 0.85);
      g.beginPath();
      g.arc(x - s * 0.5, y, s * 0.62, 0, 6.283);
      g.arc(x + s * 0.5, y, s * 0.62, 0, 6.283);
      g.arc(x, y - s * 0.55, s * 0.7, 0, 6.283); g.fill();
      g.fillStyle = '#4cbf68';
      g.beginPath(); g.arc(x - s * 0.18, y - s * 0.35, s * 0.55, 0, 6.283); g.fill();
      g.fillStyle = mix(0x4cbf68, 0xffffff, 0.25);
      g.beginPath(); g.arc(x - s * 0.32, y - s * 0.5, s * 0.26, 0, 6.283); g.fill();
    };
    const bush = (x, y, s) => {
      shadow(x, y + s * 0.5, s * 0.9, s * 0.32, 0.16);
      g.fillStyle = shade(0x3fae5e, 0.9);
      g.beginPath();
      g.arc(x - s * 0.4, y, s * 0.4, 0, 6.283);
      g.arc(x + s * 0.4, y, s * 0.4, 0, 6.283);
      g.arc(x, y - s * 0.15, s * 0.5, 0, 6.283); g.fill();
      g.fillStyle = '#5cc97a';
      g.beginPath(); g.arc(x, y - s * 0.2, s * 0.32, 0, 6.283); g.fill();
    };
    const rock = (x, y, s) => {
      shadow(x, y + s * 0.55, s * 0.9, s * 0.3, 0.18);
      g.fillStyle = shade(COLORS.rockGray, 0.85);
      g.beginPath(); g.ellipse(x, y, s, s * 0.72, R() * 0.6, 0, 6.283); g.fill();
      g.fillStyle = mix(COLORS.rockGray, 0xffffff, 0.25);
      g.beginPath(); g.ellipse(x - s * 0.2, y - s * 0.18, s * 0.45, s * 0.3, 0, 0, 6.283); g.fill();
    };
    // cylindrical hay bale (top-down: rounded rect with spiral end-lines)
    const hay = (x, y, s) => {
      shadow(x, y + s * 0.7, s * 1.1, s * 0.4, 0.18);
      g.save(); g.translate(x, y); g.rotate(R() * 0.5 - 0.25);
      g.fillStyle = mix(COLORS.sand, 0xffe9a8, 0.35);
      this._roundRect(g, -s, -s * 0.62, s * 2, s * 1.24, s * 0.55); g.fill();
      g.strokeStyle = shade(COLORS.sand, 0.78); g.lineWidth = 1.4;
      for (let k = -2; k <= 2; k++) {
        g.beginPath(); g.moveTo(-s, k * s * 0.28); g.lineTo(s, k * s * 0.28); g.stroke();
      }
      g.strokeStyle = shade(COLORS.sand, 0.6); g.lineWidth = 1.6;
      this._roundRect(g, -s, -s * 0.62, s * 2, s * 1.24, s * 0.55); g.stroke();
      g.restore();
    };
    // a split-rail fence LINE between two points
    const fence = (x1, y1, x2, y2) => {
      const segs = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 16));
      g.strokeStyle = shade(COLORS.wood, 0.8); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.fillStyle = shade(COLORS.woodDark, 1.0);
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        g.fillRect(x1 + (x2 - x1) * t - 1.3, y1 + (y2 - y1) * t - 4, 2.6, 8);
      }
    };

    // Keep props off the central road band (|x-mid| within roadHalf).
    const mid = W * 0.5, roadHalf = W * 0.16;
    const offRoad = (x) => Math.abs(x - mid) > roadHalf;

    // scattered trees across the field, denser near the edges
    for (let i = 0; i < Math.round(H / 70); i++) {
      const edge = R() < 0.6;
      const x = edge ? (R() < 0.5 ? W * (0.04 + R() * 0.12) : W * (0.84 + R() * 0.12))
                     : R() * W;
      const y = H * 0.06 + R() * H * 0.9;
      if (!offRoad(x)) continue;
      tree(x, y, 8 + R() * 6);
    }
    // bushes & rocks dotted around
    for (let i = 0; i < Math.round(H / 90); i++) {
      const x = R() * W, y = H * 0.08 + R() * H * 0.88;
      if (!offRoad(x)) continue;
      (R() < 0.6 ? bush : rock)(x, y, 5 + R() * 4);
    }
    // a couple of hay bales near the farm fields
    hay(W * 0.62, H * 0.33, 7);
    hay(W * 0.67, H * 0.345, 7);
    hay(W * 0.30, H * 0.66, 6);
    // a few fence lines along field/pasture edges
    fence(W * 0.58, H * 0.27, W * 0.84, H * 0.27);
    fence(W * 0.10, H * 0.55, W * 0.10, H * 0.66);
    fence(W * 0.40, H * 0.80, W * 0.66, H * 0.82);
  }

  // Little top-down farm sprites: barn (+roof), silo, windmill, farmhouse.
  _lsDrawFarm(g, cx, cy, s) {
    const px = (v) => v * s;
    const shadow = (x, y, w, h) => {
      g.save(); g.globalAlpha = 0.22; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.283); g.fill(); g.restore();
    };
    // barn
    const bx = cx - px(26), by = cy - px(8), bw = px(34), bh = px(24);
    shadow(bx + bw / 2, by + bh + px(3), bw * 0.6, px(5));
    g.fillStyle = hex(COLORS.barnRed);
    this._roundRect(g, bx, by, bw, bh, 4); g.fill();
    g.fillStyle = shade(COLORS.roof, 1.1);      // roof ridge
    this._roundRect(g, bx - px(2), by - px(2), bw + px(4), px(9), 3); g.fill();
    g.strokeStyle = hex(COLORS.barnTrim); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(bx + bw / 2, by + px(2)); g.lineTo(bx + bw / 2, by + bh); g.stroke();
    // silo
    const sx = cx + px(2), sy = cy - px(4);
    shadow(sx, sy + px(16), px(9), px(4));
    g.fillStyle = shade(COLORS.stone, 1.05);
    g.beginPath(); g.arc(sx, sy, px(9), 0, 6.283); g.fill();
    g.fillStyle = shade(COLORS.stone, 0.8);
    g.beginPath(); g.arc(sx, sy, px(9), 0.6, 0.6 + 3.14); g.fill();
    g.fillStyle = mix(COLORS.stone, 0xffffff, 0.3);
    g.beginPath(); g.arc(sx, sy, px(5), 0, 6.283); g.fill();
    // farmhouse
    const hx = cx - px(8), hy = cy + px(18), hw = px(22), hh = px(16);
    shadow(hx + hw / 2, hy + hh + px(2), hw * 0.55, px(4));
    g.fillStyle = mix(COLORS.wood, 0xffffff, 0.12);
    this._roundRect(g, hx, hy, hw, hh, 3); g.fill();
    g.fillStyle = hex(COLORS.roof);
    this._roundRect(g, hx - px(2), hy - px(2), hw + px(4), px(7), 2); g.fill();
    // windmill (a circle + four blades)
    const wx = cx + px(26), wy = cy + px(4);
    shadow(wx, wy + px(12), px(7), px(3));
    g.fillStyle = mix(COLORS.wood, 0xffffff, 0.2);
    g.beginPath(); g.arc(wx, wy, px(7), 0, 6.283); g.fill();
    g.strokeStyle = shade(COLORS.woodDark, 1.0); g.lineWidth = 2.2;
    for (let k = 0; k < 4; k++) {
      const a = k * 1.5708 + 0.4;
      g.beginPath(); g.moveTo(wx, wy);
      g.lineTo(wx + Math.cos(a) * px(11), wy + Math.sin(a) * px(11)); g.stroke();
    }
    g.fillStyle = hex(COLORS.gold);
    g.beginPath(); g.arc(wx, wy, px(2.4), 0, 6.283); g.fill();
  }

  // START / FINISH chip painted on the road (drawn, no emoji).
  _lsDrawFlag(g, x, y, color, label) {
    g.save();
    g.font = '900 12px Rubik, sans-serif';
    const w = g.measureText(label).width + 18;
    const ry = y - 30;
    g.globalAlpha = 0.9; g.fillStyle = 'rgba(10,14,34,0.9)';
    this._roundRect(g, x - w / 2, ry - 11, w, 22, 11); g.fill();
    g.globalAlpha = 1; g.strokeStyle = color; g.lineWidth = 2;
    this._roundRect(g, x - w / 2, ry - 11, w, 22, 11); g.stroke();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x, ry);
    // little pole connecting the chip to the road point
    g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, ry + 11); g.lineTo(x, y - 4); g.stroke();
    g.restore();
  }

  // BEACH — COMING SOON teaser vignette at the top of the map.
  _lsDrawBeach(g, layout) {
    const { W, beach } = layout;
    const top = 8, h = beach.y + layout.nodeStep * 0.4;
    // sea gradient
    const sea = g.createLinearGradient(0, top, 0, h * 0.7);
    sea.addColorStop(0, '#2bb6c8');
    sea.addColorStop(1, '#4fd0d8');
    g.fillStyle = sea; g.fillRect(0, top, W, h * 0.7 - top);
    // wavelets
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
    for (let y = top + 18; y < h * 0.6; y += 16) {
      g.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const yy = y + Math.sin(x * 0.05 + y) * 2;
        x ? g.quadraticCurveTo(x - 12, yy - 3, x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    }
    // sand
    const sand = g.createLinearGradient(0, h * 0.55, 0, h);
    sand.addColorStop(0, mix(COLORS.sand, 0xffffff, 0.2));
    sand.addColorStop(1, shade(COLORS.sand, 0.9));
    g.fillStyle = sand;
    g.beginPath();
    g.moveTo(0, h * 0.66);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, h * 0.62 + Math.sin(x * 0.03) * 8);
    g.lineTo(W, h); g.lineTo(0, h); g.closePath(); g.fill();
    // palm tree
    const px2 = W * 0.74, py2 = h * 0.72;
    g.strokeStyle = shade(COLORS.woodDark, 1.1); g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px2, py2 + 30); g.quadraticCurveTo(px2 - 10, py2, px2 - 4, py2 - 26); g.stroke();
    g.fillStyle = '#2f9e54';
    for (let k = 0; k < 5; k++) {
      const a = -1.6 + k * 0.7;
      g.beginPath();
      g.moveTo(px2 - 4, py2 - 26);
      g.quadraticCurveTo(px2 - 4 + Math.cos(a) * 24, py2 - 26 + Math.sin(a) * 20,
        px2 - 4 + Math.cos(a) * 40, py2 - 22 + Math.sin(a) * 26);
      g.quadraticCurveTo(px2 - 4 + Math.cos(a) * 22, py2 - 24 + Math.sin(a) * 14, px2 - 4, py2 - 26);
      g.fill();
    }
    g.fillStyle = '#8a5a2b';
    g.beginPath(); g.arc(px2 - 4, py2 - 26, 4, 0, 6.283); g.fill();
    // banner
    g.save();
    g.font = '900 22px Rubik, sans-serif';
    const label = 'BEACH — COMING SOON';
    const bw = g.measureText(label).width + 40;
    const by = top + 26;
    g.fillStyle = 'rgba(10,14,34,0.82)';
    this._roundRect(g, W / 2 - bw / 2, by - 18, bw, 36, 12); g.fill();
    g.strokeStyle = hex(COLORS.gold); g.lineWidth = 2.5;
    this._roundRect(g, W / 2 - bw / 2, by - 18, bw, 36, 12); g.stroke();
    g.fillStyle = hex(COLORS.gold); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, W / 2, by);
    g.restore();
  }

  // rounded-rect path helper.
  _roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  /**
   * Build (or rebuild) the level-select map: compute layout, paint the world
   * cache, size the spacer/canvas, and lay out the 20 node markers.
   */
  _renderLevelMap() {
    const layout = this._lsComputeLayout();
    this._lsLayout = layout;
    this._lsPaintWorld(layout);
    this._lsPhase = this._lsCurrentPhase();

    // The scroll content is as tall as the painted world.
    this._lsSpacer.style.height = `${layout.H}px`;
    this._lsNodeLayer.style.height = `${layout.H}px`;
    this._lsNodeLayer.style.width = `${layout.W}px`;
    // Canvas is sized to the VIEWPORT (we blit a slice each scroll).
    this._lsResizeCanvas();

    // --- node markers (DOM buttons over the canvas) ---
    this._lsNodeLayer.textContent = '';
    this._lsNodes = [];
    const unlocked = this._unlockedCount();
    let firstFocus = null, currentNode = null;

    for (const p of layout.pts) {
      const index = p.index;
      const completed = this._isCompleted(index);
      const isCurrent = !completed && index === unlocked;
      const locked = index > unlocked;
      const stars = completed ? this._starsFor(index) : 0;

      let cls = 'mf-ls-node';
      if (locked) cls += ' mf-ls-locked';
      else if (completed) cls += ' mf-ls-done';
      else if (isCurrent) cls += ' mf-ls-current';
      else cls += ' mf-ls-open';

      const node = el(locked ? 'div' : 'button', cls, this._lsNodeLayer);
      if (!locked) node.type = 'button';
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.dataset.index = String(index);

      // drawn stars row (completed only) — small SVG stars, no emoji
      if (completed) {
        const sw = el('div', 'mf-ls-stars', node);
        for (let k = 0; k < 3; k++) {
          sw.appendChild(this._svgStar(k < stars));
        }
      }

      // UFO marker (CSS art: dome + body + glowing rim) with the level NUMBER.
      const ufo = el('div', 'mf-ls-ufo', node);
      el('div', 'mf-ls-ufo-dome', ufo);
      const body = el('div', 'mf-ls-ufo-body', ufo);
      el('div', 'mf-ls-ufo-rim', body);
      el('div', 'mf-ls-num', node, String(index));

      // tiny goal label
      if (p.target > 0) el('div', 'mf-ls-goal', node, `${fmt(p.target)} pts`);

      if (locked) {
        node.appendChild(this._svgLock());        // drawn padlock
        node.setAttribute('aria-disabled', 'true');
      } else {
        if (completed) node.appendChild(this._svgCheck());   // drawn check
        node.setAttribute('aria-label',
          `Level ${index}${completed ? ', completed' : ''}${isCurrent ? ', current' : ''}, goal ${fmt(p.target)} points`);
        node.addEventListener('click', (e) => { e.preventDefault(); this._startLevel(index); });
        if (isCurrent) currentNode = node;
        if (!firstFocus) firstFocus = node;
      }
      this._lsNodes.push(node);
    }
    this._lsFocusNode = currentNode || firstFocus;
    this._lsCurrentY = (currentNode || firstFocus)
      ? parseFloat((currentNode || firstFocus).style.top) : layout.H - layout.botPad;
  }

  // --- small drawn SVG icons (no emoji) ----------------------------------
  _svgStar(on) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', `mf-ls-star${on ? ' mf-ls-star-on' : ''}`);
    svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M12 2l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.8 5.9 20.3l1.3-6.7-5-4.6 6.8-.8z');
    svg.appendChild(p);
    return svg;
  }
  _svgCheck() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'mf-ls-check'); svg.setAttribute('viewBox', '0 0 24 24');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '11');
    c.setAttribute('class', 'mf-ls-check-bg');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M6 12.5l4 4 8-9'); p.setAttribute('class', 'mf-ls-check-tick');
    svg.appendChild(c); svg.appendChild(p);
    return svg;
  }
  _svgLock() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'mf-ls-lock'); svg.setAttribute('viewBox', '0 0 24 24');
    const shackle = document.createElementNS(ns, 'path');
    shackle.setAttribute('d', 'M8 10V8a4 4 0 0 1 8 0v2');
    shackle.setAttribute('class', 'mf-ls-lock-shackle');
    const body = document.createElementNS(ns, 'rect');
    body.setAttribute('x', '5'); body.setAttribute('y', '10'); body.setAttribute('width', '14');
    body.setAttribute('height', '11'); body.setAttribute('rx', '2.5');
    body.setAttribute('class', 'mf-ls-lock-body');
    svg.appendChild(shackle); svg.appendChild(body);
    return svg;
  }

  // --- day-phase tint ----------------------------------------------------
  _lsCurrentPhase() {
    try {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--mf-phase-glow').trim() || '#7aa2ff';
    } catch (_) { return '#7aa2ff'; }
  }

  // Blit the visible slice of the cached world onto the viewport canvas,
  // then a phase-tinted scrim so the map matches the time of day.
  _lsBlit() {
    const ctx = this._lsCtx;
    const layout = this._lsLayout;
    if (!ctx || !layout) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = this._lsCanvas.width / dpr;
    const vh = this._lsCanvas.height / dpr;
    const top = this._lsScroll.scrollTop;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    // source slice from the cache (in CSS px → cache is DPR-scaled)
    const cdpr = this._lsCache.width / layout.W;
    ctx.drawImage(this._lsCache,
      0, top * cdpr, layout.W * cdpr, vh * cdpr,
      0, 0, layout.W, vh);
    // day-cycle scrim
    const phase = this._lsPhase || this._lsCurrentPhase();
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = phase;
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();
    // a top sky glow of the same phase
    const sky = ctx.createLinearGradient(0, 0, 0, vh * 0.4);
    sky.addColorStop(0, this._withAlpha(phase, 0.22));
    sky.addColorStop(1, this._withAlpha(phase, 0));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, vw, vh * 0.4);
  }

  _withAlpha(color, a) {
    // color is 'rgb(r,g,b)' or '#rrggbb'
    if (color.startsWith('#')) {
      const n = parseInt(color.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    return color.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  }

  _lsResizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const layout = this._lsLayout;
    const vw = layout ? layout.W : (this._lsScroll.clientWidth || 360);
    const vh = this._lsScroll.clientHeight || 560;
    this._lsCanvas.width = Math.round(vw * dpr);
    this._lsCanvas.height = Math.round(vh * dpr);
    this._lsCanvas.style.width = `${vw}px`;
    this._lsCanvas.style.height = `${vh}px`;
    this._lsBlit();
  }

  // Scroll handler: keep the sticky canvas pinned to the viewport top and
  // re-blit the matching slice (cheap — no full repaint).
  _lsOnScroll() {
    this._lsCanvas.style.transform = `translateY(${this._lsScroll.scrollTop}px)`;
    if (this._lsRaf) return;
    this._lsRaf = requestAnimationFrame(() => { this._lsRaf = 0; this._lsBlit(); });
  }

  /** Public: open the LEVEL SELECT world map. */
  showLevelSelect() {
    this.hideEnd();
    const s = this._levelSelEl;
    s.classList.remove('mf-hidden');
    this._levelSelectVisible = true;
    // Render after the overlay is laid out so clientWidth/Height are real.
    requestAnimationFrame(() => {
      this._renderLevelMap();
      s.classList.remove('mf-anim');
      void s.offsetWidth;
      s.classList.add('mf-anim');
      // Auto-center the CURRENT level (or first playable) in the viewport.
      const vh = this._lsScroll.clientHeight || 560;
      this._lsScroll.scrollTop = Math.max(0, this._lsCurrentY - vh / 2);
      this._lsOnScroll();
      const focus = this._lsFocusNode || this._lsBackBtn;
      if (focus) focus.focus({ preventScroll: true });
      // Slow watcher: re-tint when the day phase changes.
      this._lsStartPhaseWatch();
    });
  }

  _lsStartPhaseWatch() {
    this._lsStopPhaseWatch();
    this._lsPhaseTimer = setInterval(() => {
      if (!this._levelSelectVisible) return;
      const phase = this._lsCurrentPhase();
      if (phase !== this._lsPhase) { this._lsPhase = phase; this._lsBlit(); }
    }, 2000);
  }
  _lsStopPhaseWatch() {
    if (this._lsPhaseTimer) { clearInterval(this._lsPhaseTimer); this._lsPhaseTimer = 0; }
  }

  /** Hide the level-select map (without choosing a level). */
  hideLevelSelect() {
    this._levelSelEl.classList.add('mf-hidden');
    this._levelSelectVisible = false;
    this._lsStopPhaseWatch();
  }

  /** BACK from level select → return to the mode selector view. */
  _closeLevelSelect() {
    this.hideLevelSelect();
    if (!this._startVisible) this.showStart(this._lastHighscore || 0);
    this._setStartViewForced('modes');
  }

  /** Like _setStartView but tolerant of being called when already on title. */
  _setStartViewForced(name) {
    if (this._startView === name) {
      const toModes = name === 'modes';
      this._startTitleView.classList.toggle('mf-startview-on', !toModes);
      this._startModesView.classList.toggle('mf-startview-on', toModes);
      if (toModes) (this._campaignCard || this._freePlayCard || this._modesBackBtn).focus({ preventScroll: true });
      return;
    }
    this._setStartView(name);
  }

  /** A playable node was activated → fire onStartLevel and close the map. */
  _startLevel(index) {
    this.hideLevelSelect();
    this.cb.onStartLevel(index);
  }

  // ======================================================================
  // COUNTDOWN
  // ======================================================================

  _buildCountdown() {
    const c = el('div', 'mf-countdown mf-hidden');
    c.id = 'mf-countdown';
    document.body.appendChild(c);
    this._countEl = c;
  }

  /** 3…2…1…GO! Resolves the moment GO! stamps in (gameplay unfreezes then). */
  countdown() {
    const c = this._countEl;
    c.textContent = '';
    c.classList.remove('mf-hidden');
    const seq = ['3', '2', '1', 'GO!'];
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        c.textContent = '';
        const isGo = seq[i] === 'GO!';
        el('div', `mf-count-num${isGo ? ' mf-count-go' : ''}`, c, seq[i]);
        if (isGo) {
          resolve();
          setTimeout(() => {
            c.classList.add('mf-hidden');
            c.textContent = '';
          }, 750);
        } else {
          i++;
          setTimeout(step, 800);
        }
      };
      step();
    });
  }

  // ======================================================================
  // PAUSE
  // ======================================================================

  _buildPause() {
    const s = el('div', 'mf-screen mf-pause mf-hidden');
    s.id = 'mf-pause';
    const panel = el('div', 'mf-panel mf-pause-panel', s);

    // --- root view: RESUME / RESTART / SETTINGS / QUIT TO MENU ---
    const root = el('div', 'mf-pview mf-pview-root', panel);
    el('h2', 'mf-panel-title', root, 'PAUSED');
    const col = el('div', 'mf-btn-col', root);
    this._resumeBtn = button('mf-btn-primary', col, 'RESUME', () => this.cb.onResume());
    button('', col, 'RESTART', () => this.cb.onRestart());
    button('', col, 'SETTINGS', () => this._setPauseView('settings'));
    button('mf-btn-quiet', col, 'QUIT TO MENU', () => this.cb.onQuitToMenu());
    this._pauseRootView = root;

    // --- settings sub-view (slides in over the root view) ---
    const settings = el('div', 'mf-pview mf-pview-settings mf-view-off', panel);
    this._settingsView = settings;
    this._buildSettings(settings);

    document.body.appendChild(s);
    this._pauseEl = s;
  }

  _buildSettings(view) {
    const head = el('div', 'mf-set-head', view);
    this._backBtn = backButton('', head, 'BACK', () => this._setPauseView('root'));
    el('h2', 'mf-panel-title mf-set-title', head, 'SETTINGS');

    // SOUND toggle row (state mirrored via setMuteUI, as before).
    const soundRow = el('div', 'mf-set-row', view);
    el('div', 'mf-set-label', soundRow, 'SOUND');
    this._muteBtn = button('mf-btn-toggle mf-btn-mute', soundRow, '',
      () => this.cb.onToggleMute());
    // Drawn speaker icon (CSS art) + a text label, refreshed by setMuteUI.
    this._muteIco = el('span', 'mf-spk', this._muteBtn);
    this._muteTxt = el('span', 'mf-mute-txt', this._muteBtn, 'ON');

    // On touch devices the recap matters most → it goes above the key binds
    // (which still render — hardware keyboards exist).
    const binds = this._buildBindsSection();
    const recap = this._buildRecapSection();
    if (IS_MOBILE) { view.appendChild(recap); view.appendChild(binds); }
    else { view.appendChild(binds); view.appendChild(recap); }

    // While a rebind capture is active, swallow every other click in here.
    view.addEventListener('click', (e) => {
      if (this._capturing) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  _buildBindsSection() {
    const sec = el('div', 'mf-set-section mf-binds');
    el('div', 'mf-set-heading', sec, 'KEY BINDS');
    this._bindHint = el('div', 'mf-bind-hint', sec, 'press a key · ESC cancels');
    this._bindChips = {};
    for (const [action, label] of BIND_ACTIONS) {
      const row = el('div', 'mf-set-row mf-bind-row', sec);
      el('div', 'mf-set-label', row, label);
      this._bindChips[action] = button('mf-keycap', row, '—',
        () => this._beginRebind(action));
    }
    this._resetBindsBtn = button('mf-btn-quiet mf-btn-resetbinds', sec,
      'RESET TO DEFAULTS', () => {
        if (this._capturing || !this.controls) return;
        try { this.controls.resetBinds?.(); }
        catch (err) { console.warn('[UI] resetBinds failed:', err); }
        this._refreshBinds();
      });
    this._bindsSection = sec;
    return sec;
  }

  _buildRecapSection() {
    const sec = el('div', 'mf-set-section');
    el('div', 'mf-set-heading', sec, 'OTHER CONTROLS');
    const touch = el('div', 'mf-recap-row', sec);
    el('span', 'mf-recap-ico mf-ico-touch', touch);   // drawn touch/hand mark
    el('span', 'mf-recap-txt', touch, 'left side: joystick / hold BEAM / hold WARP');
    this._gamepadRow = el('div', 'mf-recap-row mf-hidden', sec);
    el('span', 'mf-recap-ico mf-ico-pad', this._gamepadRow); // drawn gamepad mark
    el('span', 'mf-recap-txt', this._gamepadRow,
      'left stick fly · right stick camera · RT beam · LB warp · Start pause');
    return sec;
  }

  /** Slide between the pause root view and the settings sub-view. */
  _setPauseView(name) {
    if (this._capturing || name === this._pauseView) return;
    this._pauseView = name;
    if (name === 'settings') {
      this._refreshBinds();
      this._refreshGamepadRow();
      this._pauseRootView.classList.add('mf-view-off');
      this._pauseRootView.classList.remove('mf-slide-in-l');
      this._settingsView.classList.remove('mf-view-off');
      this._settingsView.classList.add('mf-slide-in-r');
      this._backBtn.focus({ preventScroll: true });
    } else {
      this._settingsView.classList.add('mf-view-off');
      this._settingsView.classList.remove('mf-slide-in-r');
      this._pauseRootView.classList.remove('mf-view-off');
      this._pauseRootView.classList.add('mf-slide-in-l');
      this._resumeBtn.focus({ preventScroll: true });
    }
  }

  /** Refresh every key-cap chip — a rebind may have stolen another action's key. */
  _refreshBinds() {
    const ctl = this.controls;
    const usable = !!(ctl && (ctl.bindLabels || ctl.binds));
    this._bindsSection.classList.toggle('mf-hidden', !usable);
    if (!usable) return;
    const labels = ctl.bindLabels || {};
    for (const action of Object.keys(this._bindChips)) {
      const label = labels[action] ?? ctl.binds?.[action] ?? '—';
      const chip = this._bindChips[action];
      if (chip.textContent !== label) chip.textContent = label;
    }
  }

  _refreshGamepadRow() {
    this._gamepadRow.classList.toggle('mf-hidden', !this.controls?.gamepadConnected);
  }

  /** Chip tapped → capture mode ('…' + hint), await controls.rebind(action). */
  async _beginRebind(action) {
    if (this._capturing) return;
    const ctl = this.controls;
    if (!ctl || typeof ctl.rebind !== 'function') return;
    const chip = this._bindChips[action];
    this._capturing = true;
    this._settingsView.classList.add('mf-capturing');
    chip.classList.add('mf-capture');
    chip.textContent = '…';
    this._bindHint.classList.add('mf-show');
    try {
      await ctl.rebind(action); // resolves new label, or null if cancelled (Esc)
    } catch (err) {
      console.warn('[UI] rebind failed:', err);
    }
    this._capturing = false;
    this._settingsView.classList.remove('mf-capturing');
    chip.classList.remove('mf-capture');
    this._bindHint.classList.remove('mf-show');
    this._refreshBinds();
  }

  showPause(muted) {
    this.setMuteUI(!!muted);
    // Always reopen on the root view, with no stale slide animation.
    this._pauseView = 'root';
    this._pauseRootView.classList.remove('mf-view-off', 'mf-slide-in-l');
    this._settingsView.classList.add('mf-view-off');
    this._settingsView.classList.remove('mf-slide-in-r');
    this._pauseEl.classList.remove('mf-hidden');
    this._pauseVisible = true;
    this._resumeBtn.focus({ preventScroll: true });
  }

  hidePause() {
    this._pauseEl.classList.add('mf-hidden');
    this._pauseVisible = false;
  }

  setMuteUI(muted) {
    this._muted = !!muted;
    if (this._muteBtn) {
      if (this._muteTxt) this._muteTxt.textContent = this._muted ? 'OFF' : 'ON';
      if (this._muteIco) this._muteIco.classList.toggle('mf-spk-off', this._muted);
      this._muteBtn.classList.toggle('mf-muted', this._muted);
      this._muteBtn.setAttribute('aria-pressed', String(!this._muted));
    }
  }

  // ======================================================================
  // END SCREENS (game over / win share a shell)
  // ======================================================================

  _buildEndShell() {
    const s = el('div', 'mf-screen mf-end mf-hidden');
    s.id = 'mf-end';
    document.body.appendChild(s);
    this._endEl = s;
  }

  /** UFO destroyed. */
  showGameOver({ score = 0, cows = 0, highscore = 0, isNewBest = false } = {}) {
    this._renderEnd({
      theme: 'mf-theme-over',
      title: 'MOO-VER & OUT',
      sub: 'Your saucer got grounded!',
      medal: undefined,
      score, cows, highscore, isNewBest,
      primaryLabel: 'RETRY',
    });
  }

  /** Time up — results + medal stamp. */
  showWin({ score = 0, cows = 0, medal = null, highscore = 0, isNewBest = false } = {}) {
    this._renderEnd({
      theme: 'mf-theme-win',
      title: "TIME'S UP!",
      sub: 'The mothership thanks you.',
      medal,
      score, cows, highscore, isNewBest,
      primaryLabel: 'PLAY AGAIN',
    });
  }

  hideEnd() {
    this._endEl.classList.add('mf-hidden');
    this._endEl.textContent = '';
    this._endVisible = false;
  }

  _renderEnd({ theme, title, sub, medal, score, cows, highscore, isNewBest, primaryLabel }) {
    const s = this._endEl;
    s.textContent = '';
    s.className = `mf-screen mf-end ${theme}`;

    const panel = el('div', 'mf-panel mf-end-panel', s);

    if (theme === 'mf-theme-over') {
      // Crashed saucer CSS art with smoke puffs.
      const wreck = el('div', 'mf-wreck', panel);
      const ufo = el('div', 'mf-ufo-art mf-ufo-crashed', wreck);
      el('div', 'mf-ufo-dome', ufo);
      el('div', 'mf-ufo-body', ufo);
      for (let i = 0; i < 3; i++) {
        const p = el('div', 'mf-smoke', wreck);
        p.style.setProperty('--i', i);
      }
    }

    el('h2', 'mf-panel-title mf-end-title', panel, title);
    el('div', 'mf-end-sub', panel, sub);

    if (medal !== undefined) {
      if (medal) {
        const wrap = el('div', 'mf-medal-wrap', panel);
        const m = el('div', `mf-medal mf-medal-${medal}`, wrap);
        el('div', 'mf-medal-ribbon mf-medal-ribbon-l', m);
        el('div', 'mf-medal-ribbon mf-medal-ribbon-r', m);
        const disc = el('div', 'mf-medal-disc', m);
        const ms = this._svgStar(true);
        ms.classList.add('mf-medal-star');
        disc.appendChild(ms);
        el('div', 'mf-medal-label', wrap, `${medal.toUpperCase()} MEDAL`);
      } else {
        el('div', 'mf-nomedal', panel,
          `NO MEDAL — ${fmt(CFG.MEDALS.bronze)} PTS FOR BRONZE. KEEP BEAMING!`);
      }
    }

    if (isNewBest) {
      const rib = el('div', 'mf-ribbon', panel);
      const a = this._svgStar(true); a.classList.add('mf-ribbon-star');
      const b = this._svgStar(true); b.classList.add('mf-ribbon-star');
      rib.appendChild(a);
      el('span', 'mf-ribbon-txt', rib, 'NEW RECORD!');
      rib.appendChild(b);
    }

    const stats = el('div', 'mf-stats', panel);
    const stat = (label, value, opts) => {
      const row = el('div', 'mf-stat', stats);
      el('div', 'mf-stat-label', row, label);
      const v = el('div', 'mf-stat-value', row, '0');
      countUp(v, value, opts);
      return v;
    };
    stat('SCORE', score, { duration: 1000, delay: 250 });
    stat('COWS', cows, { duration: 700, delay: 500 });
    stat('BEST', Math.max(highscore, score), { duration: 700, delay: 700 });

    const rowBtns = el('div', 'mf-btn-row', panel);
    this._endPrimaryBtn = button('mf-btn-primary', rowBtns, primaryLabel, () => this.cb.onRestart());
    button('', rowBtns, 'MENU', () => this.cb.onQuitToMenu());

    s.classList.remove('mf-hidden');
    this._endVisible = true;
    this._endPrimaryBtn.focus({ preventScroll: true });
  }

  // ======================================================================
  // LEVEL RESULT — campaign-round results screen. Shares the .mf-end shell
  // (so the existing hideEnd() clears it too) but renders its own layout.
  // ======================================================================

  /**
   * @param {object} o
   *   won, index, score, target, time, isNewBest, starsEarned, hasNext
   */
  showLevelResult({
    won = false, index = 1, score = 0, target = 0, time = 0,
    isNewBest = false, starsEarned = 0, hasNext = false,
  } = {}) {
    // The level-select map (if open) should give way to the result.
    if (this._levelSelectVisible) this.hideLevelSelect();

    const stars = Math.max(0, Math.min(3, starsEarned | 0));
    const s = this._endEl;
    s.textContent = '';
    s.className = `mf-screen mf-end mf-levelresult ${won ? 'mf-theme-win mf-lr-won' : 'mf-theme-over mf-lr-fail'}`;

    const panel = el('div', 'mf-panel mf-end-panel mf-lr-panel', s);

    el('div', 'mf-lr-eyebrow', panel, `LEVEL ${index}`);
    el('h2', 'mf-panel-title mf-end-title mf-lr-title', panel,
      won ? 'MISSION COMPLETE' : 'MISSION FAILED');

    if (won) {
      // Three drawn (SVG) star slots; the earned ones pop in on a stagger.
      const sw = el('div', 'mf-lr-stars', panel);
      for (let k = 0; k < 3; k++) {
        const svg = this._svgStar(k < stars);
        svg.classList.add('mf-lr-star');
        if (k < stars) svg.classList.add('mf-lr-star-on');
        svg.style.setProperty('--i', k);
        sw.appendChild(svg);
      }
      if (isNewBest) el('div', 'mf-ribbon mf-lr-best', panel, 'NEW BEST!');
    } else {
      el('div', 'mf-end-sub mf-lr-sub', panel, 'The herd got away. Try again!');
    }

    // SCORE vs TARGET ("1240 / 1000").
    const scoreWrap = el('div', 'mf-lr-scoreline', panel);
    const scoreVal = el('span', 'mf-lr-score', scoreWrap, '0');
    el('span', 'mf-lr-sep', scoreWrap, ' / ');
    el('span', 'mf-lr-target', scoreWrap, fmt(target));
    scoreWrap.classList.toggle('mf-lr-hit', won || (target > 0 && score >= target));
    countUp(scoreVal, score, { duration: 900, delay: 300 });
    el('div', 'mf-lr-scorelabel', panel, 'SCORE / TARGET');

    // Buttons: NEXT (win+hasNext), RETRY, LEVEL SELECT, MENU.
    const rowBtns = el('div', 'mf-btn-row mf-lr-btns', panel);
    let primary = null;
    if (won && hasNext) {
      primary = button('mf-btn-primary mf-lr-next', rowBtns, 'NEXT LEVEL',
        () => this.cb.onNextLevel());
    }
    const retry = button(primary ? '' : 'mf-btn-primary', rowBtns, 'RETRY',
      () => this.cb.onRetryLevel());
    if (!primary) primary = retry;
    button('', rowBtns, 'LEVEL SELECT', () => this.cb.onLevelSelect());
    button('mf-btn-quiet', rowBtns, 'MENU', () => this.cb.onQuitToMenu());

    this._endPrimaryBtn = primary;
    s.classList.remove('mf-hidden');
    this._endVisible = true;
    primary.focus({ preventScroll: true });
  }

  // ======================================================================
  // Keyboard: Enter/Space confirms the visible screen's primary action.
  // ======================================================================

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      // Keyboard scrolling of the level-select map (repeat allowed for hold).
      if (this._levelSelectVisible && this._lsScroll) {
        const vh = this._lsScroll.clientHeight || 560;
        const step = (this._lsLayout?.nodeStep || 200);
        let dy = 0;
        if (e.code === 'ArrowDown') dy = step;
        else if (e.code === 'ArrowUp') dy = -step;
        else if (e.code === 'PageDown') dy = vh * 0.9;
        else if (e.code === 'PageUp') dy = -vh * 0.9;
        else if (e.code === 'Home') { this._lsScroll.scrollTop = 1e9; e.preventDefault(); return; } // bottom = level 1
        else if (e.code === 'End') { this._lsScroll.scrollTop = 0; e.preventDefault(); return; }    // top = FINISH/BEACH
        if (dy) { this._lsScroll.scrollTop += dy; e.preventDefault(); return; }
      }

      if (e.repeat) return;

      // Escape / Backspace → "back" on views that have a back affordance.
      if (e.code === 'Escape' || e.code === 'Backspace') {
        if (this._capturing) return; // a rebind capture owns Esc
        if (this._levelSelectVisible) {
          e.preventDefault();
          this._closeLevelSelect();
          return;
        }
        if (this._startVisible && this._startView === 'modes') {
          e.preventDefault();
          this._setStartView('title');
          return;
        }
        return;
      }

      const confirm = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
      if (!confirm) return;

      // Level select sits ABOVE the start overlay → handle it first.
      if (this._levelSelectVisible) {
        const focused = document.activeElement;
        // A focused playable node (or the BACK button) handles its own click.
        if (focused && focused.closest && focused.closest('#mf-levelsel') &&
            (focused.classList.contains('mf-ls-node') || focused === this._lsBackBtn)) {
          e.preventDefault();
          focused.click();
        } else if (this._lsFocusNode) {
          // Nothing useful focused → start the current/first playable level.
          e.preventDefault();
          this._lsFocusNode.click();
        }
        return;
      }

      if (this._startVisible) {
        e.preventDefault();
        if (this._startView === 'modes') {
          // If a specific card is focused, honour it (locked → coming soon,
          // campaign → level select); otherwise default to starting Free Play.
          const focused = document.activeElement;
          if (focused && focused.classList && focused.classList.contains('mf-mode-card')) {
            focused.click();
          } else {
            this._selectMode('freeplay');
          }
        } else {
          // Title view: PLAY → open the mode selector.
          this._pressPlay();
        }
      } else if (this._pauseVisible) {
        // A rebind capture owns the keyboard entirely.
        if (this._capturing) return;
        // In the settings sub-view, buttons handle their own Enter/Space.
        if (this._pauseView !== 'root') return;
        // Let a focused secondary button receive its own Enter/Space.
        if (document.activeElement && document.activeElement.closest('#mf-pause') &&
            document.activeElement !== this._resumeBtn && e.code !== 'Space') return;
        e.preventDefault();
        this.cb.onResume();
      } else if (this._endVisible) {
        if (document.activeElement && document.activeElement.closest('#mf-end') &&
            document.activeElement !== this._endPrimaryBtn && e.code !== 'Space') return;
        e.preventDefault();
        // Campaign results route through the focused primary button (NEXT or
        // RETRY); Free-Play game-over/win fall back to onRestart as before.
        if (this._endEl.classList.contains('mf-levelresult') && this._endPrimaryBtn) {
          this._endPrimaryBtn.click();
        } else {
          this.cb.onRestart();
        }
      }
    });
  }
}
