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
    campaign, wallet,
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
    // isCompleted(i), bestScore(i), starsFor(i) (0..3), totalStars (getter),
    // beachUnlocked (getter), BEACH_STARS }. Fully optional — every access is
    // guarded so a missing/partial campaign just yields an empty map.
    this.campaign = campaign || null;
    // Cow-coin wallet store: { getBalance() -> number }. Optional & duck-typed
    // so the coin widget shows 0 (and never throws) if no wallet is wired up.
    this.wallet = wallet || null;
    this._coinShown = 0;   // last value rendered into the coin widget
    this._coinRaf = 0;     // rAF handle for the count-up animation

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
    // Fallback: synthesise 15 placeholder levels so the map still renders.
    if (!this._fallbackLevels) {
      this._fallbackLevels = Array.from({ length: 15 }, (_, i) => ({
        index: i + 1, target: 1000 + i * 640, time: 90,
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

  // Stars earned on a completed level (0..3). Tolerates a campaign that
  // doesn't expose starsFor() yet (older builds returned 0/stub) by falling
  // back to a single "completed" star.
  _starsFor(i) {
    try {
      const s = this.campaign?.starsFor?.(i);
      if (s == null) return this._isCompleted(i) ? 1 : 0;
      return Math.max(0, Math.min(3, s | 0));
    } catch (_) { return this._isCompleted(i) ? 1 : 0; }
  }

  // Sum of stars across the campaign (drives the BEACH gate).
  _totalStars() {
    try {
      const c = this.campaign;
      if (c && c.totalStars != null) return Math.max(0, c.totalStars | 0);
    } catch (_) { /* fall through */ }
    let n = 0;
    for (const lv of this._levels()) n += this._starsFor(lv.index ?? 0);
    return n;
  }

  // Stars required to unlock the BEACH world (campaign.BEACH_STARS, else 35).
  _beachStars() {
    try {
      const c = this.campaign;
      if (c && c.BEACH_STARS != null) return c.BEACH_STARS | 0;
    } catch (_) { /* fall through */ }
    return 35;
  }

  _beachUnlocked() {
    try {
      const c = this.campaign;
      if (c && c.beachUnlocked != null) return !!c.beachUnlocked;
    } catch (_) { /* fall through */ }
    return this._totalStars() >= this._beachStars();
  }

  // Current cow-coin balance from the wallet store (0 if unwired).
  _coinBalance() {
    try { return Math.max(0, Number(this.wallet?.getBalance?.()) || 0); }
    catch (_) { return 0; }
  }

  // ----------------------------------------------------------------------
  // COW-COIN balance widget — a small gold coin (drawn SVG: gold disc + a
  // little cow face) followed by the live balance. The same widget appears
  // on the mode selector and the level-select header; both share this._coins
  // (a list) so setCoinBalance / animateCoinBalance update every instance.
  // ----------------------------------------------------------------------
  _buildCoinWidget(parent, extraCls = '') {
    const wrap = el('div', `mf-coin-widget ${extraCls}`, parent);
    wrap.appendChild(this._svgCoin());
    const num = el('span', 'mf-coin-num', wrap, fmt(this._coinShown || this._coinBalance()));
    wrap._numEl = num;
    if (!this._coins) this._coins = [];
    this._coins.push(wrap);
    return wrap;
  }

  // Drawn cow-coin: a gold disc with a rim, plus a minimal cow face (white
  // muzzle, two dark spots/ears, nostrils). NO emoji — pure SVG.
  _svgCoin() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'mf-coin-ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    const mk = (tag, attrs) => {
      const n = document.createElementNS(ns, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      return n;
    };
    mk('circle', { cx: 12, cy: 12, r: 11, class: 'mf-coin-disc' });
    mk('circle', { cx: 12, cy: 12, r: 8.6, class: 'mf-coin-inner' });
    // cow ears (two dark blobs up top)
    mk('ellipse', { cx: 7.4, cy: 7.6, rx: 2.0, ry: 1.4, transform: 'rotate(-28 7.4 7.6)', class: 'mf-coin-cow' });
    mk('ellipse', { cx: 16.6, cy: 7.6, rx: 2.0, ry: 1.4, transform: 'rotate(28 16.6 7.6)', class: 'mf-coin-cow' });
    // a head spot
    mk('ellipse', { cx: 9.4, cy: 10.4, rx: 2.0, ry: 1.7, class: 'mf-coin-cow' });
    // muzzle (light) with two nostrils
    mk('ellipse', { cx: 12, cy: 14.6, rx: 4.2, ry: 3.0, class: 'mf-coin-muzzle' });
    mk('circle', { cx: 10.5, cy: 14.7, r: 0.8, class: 'mf-coin-cow' });
    mk('circle', { cx: 13.5, cy: 14.7, r: 0.8, class: 'mf-coin-cow' });
    return svg;
  }

  /** Public: snap the coin balance widget(s) to `n`. */
  setCoinBalance(n) {
    if (this._coinRaf) { cancelAnimationFrame(this._coinRaf); this._coinRaf = 0; }
    const v = Math.max(0, Math.round(Number(n) || 0));
    this._coinShown = v;
    this._renderCoin(v);
  }

  /** Public: smooth count-up of the coin balance widget(s) from→to (ease-out). */
  animateCoinBalance(from, to, { duration = 900 } = {}) {
    if (this._coinRaf) { cancelAnimationFrame(this._coinRaf); this._coinRaf = 0; }
    const a = Math.max(0, Math.round(Number(from) || 0));
    const b = Math.max(0, Math.round(Number(to) || 0));
    if (a === b) { this.setCoinBalance(b); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0) / duration));
      const e = 1 - Math.pow(1 - t, 3);            // ease-out cubic
      const v = Math.round(a + (b - a) * e);
      this._coinShown = v;
      this._renderCoin(v);
      // pop the widget(s) each frame the value changes (handled via class)
      if (t < 1) this._coinRaf = requestAnimationFrame(tick);
      else { this._coinRaf = 0; this._coinShown = b; this._renderCoin(b); }
    };
    this._pulseCoins();
    this._coinRaf = requestAnimationFrame(tick);
  }

  _renderCoin(v) {
    const txt = fmt(v);
    if (!this._coins) return;
    for (const w of this._coins) {
      if (w && w._numEl && w._numEl.textContent !== txt) w._numEl.textContent = txt;
    }
  }

  _pulseCoins() {
    if (!this._coins) return;
    for (const w of this._coins) {
      if (!w) continue;
      w.classList.remove('mf-coin-pop');
      void w.offsetWidth;
      w.classList.add('mf-coin-pop');
    }
  }

  /** Refresh every coin widget to the wallet's current balance (no animation). */
  _refreshCoinWidgets() {
    this.setCoinBalance(this._coinBalance());
  }

  /** Toggle the header BEACH world chip locked/unlocked from the star total. */
  _refreshBeachWorld() {
    const w = this._lsBeachWorld;
    if (!w) return;
    const unlocked = this._beachUnlocked();
    w.classList.toggle('mf-ls-world-locked', !unlocked);
    w.classList.toggle('mf-ls-world-on', unlocked);
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
    // Persistent cow-coin balance widget (top-right of the mode selector).
    this._modesCoin = this._buildCoinWidget(head, 'mf-coin-modes');

    const grid = el('div', 'mf-mode-grid', view);

    // CAMPAIGN is now playable (opens LEVEL SELECT). MULTIPLAYER stays locked
    // ("coming soon"). FREE PLAY runs the normal start flow.
    const MODES = [
      { key: 'campaign',    name: 'CAMPAIGN',    sub: '15 missions across the farm galaxy', locked: false },
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
      this._refreshCoinWidgets();
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
  // LEVEL SELECT — a hand-illustrated, scrolling WORLD MAP in the MOO-FO art
  // style (a designed landscape, NOT a scaled-down copy of the 3D farm). A
  // hi-res <canvas> (DPR-scaled) paints the world ONCE into an offscreen
  // cache; we only re-blit the visible slice on scroll / day-phase change.
  // A single smooth dirt road is the hero, winding bottom→top; all scenery
  // (a smooth river crossed only by little wooden bridges + sourced from the
  // mountains, outline-only cow pens with grazing cows & sheep, organic ponds,
  // a tidy upright farm hamlet, trees) is composed AROUND it, and a detailed
  // hazy mountain range backdrops the summit at the very top. One numbered UFO
  // node per campaign level (count = campaign.levels.length, NOT hardcoded)
  // rides the road as absolutely-positioned DOM buttons; a locked BEACH world
  // teases beyond the FINISH. FULL-SCREEN: the map fills the entire viewport
  // edge-to-edge with floating chrome overlaid. Re-tints with the day cycle.
  // ======================================================================

  _buildLevelSelect() {
    const s = el('div', 'mf-screen mf-levelsel mf-hidden');
    s.id = 'mf-levelsel';

    // Day-cycle scrim — driven by --mf-phase-glow (set on :root by the HUD).
    el('div', 'mf-ls-sky', s);

    // FULL-SCREEN map: the scroll viewport fills the ENTIRE screen edge-to-edge
    // (100vw × 100vh, no framed inset, no gutters). All chrome floats OVER it.
    const scroll = el('div', 'mf-ls-scroll', s);
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

    // Floating chrome OVER the full-screen map:
    //   • a floating BACK button (top-left)
    //   • the CAMPAIGN title + FARM/BEACH worlds indicator (top, overlaid)
    //   • a persistent cow-coin balance widget (top-right)
    const overlay = el('div', 'mf-ls-overlay', s);
    this._lsBackBtn = backButton('mf-ls-back', overlay, 'BACK',
      () => this._closeLevelSelect());
    const titleWrap = el('div', 'mf-ls-titlewrap', overlay);
    el('h2', 'mf-panel-title mf-ls-title', titleWrap, 'CAMPAIGN');
    // Worlds indicator: FARM (active, drawn check) · BEACH (locked, drawn lock).
    const worlds = el('div', 'mf-ls-worlds', titleWrap);
    const wFarm = el('div', 'mf-ls-world mf-ls-world-on', worlds);
    el('span', 'mf-ls-world-mark mf-ls-world-check', wFarm);
    el('span', 'mf-ls-world-name', wFarm, 'FARM');
    const wBeach = el('div', 'mf-ls-world mf-ls-world-locked', worlds);
    el('span', 'mf-ls-world-mark mf-ls-world-lock', wBeach);
    el('span', 'mf-ls-world-name', wBeach, 'BEACH');
    this._lsBeachWorld = wBeach;
    // Coin balance widget (top-right of the level select).
    this._lsCoin = this._buildCoinWidget(overlay, 'mf-coin-ls');

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

  // -- geometry: compute node points + a smooth, flowing journey road -------
  // Returns layout in CSS px for the current viewport width. ~3 nodes per
  // screen-height: nodeStep = visibleHeight / 3 (clamped). Map runs bottom
  // (level 1, near START) → top (FINISH → BEACH teaser).
  //
  // PHILOSOPHY (not a scaled-down 3D farm): the ROAD is the hero. It is a
  // single ribbon winding bottom→top in gentle S-curves; ALL scenery is then
  // composed AROUND it. The road never crosses a building or water — water is
  // a meandering river/ponds laid on the OPPOSITE side of the road from the
  // current bend, and where the road must cross it we place an intentional
  // little wooden bridge. A hazy mountain range sits ONLY as the far backdrop
  // at the very top (the campaign's summit).
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
    // Top padding reserves room ABOVE the last level for the FINISH chip and
    // the hazy mountain backdrop + BEACH teaser band; scale to the step.
    const topPad = Math.max(vh * 0.42, nodeStep * 2.8);
    const botPad = Math.max(130, vh * 0.24);  // room below level 1 / START
    const H = topPad + botPad + (n - 1) * nodeStep;

    const midX = W * 0.5;
    const margin = 48;                         // keep the 64px markers on-canvas
    const amp = W * 0.26;                       // base lean amplitude
    const maxSway = Math.max(20, W * 0.30);    // wider maps lean more gracefully
    const clampX = (x) => Math.max(margin, Math.min(W - margin, x));

    // Smooth, flowing node x-offsets: a single low-frequency sine plus a
    // slower second harmonic gives gentle S-bends and NO sharp kinks (the
    // jittery high-freq term that made the old road choppy is gone). A fixed
    // phase keeps it deterministic.
    const phase = 0.6;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const y = H - botPad - i * nodeStep;
      const a = Math.sin(i * 0.62 + phase);
      const b = Math.sin(i * 0.29 + 2.1) * 0.55;
      let sway = (a * 0.7 + b) * amp;
      sway = Math.max(-maxSway, Math.min(maxSway, sway));
      pts.push({ x: clampX(midX + sway), y, index: levels[i].index ?? i + 1, target: Number(levels[i].target) || 0 });
    }
    // START a little below level 1, FINISH gently above level n.
    const finish = { x: clampX(midX + Math.sin((n - 0.6) * 0.62 + phase) * amp * 0.6), y: H - botPad - (n - 1 + 0.8) * nodeStep };
    const start = { x: pts[0].x, y: pts[0].y + nodeStep * 0.72 };
    const beach = { x: midX, y: finish.y - nodeStep * 1.45 };

    // Build the smooth Catmull-Rom centreline through start→nodes→finish and
    // sample it densely. Everything downstream (road rendering, where the
    // river runs, where bridges/cows/props sit) keys off this one path so the
    // whole composition stays cohesive and the road is never crossed wrongly.
    const ctrl = [start, ...pts, finish];
    const samples = this._lsSampleSpline(ctrl, 14); // {x,y} densely along road

    // Quick road-x lookup by height (nearest sample).
    const roadXAtY = (y) => {
      let bx = samples[0].x, bd = 1e9;
      for (const s of samples) { const d = Math.abs(s.y - y); if (d < bd) { bd = d; bx = s.x; } }
      return bx;
    };
    const top = samples[0].y, bot = samples[samples.length - 1].y;
    const span = bot - top || 1;

    // ----- THE RIVER: a SMOOTH, gentle, low-frequency curve -----------------
    // Its SOURCE is the mountain range at the very top: it begins up in the
    // haze (above the FINISH, at the mountains' foot) and flows down to leave
    // the map at the bottom. We choose just a handful of control anchors so the
    // curve has only a FEW soft bends (no hooks/kinks). Each anchor sits a
    // comfortable GAP to one side of the road; we flip sides exactly TWICE, and
    // place a bridge at each flip (the only places water meets the road).
    const gap = Math.max(74, W * 0.20);     // how far the river sits off the road
    // crossing heights (where the river swaps sides under a bridge), well
    // spaced along the journey so the two bridges never bunch up.
    const crossY = [bot - 0.30 * span, bot - 0.68 * span];
    // The river "source" anchor sits up in the mountain foot, slightly off the
    // map centre so it reads as spilling out of a specific valley.
    const srcY = top - nodeStep * 0.55;     // up in the haze (above FINISH)
    const srcX = clampX(midX - amp * 0.34);

    // Build river control anchors top→bottom. Side starts on whichever side of
    // the road the source favours, then flips at each crossing height.
    const sideAt = (idx) => (idx % 2 === 0 ? 1 : -1); // +1 = right of road
    // anchors run TOP→BOTTOM, i.e. ascending y (source first, then each
    // crossing in descending screen height, then a final off-map anchor).
    const anchorY = [srcY, ...crossY.slice().sort((a, b) => a - b), bot + nodeStep * 0.5];
    const riverCtrl = [];
    // source: blended out of the mountains (sits near map centre, faded later).
    riverCtrl.push({ x: srcX, y: srcY });
    let seg = 0;
    for (let i = 0; i < anchorY.length; i++) {
      const ay = anchorY[i];
      if (i > 0 && i <= crossY.length) {
        // a crossing anchor sits right ON the road centreline (the bridge).
        riverCtrl.push({ x: roadXAtY(ay), y: ay });
        seg++;
      } else if (i > crossY.length) {
        // final anchor below the map: park it to the current side, off-road.
        const side = sideAt(seg);
        riverCtrl.push({ x: clampX(roadXAtY(ay) + side * gap), y: ay });
      }
      // between crossings, drop ONE gentle mid anchor offset to the active side
      // so each reach bows softly instead of running dead straight.
      const next = anchorY[i + 1];
      if (next != null) {
        const my = (ay + next) / 2;
        const side = sideAt(seg);
        riverCtrl.push({ x: clampX(roadXAtY(my) + side * gap), y: my });
      }
    }
    // densely sample the river spline (smooth, no kinks).
    const riverPath = this._lsSampleSpline(riverCtrl, 18);

    // bridges sit exactly at the crossing heights, angled to the road tangent.
    const bridges = crossY.map((cy) => {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < samples.length; i++) {
        const d = Math.abs(samples[i].y - cy); if (d < bd) { bd = d; bi = i; }
      }
      const a = samples[Math.min(samples.length - 1, bi + 1)];
      const b = samples[Math.max(0, bi - 1)];
      return { x: samples[bi].x, y: samples[bi].y, angle: Math.atan2(a.y - b.y, a.x - b.x) };
    });

    return {
      W, H, vw, vh, pts, start, finish, beach, samples, riverPath, bridges,
      nodeStep, topPad, botPad, midX, amp, riverSrc: { x: srcX, y: srcY },
    };
  }

  // Catmull-Rom spline sampler → flat array of {x,y} points. `per` controls
  // how many samples per control segment (more = smoother). Endpoints are
  // duplicated so the curve passes exactly through the first/last control pt.
  _lsSampleSpline(ctrl, per = 12) {
    const out = [];
    const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        out.push({ x, y });
      }
    }
    out.push({ x: ctrl[ctrl.length - 1].x, y: ctrl[ctrl.length - 1].y });
    return out;
  }

  /**
   * Paint the full illustrated world ONCE into the offscreen cache at the
   * current width/height (DPR-scaled). This is a DESIGNED world-map landscape
   * (not a scaled 3D farm): a tiled lush grass texture with rolling-hill
   * shading is laid down first, then a meandering river kept to the far side
   * of the road, then crop fields / pastures / a farm hamlet / trees / cows
   * all composed BESIDE the hero road, then the smooth dirt road itself with
   * its bridge decks, a hazy mountain-range backdrop at the very top, the
   * BEACH teaser, and finally soft global lighting (haze + vignette).
   */
  _lsPaintWorld(layout) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { W, H, samples, riverPath, bridges } = layout;
    const cache = this._lsCache;
    cache.width = Math.round(W * dpr);
    cache.height = Math.round(H * dpr);
    const g = this._lsCacheCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const R = rng(0x5eed1234);

    // 1) LUSH GRASS BASE — a real tileable texture (built once, cached) filled
    // across the whole land, then gentle rolling-hill light/shadow banding so
    // the ground has form rather than reading as a flat sheet of green.
    const pat = this._lsGrassPattern(g);
    if (pat) { g.fillStyle = pat; g.fillRect(0, 0, W, H); }
    else { g.fillStyle = hex(COLORS.grassA); g.fillRect(0, 0, W, H); }

    // rolling-hill shading: soft horizontal bands of light (top of each swell)
    // and shadow (the dip below) following a slow wave → sculpted meadow.
    g.save();
    for (let i = 0; i < Math.ceil(H / 120) + 1; i++) {
      const cy = i * 120 - (i % 2) * 30;
      // shadow trough
      const sh = g.createLinearGradient(0, cy, 0, cy + 120);
      sh.addColorStop(0, 'rgba(6,42,22,0.16)');
      sh.addColorStop(0.4, 'rgba(6,42,22,0)');
      sh.addColorStop(1, 'rgba(6,42,22,0)');
      g.fillStyle = sh;
      g.beginPath();
      g.moveTo(0, cy);
      for (let x = 0; x <= W; x += 22) g.lineTo(x, cy + Math.sin(x * 0.008 + i) * 14);
      g.lineTo(W, cy + 120); g.lineTo(0, cy + 120); g.closePath(); g.fill();
      // sunlit crown just above the trough
      const lt = g.createLinearGradient(0, cy - 60, 0, cy);
      lt.addColorStop(0, 'rgba(220,255,190,0)');
      lt.addColorStop(1, 'rgba(220,255,190,0.14)');
      g.fillStyle = lt;
      g.beginPath();
      g.moveTo(0, cy - 60);
      for (let x = 0; x <= W; x += 22) g.lineTo(x, cy - 6 + Math.sin(x * 0.008 + i) * 14);
      g.lineTo(W, cy - 60); g.closePath(); g.fill();
    }
    g.restore();

    // global directional-light wash (sun upper-left → soft warm gradient).
    const sun = g.createLinearGradient(0, 0, W, H);
    sun.addColorStop(0, 'rgba(255,250,210,0.10)');
    sun.addColorStop(0.5, 'rgba(255,250,210,0)');
    sun.addColorStop(1, 'rgba(10,30,18,0.10)');
    g.fillStyle = sun; g.fillRect(0, 0, W, H);

    // helper: soft ambient-occlusion shadow blob (down-right of everything).
    const shadow = (x, y, w, h, a = 0.20) => {
      g.save(); g.globalAlpha = a; g.fillStyle = '#0a1f10';
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.283); g.fill(); g.restore();
    };

    // --- side helper: which side of the road this x sits on, at height y ----
    const roadXAt = (y) => {
      // nearest sample by y
      let best = samples[0], bd = 1e9;
      for (const s of samples) { const d = Math.abs(s.y - y); if (d < bd) { bd = d; best = s; } }
      return best.x;
    };
    // keep scenery clear of the road ribbon and the river ribbon
    const clearOfRoad = (x, y, pad = W * 0.12) => Math.abs(x - roadXAt(y)) > pad;
    const riverXAt = (y) => {
      let best = riverPath[0], bd = 1e9;
      for (const r of riverPath) { const d = Math.abs(r.y - y); if (d < bd) { bd = d; best = r; } }
      return best.x;
    };
    const clearOfRiver = (x, y, pad = W * 0.07) => Math.abs(x - riverXAt(y)) > pad;
    const onLand = (x, y, rp = W * 0.13, vp = W * 0.07) =>
      clearOfRoad(x, y, rp) && clearOfRiver(x, y, vp) && x > 18 && x < W - 18;

    // 2) THE RIVER — a single SMOOTH ribbon (built in _lsComputeLayout as a
    // low-frequency spline). Its SOURCE is the mountain range at the top: the
    // first stretch is drawn FADED so it dissolves into the haze/rock rather
    // than ending in an abrupt stub. It is crossed only at the deliberate
    // bridge points (decks drawn later, on top of the road). The river width
    // also tapers from a thin mountain trickle at the source to a full river
    // lower down. Banks → water body → ripples.
    g.lineCap = 'round'; g.lineJoin = 'round';
    // y at which the river has fully "emerged" from the haze (just below the
    // mountain foot); above this it fades to nothing toward the source.
    const srcY = layout.riverSrc ? layout.riverSrc.y : riverPath[0].y;
    const emergeY = layout.finish.y + layout.nodeStep * 0.2;
    // per-point emergence factor 0 (in the haze) → 1 (full river).
    const emerge = (y) => {
      const t = (y - srcY) / Math.max(1, emergeY - srcY);
      return Math.max(0, Math.min(1, t));
    };
    // Stroke the river as short segments so width + alpha can taper near the
    // source (a single stroke can't vary width). Each layer = one pass.
    const strokeRiver = (baseW, styleFor) => {
      for (let i = 1; i < riverPath.length; i++) {
        const a = riverPath[i - 1], b = riverPath[i];
        const f = emerge((a.y + b.y) / 2);
        if (f <= 0.001) continue;
        g.globalAlpha = f;                 // fade in from the haze
        g.lineWidth = baseW * (0.34 + 0.66 * f);  // trickle → full river
        g.strokeStyle = styleFor(b);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      g.globalAlpha = 1;
    };
    // water body colour by panel-x (sunlit sheen): a darker bank on the left
    // grading to a bright sun-kissed edge on the right. All blends use int
    // colours so mix()/shade() stay exact.
    const waterDark = 0x366bb6;   // ≈ shade(COLORS.water, 0.85), as an int
    const waterCol = (p) => {
      const t = Math.max(0, Math.min(1, p.x / W));
      if (t < 0.5) return mix(waterDark, COLORS.water, t * 2);
      return mix(COLORS.water, 0xffffff, (t - 0.5) * 0.36);
    };
    // sandy bank toe, darker under-water edge, then the water body.
    strokeRiver(30, () => mix(COLORS.sand, 0x6fae5a, 0.4));
    strokeRiver(24, () => shade(COLORS.waterDeep, 0.8));
    strokeRiver(18, waterCol);
    // ripple highlights along the flow (also faded near the source).
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 1.6;
    for (let i = 3; i < riverPath.length - 1; i += 3) {
      const p = riverPath[i];
      const f = emerge(p.y);
      if (f < 0.25) continue;
      g.globalAlpha = f * 0.9;
      g.beginPath(); g.moveTo(p.x - 5, p.y); g.quadraticCurveTo(p.x, p.y - 3, p.x + 5, p.y); g.stroke();
    }
    g.globalAlpha = 1;

    // a few PONDS that sit NATURALLY in the grass — each an ORGANIC, UNIQUE
    // blobby outline (a wobbly closed curve, NOT a perfect ellipse) with a soft
    // darker BANK ring where the water meets the land, so it reads as sunk into
    // the meadow rather than a disc floating on a drop-shadow. No float-shadow.
    const lilyDots = (cx, cy, rx, ry, count) => {
      for (let k = 0; k < count; k++) {
        const a = R() * 6.283, rr = R();
        const lx = cx + Math.cos(a) * rx * 0.62 * rr;
        const ly = cy + Math.sin(a) * ry * 0.62 * rr;
        const lr = 2.0 + R() * 2.2;
        g.fillStyle = '#3f9e54';
        g.beginPath(); g.ellipse(lx, ly, lr, lr * 0.8, 0, 0.5, 6.0); g.fill();
        if (R() < 0.4) { g.fillStyle = '#ffd9ef'; g.beginPath(); g.arc(lx, ly - lr * 0.3, lr * 0.4, 0, 6.283); g.fill(); }
      }
    };
    // trace an organic blob: N radii wobbled by a per-pond seed → a unique,
    // believable shoreline. Returns the path so callers can fill OR stroke it.
    const blobPath = (px, py, pr, ry, seed, inset = 1) => {
      const N = 16;
      g.beginPath();
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * 6.283;
        // two low harmonics keep the outline smooth but irregular (unique).
        const wob = 1
          + 0.20 * Math.sin(a * 2 + seed)
          + 0.12 * Math.sin(a * 3 - seed * 1.7)
          + 0.07 * Math.sin(a * 5 + seed * 0.5);
        const rx = pr * wob * inset, rry = ry * wob * inset;
        const x = px + Math.cos(a) * rx;
        const y = py + Math.sin(a) * rry;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
    };
    const pond = (px, py, pr, seed) => {
      const ry = pr * 0.72;
      // 1) damp grassy BANK ring just OUTSIDE the water (no offset shadow) —
      // grounds the pond in the meadow where land meets water.
      g.save();
      blobPath(px, py, pr, ry, seed, 1.16);
      g.fillStyle = 'rgba(40, 70, 36, 0.32)';
      g.fill();
      g.restore();
      // 2) muddy shoreline lip just inside the bank.
      blobPath(px, py, pr, ry, seed, 1.04);
      g.fillStyle = mix(COLORS.field, 0x6fae5a, 0.5);
      g.fill();
      // 3) water body — radial gradient (bright near-sky highlight upper-left
      // → deep water), clipped to the organic outline so the rim hugs the blob.
      g.save();
      blobPath(px, py, pr, ry, seed, 1.0);
      g.clip();
      const pg = g.createRadialGradient(px - pr * 0.35, py - ry * 0.4, 2, px, py, pr * 1.1);
      pg.addColorStop(0, mix(COLORS.water, 0xffffff, 0.30));
      pg.addColorStop(0.7, hex(COLORS.water));
      pg.addColorStop(1, hex(COLORS.waterDeep));
      g.fillStyle = pg;
      g.fillRect(px - pr * 1.4, py - ry * 1.4, pr * 2.8, ry * 2.8);
      // inner shadow at the far (lower-right) bank for depth.
      const sh = g.createRadialGradient(px + pr * 0.3, py + ry * 0.35, 2, px, py, pr * 1.15);
      sh.addColorStop(0, 'rgba(10,40,70,0)');
      sh.addColorStop(1, 'rgba(8,30,60,0.4)');
      g.fillStyle = sh;
      g.fillRect(px - pr * 1.4, py - ry * 1.4, pr * 2.8, ry * 2.8);
      g.restore();
      // 4) a soft sheen streak + lily pads on top.
      g.strokeStyle = 'rgba(255,255,255,0.30)'; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(px - pr * 0.1, py - ry * 0.2, pr * 0.5, ry * 0.32, -0.3, 0.2, 3.0); g.stroke();
      lilyDots(px, py, pr, ry, 5);
    };
    // place a handful of unique ponds out in the open meadow, clear of the
    // road AND the river, each with its own seed → its own shape.
    {
      let placedPonds = 0, attempt = 0;
      const wantPonds = 3;
      while (placedPonds < wantPonds && attempt < 80) {
        attempt++;
        const py = H * (0.20 + R() * 0.66);
        const px = (R() < 0.5 ? W * (0.10 + R() * 0.22) : W * (0.68 + R() * 0.22));
        if (!onLand(px, py, W * 0.16, W * 0.10)) continue;
        pond(px, py, W * (0.05 + R() * 0.02), R() * 6.283);
        placedPonds++;
      }
    }

    // 3) TILLED CROP FIELDS — read as a ploughed field (soil + furrow ridges +
    // seed-row dashes + crop dots + earthy outline). Placed BESIDE the road on
    // whichever side is clear, never under the road or in the water.
    const drawField = (x, y, w, h, rot, stripe, crop) => {
      g.save();
      g.translate(x, y); g.rotate(rot);
      g.save(); g.globalAlpha = 0.18; g.fillStyle = '#0a1f10';
      this._roundRect(g, -w / 2 + 3, -h / 2 + 4, w, h, 9); g.fill(); g.restore();
      g.fillStyle = shade(COLORS.field, 0.92);
      this._roundRect(g, -w / 2, -h / 2, w, h, 9); g.fill();
      g.save();
      this._roundRect(g, -w / 2, -h / 2, w, h, 9); g.clip();
      let band = 0;
      for (let fx = -w / 2; fx < w / 2; fx += stripe, band++) {
        g.fillStyle = shade(COLORS.field, band % 2 ? 1.18 : 1.06);
        g.fillRect(fx, -h / 2, stripe * 0.62, h);
        g.fillStyle = shade(COLORS.field, 0.74);
        g.fillRect(fx + stripe * 0.62, -h / 2, stripe * 0.38, h);
        g.strokeStyle = crop ? this._withAlpha(crop, 0.55) : 'rgba(60,40,20,0.5)';
        g.lineWidth = 1.4; g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(fx + stripe * 0.30, -h / 2 + 3);
        g.lineTo(fx + stripe * 0.30, h / 2 - 3);
        g.stroke(); g.setLineDash([]);
      }
      if (crop) {
        g.fillStyle = crop;
        for (let cx = -w / 2 + stripe * 0.3; cx < w / 2; cx += stripe) {
          for (let cy = -h / 2 + 5; cy < h / 2 - 2; cy += 7) {
            g.beginPath(); g.arc(cx, cy + (R() - 0.5) * 2, 1.3, 0, 6.283); g.fill();
          }
        }
      }
      g.restore();
      g.strokeStyle = shade(COLORS.field, 0.5); g.lineWidth = 2.2;
      this._roundRect(g, -w / 2, -h / 2, w, h, 9); g.stroke();
      g.restore();
    };
    // place a field beside the road, on the side AWAY from the river so it is
    // never under the path or in the water.
    const placeField = (fy, w, h, rot, stripe, crop) => {
      const y = H * fy;
      const rx = roadXAt(y);
      const away = riverXAt(y) > rx ? -1 : 1;
      const x = Math.max(w / 2 + 14, Math.min(W - w / 2 - 14, rx + away * (W * 0.16 + w / 2)));
      drawField(x, y, w, h, rot, stripe, crop);
    };
    placeField(0.30, W * 0.26, H * 0.075, -0.04, 11, '#f2d24a'); // corn
    placeField(0.46, W * 0.22, H * 0.06, 0.05, 10, '#e8923a');   // pumpkin
    placeField(0.62, W * 0.24, H * 0.055, -0.03, 10, '#7dbf4a'); // veg
    placeField(0.80, W * 0.22, H * 0.05, 0.04, 11, '#cf6f3a');   // squash

    // 4) COW PENS — every pen is a CLEAN rectangular FENCE OUTLINE: a ring of
    // posts joined by two horizontal rails around the PERIMETER only, with
    // plain grass inside and NO internal fence lines or mow stripes. These host
    // the grazing cows & sheep. Placed beside the road.
    const pasture = (x, y, w, h) => {
      const x0 = x - w / 2, y0 = y - h / 2;
      // a faint grassy clearing inside the pen (subtly lighter, NO stripe
      // lines), so the enclosure reads as kept/grazed grass.
      g.fillStyle = mix(COLORS.grassA, 0xeaf6c8, 0.16);
      this._roundRect(g, x0, y0, w, h, 5); g.fill();
      // a few soft tufts inside — dots, not lines — to texture the grass.
      g.fillStyle = this._withAlpha(shade(COLORS.grassB, 0.85), 0.5);
      for (let t = 0; t < (w * h) / 220; t++) {
        const tx = x0 + 4 + R() * (w - 8), ty = y0 + 4 + R() * (h - 8);
        g.beginPath(); g.arc(tx, ty, 0.9 + R() * 0.7, 0, 6.283); g.fill();
      }
      // POSTS around the perimeter (evenly spaced on all four sides).
      const postW = 2.8, postH = 4.2;
      const nx = Math.max(2, Math.round(w / 22));   // posts per horizontal edge
      const ny = Math.max(2, Math.round(h / 22));   // posts per vertical edge
      const postPts = [];
      for (let i = 0; i <= nx; i++) {
        const px = x0 + (w * i) / nx;
        postPts.push([px, y0], [px, y0 + h]);
      }
      for (let i = 1; i < ny; i++) {
        const py = y0 + (h * i) / ny;
        postPts.push([x0, py], [x0 + w, py]);
      }
      // two RAILS around the perimeter (upper + lower rail), drawn as the pen
      // outline only — no interior segments.
      g.lineJoin = 'round'; g.lineCap = 'round';
      const railOutline = (inset) => {
        g.beginPath();
        g.moveTo(x0 + 0.5, y0 + inset);
        g.lineTo(x0 + w - 0.5, y0 + inset);
        g.lineTo(x0 + w - 0.5, y0 + h - inset);
        g.lineTo(x0 + 0.5, y0 + h - inset);
        g.closePath();
      };
      g.strokeStyle = shade(COLORS.wood, 0.95); g.lineWidth = 1.8;
      railOutline(1.4); g.stroke();      // top rail
      g.strokeStyle = shade(COLORS.wood, 0.8); g.lineWidth = 1.6;
      railOutline(-1.4); g.stroke();     // bottom rail (slightly lower/darker)
      // POSTS on top of the rails, with a tiny shadow nub for solidity.
      for (const [px, py] of postPts) {
        g.fillStyle = 'rgba(10,31,16,0.25)';
        g.fillRect(px - postW / 2 + 0.6, py - postH / 2 + 0.8, postW, postH);
        g.fillStyle = shade(COLORS.woodDark, 1.05);
        g.fillRect(px - postW / 2, py - postH / 2, postW, postH);
        g.fillStyle = mix(COLORS.wood, 0xffffff, 0.25);
        g.fillRect(px - postW / 2, py - postH / 2, postW * 0.4, postH);
      }
    };
    const pastures = [];
    const placePasture = (fy, w, h) => {
      const y = H * fy, rx = roadXAt(y);
      const away = riverXAt(y) > rx ? -1 : 1;
      const x = Math.max(w / 2 + 14, Math.min(W - w / 2 - 14, rx + away * (W * 0.17 + w / 2)));
      pasture(x, y, w, h); pastures.push({ x, y, w, h });
    };
    placePasture(0.38, W * 0.18, H * 0.05);
    placePasture(0.54, W * 0.17, H * 0.05);
    placePasture(0.70, W * 0.18, H * 0.05);
    placePasture(0.88, W * 0.17, H * 0.05);

    // 5) FARM HAMLET — a little cluster of buildings tucked beside the road,
    // always on the side AWAY from the river so it never sits on path or water.
    {
      const fy = H * 0.30, rx = roadXAt(fy);
      // push the hamlet to the side opposite the river at this height.
      const away = riverXAt(fy) > rx ? -1 : 1;
      const fx = Math.max(W * 0.16, Math.min(W * 0.84, rx + away * W * 0.22));
      this._lsDrawFarm(g, fx, fy, Math.max(1, Math.min(1.6, W / 560)));
    }

    // 6) CRAFTED PROPS — standalone trees, bushes, rocks, hay bales scattered
    // through the meadows (kept off the road & water by onLand()).
    this._lsDrawProps(g, layout, R, onLand);

    // 7) GRAZING ANIMALS — drawn holstein cows (and a few sheep) in the
    // pastures and meadows beside the road, each with a soft shadow.
    this._lsDrawHerds(g, layout, R, pastures, onLand);

    // 8) THE ROAD — the hero, a smooth dirt spline in main-map style.
    this._lsDrawRoad(g, layout);

    // 8b) BRIDGES — wooden decks where the road deliberately crosses water.
    for (const b of bridges) this._lsDrawBridge(g, b);

    // 9) START / FINISH markers painted on the road.
    this._lsDrawFlag(g, layout.start.x, layout.start.y, hex(COLORS.uiGreen), 'START');
    this._lsDrawFlag(g, layout.finish.x, layout.finish.y, hex(COLORS.gold), 'FINISH');

    // 10a) MAP-FADE HAZE — applied to the upper meadow (and the higher locked
    // levels) so the WHOLE world dissolves into atmospheric haze toward the top
    // and reads as continuing upward INTO the mountains. Drawn BEFORE the range
    // so the peaks themselves stay crisp in front of it.
    const fadeTop = layout.finish.y - layout.nodeStep * 0.55;       // mountain foot
    const fadeBot = fadeTop + layout.nodeStep * 1.9;                 // fade reach down
    const mapHaze = g.createLinearGradient(0, fadeTop - layout.nodeStep * 1.4, 0, fadeBot);
    mapHaze.addColorStop(0, 'rgba(207,226,235,0.82)');
    mapHaze.addColorStop(0.5, 'rgba(207,226,235,0.42)');
    mapHaze.addColorStop(1, 'rgba(207,226,235,0)');
    g.fillStyle = mapHaze;
    g.fillRect(0, 0, W, fadeBot);

    // 10b) MOUNTAIN RANGE BACKDROP — at the very top, sitting in front of the
    // map-fade haze so the world reads as climbing up into the summit.
    this._lsDrawMountains(g, layout);

    // 11) BEACH — COMING SOON teaser above the summit.
    this._lsDrawBeach(g, layout);

    // 12) global lighting: a soft vignette to seat the whole composition.
    const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(6,20,12,0.30)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
  }

  // Build a tileable lush-grass texture ONCE (memoised) and return it as a
  // CanvasPattern: 2-3 green tones of fine blade/speckle noise + subtle
  // large-scale mottling + a soft directional-light gradient. This replaces
  // the old flat-fill + radial blobs with a real repeating texture.
  _lsGrassPattern(g) {
    if (this._lsGrassPat) return this._lsGrassPat;
    const T = 128;
    const c = document.createElement('canvas');
    c.width = T; c.height = T;
    const t = c.getContext('2d');
    if (!t) return null;
    const RR = rng(0xBADc0ffe);
    // base fill — mid grass
    t.fillStyle = hex(COLORS.grassA);
    t.fillRect(0, 0, T, T);
    // subtle large-scale mottling: a few big soft tonal patches (wrap-safe by
    // drawing at offsets too small to clip noticeably at tile edges).
    const tones = [COLORS.grassB, COLORS.grassC, 0x9fcf5a, 0x3f9e54];
    for (let i = 0; i < 26; i++) {
      const x = RR() * T, y = RR() * T, r = 14 + RR() * 30;
      const col = tones[(RR() * tones.length) | 0];
      const rad = t.createRadialGradient(x, y, 0, x, y, r);
      rad.addColorStop(0, this._withAlpha(hex(col), 0.5));
      rad.addColorStop(1, this._withAlpha(hex(col), 0));
      t.fillStyle = rad;
      t.beginPath(); t.arc(x, y, r, 0, 6.283); t.fill();
    }
    // fine blade/speckle noise — tiny upright strokes in light & dark greens.
    for (let i = 0; i < 1400; i++) {
      const x = RR() * T, y = RR() * T;
      const light = RR() < 0.5;
      t.strokeStyle = light ? this._withAlpha(mix(COLORS.grassC, 0xffffff, 0.35), 0.5)
                            : this._withAlpha(shade(COLORS.grassB, 0.7), 0.45);
      t.lineWidth = 1;
      const h = 1.5 + RR() * 2.5;
      t.beginPath(); t.moveTo(x, y); t.lineTo(x + (RR() - 0.5) * 1.4, y - h); t.stroke();
    }
    // soft directional-light gradient baked into the tile (upper-left lift).
    const lg = t.createLinearGradient(0, 0, T, T);
    lg.addColorStop(0, 'rgba(255,255,235,0.12)');
    lg.addColorStop(0.5, 'rgba(255,255,235,0)');
    lg.addColorStop(1, 'rgba(0,40,20,0.10)');
    t.fillStyle = lg; t.fillRect(0, 0, T, T);
    this._lsGrassPat = g.createPattern(c, 'repeat');
    return this._lsGrassPat;
  }

  // Worn DIRT road in world.js _road() style: a tan body (COLORS.road), a
  // darker soft edge (road*0.85→0.70), TWO wheel-track lines (road*0.72→0.62)
  // and a faint sunlit crown. Drawn along the SMOOTH Catmull-Rom centreline
  // (layout.samples) so it flows in gentle S-curves with no kinks or jitter.
  // The wheel tracks are offset along the local NORMAL so they hug the curve.
  _lsDrawRoad(g, layout) {
    const pts = layout.samples;
    // Trace the (optionally normal-offset) polyline through the dense samples.
    const trace = (nx = 0) => {
      g.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let x = p.x, y = p.y;
        if (nx) {
          const a = pts[Math.min(pts.length - 1, i + 1)];
          const b = pts[Math.max(0, i - 1)];
          const dx = a.x - b.x, dy = a.y - b.y;
          const len = Math.hypot(dx, dy) || 1;
          x += (-dy / len) * nx; y += (dx / len) * nx;
        }
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    const road = COLORS.road;                          // 0xc2a25e — warm tan
    // soft cast shadow (down-right) so the lane clearly sits ON the meadow
    g.save(); g.globalAlpha = 0.24; g.strokeStyle = '#0a1f10'; g.lineWidth = 30;
    g.translate(1.5, 3); trace(); g.stroke(); g.restore();
    // darker earth edge under the path
    g.strokeStyle = shade(road, 0.70); g.lineWidth = 28; trace(); g.stroke();
    // tan dirt base — the warm body of the lane
    g.strokeStyle = hex(road); g.lineWidth = 22; trace(); g.stroke();
    // sunlit crown so the dirt reads raised, not painted on
    g.strokeStyle = shade(road, 1.13); g.lineWidth = 15; trace(); g.stroke();
    g.strokeStyle = hex(road); g.lineWidth = 10; trace(); g.stroke();
    // TWO darker WHEEL TRACKS along the normals — the signature double-track.
    g.strokeStyle = shade(road, 0.64); g.lineWidth = 4;
    for (const off of [-5.5, 5.5]) { trace(off); g.stroke(); }
    // faint worn dust strip down the crown between the tracks
    g.strokeStyle = shade(road, 1.22); g.lineWidth = 1.8; trace(); g.stroke();
  }

  // A little wooden BRIDGE deck spanning the river where the road crosses it.
  // Drawn as planks across the flow with two side rails + a soft shadow.
  _lsDrawBridge(g, b) {
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.angle); // align the deck across the road's direction of travel
    const len = 30, half = 15;
    // soft shadow on the water
    g.globalAlpha = 0.28; g.fillStyle = '#0a1f10';
    this._roundRect(g, -half + 2, -13 + 3, len, 26, 4); g.fill();
    g.globalAlpha = 1;
    // deck base
    g.fillStyle = shade(COLORS.wood, 0.7);
    this._roundRect(g, -half, -13, len, 26, 4); g.fill();
    // planks across the deck (perpendicular to travel)
    g.strokeStyle = shade(COLORS.woodDark, 1.0); g.lineWidth = 1.4;
    for (let px = -half + 3; px < half; px += 4) {
      g.beginPath(); g.moveTo(px, -12); g.lineTo(px, 12); g.stroke();
    }
    // plank highlights
    g.strokeStyle = mix(COLORS.wood, 0xffffff, 0.25); g.lineWidth = 0.8;
    for (let px = -half + 5; px < half; px += 4) {
      g.beginPath(); g.moveTo(px, -11); g.lineTo(px, 11); g.stroke();
    }
    // two side rails
    g.fillStyle = shade(COLORS.woodDark, 1.05);
    g.fillRect(-half, -14, len, 3);
    g.fillRect(-half, 11, len, 3);
    g.restore();
  }

  // The hazy MOUNTAIN RANGE backdrop at the very top — the campaign's summit.
  // Layered ridgelines fading into haze so they read as far distance, never a
  // random corner blob. Sits between the FINISH and the BEACH crest.
  _lsDrawMountains(g, layout) {
    const { W } = layout;
    const M = rng(0x70017A1);          // deterministic per-peak PRNG seed
    // foot of the range a touch above the FINISH chip; peaks rise toward the
    // beach so the range reads as the summit you have climbed toward.
    const baseY = layout.finish.y - layout.nodeStep * 0.55;
    const footY = baseY + 78;        // common "ground" line all peaks rest on
    g.save();

    // 1) FAR HAZE RIDGES — two soft, low silhouettes behind the main range,
    // each a smooth ridgeline (varied bump heights) fading into the sky so the
    // world feels like it continues upward into distance.
    const ridge = (yOff, col, alpha, jag, freq) => {
      g.globalAlpha = alpha;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(-12, footY);
      const step = W / freq;
      for (let x = -12, k = 0; x <= W + 12; x += step, k++) {
        const hh = jag * (0.45 + 0.55 * (((k * 73) % 11) / 11));
        // mid control + peak give a soft rounded ridgeline (not zig-zag teeth).
        const peakY = baseY + yOff - hh;
        g.quadraticCurveTo(x - step * 0.5, peakY + hh * 0.4, x, peakY);
      }
      g.lineTo(W + 12, footY);
      g.closePath(); g.fill();
    };
    ridge(46, mix(COLORS.rockGray, 0xeaf2ff, 0.62), 0.5, 40, 6);  // farthest haze-blue
    ridge(60, mix(COLORS.rockGray, 0xc9d6e6, 0.42), 0.66, 58, 5); // mid range

    // 2) MAIN RANGE — each peak is UNIQUE: varied width/height, a slight lean,
    // a different snow line, rock striations + a shaded (right) face and a
    // sunlit (left) face. Heights/leans come from the seeded PRNG.
    g.globalAlpha = 0.96;
    const peaks = 6;
    const slotW = W / peaks;
    for (let p = 0; p < peaks; p++) {
      const jitter = (M() - 0.5);
      const cx = slotW * (p + 0.5) + jitter * slotW * 0.32;
      const pw = slotW * (0.86 + M() * 0.5);
      const ph = 64 + M() * 92;                 // DIFFERENT SIZES per peak
      const lean = (M() - 0.5) * pw * 0.36;      // unique sideways lean of apex
      const apexX = cx + lean, apexY = footY - ph;
      const lX = cx - pw / 2, rX = cx + pw / 2;
      const snowLine = 0.24 + M() * 0.22;        // unique snow extent per peak

      // shaded (right) half of the rock face — darker.
      g.fillStyle = shade(COLORS.rockGray, 0.70);
      g.beginPath();
      g.moveTo(apexX, apexY); g.lineTo(rX, footY); g.lineTo(apexX, footY);
      g.closePath(); g.fill();
      // sunlit (left) half — lighter.
      g.fillStyle = mix(COLORS.rockGray, 0xffffff, 0.16);
      g.beginPath();
      g.moveTo(apexX, apexY); g.lineTo(lX, footY); g.lineTo(apexX, footY);
      g.closePath(); g.fill();

      // rock STRIATIONS — diagonal strata lines following each face, clipped to
      // the peak triangle so they never spill onto the sky.
      g.save();
      g.beginPath();
      g.moveTo(lX, footY); g.lineTo(apexX, apexY); g.lineTo(rX, footY); g.closePath();
      g.clip();
      g.strokeStyle = 'rgba(40,46,52,0.35)'; g.lineWidth = 1;
      for (let s = 1; s <= 6; s++) {
        const t = s / 7;
        const y = apexY + (footY - apexY) * t;
        g.beginPath();
        g.moveTo(lX - 4, y + 4);
        g.quadraticCurveTo(apexX, y - 3, rX + 4, y + 6);
        g.stroke();
      }
      // a couple of brighter cracks for craggy texture.
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.8;
      for (let s = 0; s < 3; s++) {
        const sxv = lX + pw * (0.2 + M() * 0.6);
        g.beginPath();
        g.moveTo(sxv, footY);
        g.lineTo(apexX + (sxv - apexX) * 0.3, apexY + ph * 0.4);
        g.stroke();
      }
      g.restore();

      // SNOW CAP — a unique ragged snow field below the apex, with a shaded
      // underside so it reads as depth, not a flat triangle.
      const snowBaseY = apexY + ph * snowLine;
      g.fillStyle = hex(COLORS.snow);
      g.beginPath();
      g.moveTo(apexX, apexY);
      // left jagged edge down
      const segs = 4;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const ex = apexX + (lX - apexX) * t * 0.62;
        const ey = apexY + (snowBaseY - apexY) * t + (M() - 0.5) * ph * 0.06;
        g.lineTo(ex, ey);
      }
      // jagged drip line across, then back up the right edge
      for (let s = segs; s >= 1; s--) {
        const t = s / segs;
        const ex = apexX + (rX - apexX) * t * 0.62;
        const ey = apexY + (snowBaseY - apexY) * t + (M() - 0.5) * ph * 0.06;
        g.lineTo(ex, ey);
      }
      g.closePath(); g.fill();
      // bluish shadow on the snow's right side for form.
      g.fillStyle = 'rgba(168,196,224,0.5)';
      g.beginPath();
      g.moveTo(apexX, apexY);
      g.lineTo(apexX + pw * 0.14, snowBaseY * 0.5 + apexY * 0.5);
      g.lineTo(apexX, snowBaseY * 0.7 + apexY * 0.3);
      g.closePath(); g.fill();
    }
    g.restore();

    // 3) a band of atmospheric HAZE across the foot of the range so it sits
    // back AND the map below blends seamlessly UP into the mountains (no hard
    // seam between meadow and rock).
    const haze = g.createLinearGradient(0, baseY - 6, 0, footY + 40);
    haze.addColorStop(0, 'rgba(214,230,238,0)');
    haze.addColorStop(0.55, 'rgba(214,230,238,0.7)');
    haze.addColorStop(1, 'rgba(214,230,238,0)');
    g.fillStyle = haze; g.fillRect(0, baseY - 6, W, footY + 46 - (baseY - 6));
  }

  // Crafted hand-painted props scattered over the world: standalone trees,
  // bushes, rocks and hay bales. Placed deterministically (shared R) and kept
  // clear of the road AND the river via the onLand() predicate.
  _lsDrawProps(g, layout, R, onLand) {
    const { W, H } = layout;
    const shadow = (x, y, w, h, a = 0.2) => {
      g.save(); g.globalAlpha = a; g.fillStyle = '#0a1f10';
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
    const ok = (x, y) => (onLand ? onLand(x, y) : true);

    // scattered trees, clustered toward the panel edges to frame the journey.
    for (let i = 0; i < Math.round(H / 64); i++) {
      const edge = R() < 0.62;
      const x = edge ? (R() < 0.5 ? W * (0.04 + R() * 0.13) : W * (0.83 + R() * 0.13))
                     : R() * W;
      const y = H * 0.06 + R() * H * 0.9;
      if (!ok(x, y)) continue;
      tree(x, y, 8 + R() * 6);
    }
    // bushes & rocks dotted around the meadows
    for (let i = 0; i < Math.round(H / 80); i++) {
      const x = R() * W, y = H * 0.08 + R() * H * 0.88;
      if (!ok(x, y)) continue;
      (R() < 0.62 ? bush : rock)(x, y, 5 + R() * 4);
    }
    // a few hay bales out in the meadows beside the road
    for (let i = 0; i < 4; i++) {
      const x = R() * W, y = H * 0.18 + R() * H * 0.7;
      if (!ok(x, y)) continue;
      hay(x, y, 6 + R() * 2);
    }
  }

  // Grazing herds: drawn black-&-white holstein cows (body, head, legs, spots)
  // plus a few sheep, scattered in the pastures and meadows beside the road.
  // Each gets a soft down-right shadow. NO emoji — all path-drawn.
  _lsDrawHerds(g, layout, R, pastures, onLand) {
    const { W, H } = layout;
    const shadow = (x, y, w, h) => {
      g.save(); g.globalAlpha = 0.20; g.fillStyle = '#0a1f10';
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.283); g.fill(); g.restore();
    };
    // a top-down holstein cow, facing roughly down the meadow.
    const cow = (x, y, s) => {
      shadow(x + s * 0.18, y + s * 0.62, s * 1.05, s * 0.42);
      g.save(); g.translate(x, y); g.rotate((R() - 0.5) * 0.5);
      // legs (four little dark stubs)
      g.fillStyle = hex(COLORS.cowBlack);
      for (const lx of [-s * 0.5, s * 0.5]) for (const ly of [-s * 0.4, s * 0.45])
        g.fillRect(lx - s * 0.1, ly - s * 0.1, s * 0.2, s * 0.32);
      // body
      g.fillStyle = hex(COLORS.cowWhite);
      this._roundRect(g, -s * 0.72, -s * 0.5, s * 1.44, s * 1.0, s * 0.4); g.fill();
      // black spots (clipped to the body)
      g.save();
      this._roundRect(g, -s * 0.72, -s * 0.5, s * 1.44, s * 1.0, s * 0.4); g.clip();
      g.fillStyle = hex(COLORS.cowBlack);
      g.beginPath(); g.ellipse(-s * 0.3, -s * 0.1, s * 0.32, s * 0.26, 0.3, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(s * 0.32, s * 0.18, s * 0.26, s * 0.22, -0.4, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(s * 0.1, -s * 0.34, s * 0.16, s * 0.13, 0, 0, 6.283); g.fill();
      g.restore();
      // soft top highlight on the white hide
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath(); g.ellipse(-s * 0.1, -s * 0.28, s * 0.5, s * 0.2, 0, 0, 6.283); g.fill();
      // head poking out the top
      g.fillStyle = hex(COLORS.cowWhite);
      this._roundRect(g, -s * 0.26, -s * 0.86, s * 0.52, s * 0.42, s * 0.18); g.fill();
      g.fillStyle = hex(COLORS.cowPink);   // snout
      this._roundRect(g, -s * 0.16, -s * 0.6, s * 0.32, s * 0.16, s * 0.07); g.fill();
      g.fillStyle = hex(COLORS.cowBlack);  // ears
      g.beginPath(); g.ellipse(-s * 0.28, -s * 0.78, s * 0.12, s * 0.08, -0.5, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(s * 0.28, -s * 0.78, s * 0.12, s * 0.08, 0.5, 0, 6.283); g.fill();
      g.restore();
    };
    // a fluffy sheep: cream cloud body + dark face.
    const sheep = (x, y, s) => {
      shadow(x + s * 0.18, y + s * 0.6, s * 0.95, s * 0.38);
      g.save(); g.translate(x, y); g.rotate((R() - 0.5) * 0.5);
      g.fillStyle = hex(COLORS.cowBlack);
      for (const lx of [-s * 0.35, s * 0.35]) g.fillRect(lx - s * 0.08, s * 0.2, s * 0.16, s * 0.3);
      // wool cloud (overlapping pillows)
      g.fillStyle = hex(COLORS.wool);
      for (const [ox, oy, rr] of [[-s * 0.4, 0, s * 0.42], [s * 0.4, 0, s * 0.42], [0, -s * 0.2, s * 0.5], [0, s * 0.18, s * 0.42]]) {
        g.beginPath(); g.arc(ox, oy, rr, 0, 6.283); g.fill();
      }
      g.fillStyle = mix(COLORS.wool, 0xffffff, 0.4);
      g.beginPath(); g.arc(-s * 0.1, -s * 0.22, s * 0.28, 0, 6.283); g.fill();
      // dark face at the top
      g.fillStyle = shade(COLORS.cowBlack, 1.4);
      g.beginPath(); g.ellipse(0, -s * 0.5, s * 0.22, s * 0.2, 0, 0, 6.283); g.fill();
      g.restore();
    };

    // herd inside each pasture (2-4 cows), packed within the fence.
    for (const p of pastures) {
      const count = 2 + ((R() * 3) | 0);
      for (let k = 0; k < count; k++) {
        const cx = p.x + (R() - 0.5) * (p.w - 16);
        const cy = p.y + (R() - 0.5) * (p.h - 10);
        cow(cx, cy, 7);
      }
    }
    // a few free-grazing cows + sheep out in the open meadows beside the road.
    const ok = (x, y) => (onLand ? onLand(x, y, W * 0.15, W * 0.08) : true);
    let placed = 0;
    for (let i = 0; i < 60 && placed < 9; i++) {
      const x = R() * W, y = H * 0.12 + R() * H * 0.8;
      if (!ok(x, y)) continue;
      if (R() < 0.7) cow(x, y, 6.5 + R() * 1.5);
      else sheep(x, y, 6);
      placed++;
    }
  }

  // Little top-down farm sprites: barn (+roof), silo, windmill, farmhouse.
  _lsDrawFarm(g, cx, cy, s) {
    const px = (v) => v * s;
    const shadow = (x, y, w, h) => {
      g.save(); g.globalAlpha = 0.22; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 6.283); g.fill(); g.restore();
    };
    // IMPORTANT: every building here is drawn axis-aligned and UPRIGHT — no
    // rotate(), no shear, no skewed shading arcs — so the cluster reads as a
    // tidy, straight hamlet (this fixes the previously "skewed" look).

    // --- BARN: upright body + a symmetric gable roof + a vertical door. ---
    const bw = px(34), bh = px(22);
    const bx = cx - px(28), by = cy - px(6);
    shadow(bx + bw / 2, by + bh + px(3), bw * 0.58, px(4.5));
    g.fillStyle = hex(COLORS.barnRed);
    this._roundRect(g, bx, by, bw, bh, 3); g.fill();
    // upright plank shading (vertical, even — no lean)
    g.strokeStyle = shade(COLORS.barnRed, 0.82); g.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const lx = bx + (bw * i) / 5;
      g.beginPath(); g.moveTo(lx, by + 1); g.lineTo(lx, by + bh - 1); g.stroke();
    }
    // symmetric gable roof: an isosceles triangle centred over the barn.
    const ridge = px(11);
    g.fillStyle = shade(COLORS.roof, 1.06);
    g.beginPath();
    g.moveTo(bx - px(2), by + 1);
    g.lineTo(bx + bw / 2, by - ridge);
    g.lineTo(bx + bw + px(2), by + 1);
    g.closePath(); g.fill();
    // white trim along the eaves + a centred vertical door.
    g.strokeStyle = hex(COLORS.barnTrim); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(bx - px(2), by + 1); g.lineTo(bx + bw + px(2), by + 1); g.stroke();
    g.fillStyle = hex(COLORS.barnTrim);
    g.fillRect(cx - px(28) + bw / 2 - px(4), by + bh - px(11), px(8), px(11));
    g.strokeStyle = shade(COLORS.barnRed, 0.7); g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(bx + bw / 2, by + bh - px(11)); g.lineTo(bx + bw / 2, by + bh);
    g.stroke();

    // --- SILO: an upright cylinder + a SYMMETRIC dome cap (centred). ---
    const sx = cx + px(6), sy = cy - px(2), sr = px(8);
    shadow(sx, sy + px(17), sr + px(1), px(3.5));
    // cylinder body (a vertical rounded rect — clearly upright)
    g.fillStyle = shade(COLORS.stone, 1.02);
    this._roundRect(g, sx - sr, sy - px(2), sr * 2, px(20), sr * 0.5); g.fill();
    // left-lit / right-shadowed body, split VERTICALLY down the centre.
    g.fillStyle = shade(COLORS.stone, 0.82);
    this._roundRect(g, sx, sy - px(2), sr, px(20), 0); g.fill();
    g.fillStyle = mix(COLORS.stone, 0xffffff, 0.28);
    g.fillRect(sx - sr + px(1), sy - px(1), px(2.4), px(18));
    // symmetric dome cap (a half-circle, flat side down, centred on the silo).
    g.fillStyle = shade(COLORS.roof, 1.1);
    g.beginPath(); g.arc(sx, sy - px(2), sr, Math.PI, 2 * Math.PI); g.closePath(); g.fill();

    // --- FARMHOUSE: upright body + a symmetric pitched roof. ---
    const hw = px(22), hh = px(15);
    const hx = cx - px(11), hy = cy + px(17);
    shadow(hx + hw / 2, hy + hh + px(2), hw * 0.55, px(3.5));
    g.fillStyle = mix(COLORS.wood, 0xffffff, 0.14);
    this._roundRect(g, hx, hy, hw, hh, 2.5); g.fill();
    // symmetric pitched roof centred over the house.
    g.fillStyle = hex(COLORS.roof);
    g.beginPath();
    g.moveTo(hx - px(2), hy + 1);
    g.lineTo(hx + hw / 2, hy - px(7));
    g.lineTo(hx + hw + px(2), hy + 1);
    g.closePath(); g.fill();
    // a centred door + two windows (all upright).
    g.fillStyle = shade(COLORS.woodDark, 1.0);
    g.fillRect(hx + hw / 2 - px(2.5), hy + hh - px(8), px(5), px(8));
    g.fillStyle = mix(COLORS.water, 0xffffff, 0.4);
    g.fillRect(hx + px(3), hy + px(4), px(4), px(4));
    g.fillRect(hx + hw - px(7), hy + px(4), px(4), px(4));

    // --- WINDMILL: an upright tower + a SYMMETRIC "+" of four blades. ---
    const wx = cx + px(27), wy = cy + px(8), wr = px(6.5);
    shadow(wx, wy + px(13), px(6), px(3));
    // a short upright tapered tower under the hub.
    g.fillStyle = mix(COLORS.wood, 0xffffff, 0.1);
    g.beginPath();
    g.moveTo(wx - px(4), wy + px(13));
    g.lineTo(wx - px(2.4), wy);
    g.lineTo(wx + px(2.4), wy);
    g.lineTo(wx + px(4), wy + px(13));
    g.closePath(); g.fill();
    // hub
    g.fillStyle = mix(COLORS.wood, 0xffffff, 0.22);
    g.beginPath(); g.arc(wx, wy, wr * 0.5, 0, 6.283); g.fill();
    // four blades on a perfectly symmetric "+" cross (no lean).
    g.strokeStyle = shade(COLORS.woodDark, 1.0); g.lineWidth = 2.2;
    for (let k = 0; k < 4; k++) {
      const a = k * (Math.PI / 2);
      g.beginPath(); g.moveTo(wx, wy);
      g.lineTo(wx + Math.cos(a) * wr * 1.7, wy + Math.sin(a) * wr * 1.7); g.stroke();
    }
    g.fillStyle = hex(COLORS.gold);
    g.beginPath(); g.arc(wx, wy, px(2.2), 0, 6.283); g.fill();
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

    // --- BEACH GATE banner: a LOCKED teaser showing star progress to 35. ---
    const stars = this._totalStars();
    const need = this._beachStars();
    const unlocked = this._beachUnlocked();
    g.save();
    g.font = '900 20px Rubik, sans-serif';
    const title = unlocked ? 'BEACH — UNLOCKED!' : 'BEACH — LOCKED';
    const prog = `${fmt(stars)} / ${fmt(need)}`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const titleW = g.measureText(title).width;
    g.font = '900 16px Rubik, sans-serif';
    const progW = g.measureText(prog).width;
    const starSz = 15, gap = 6;
    // banner width = padlock + title (row 1) and progress + 1 star (row 2)
    const innerW = Math.max(titleW + 26, progW + starSz + gap);
    const bw = innerW + 44;
    const by = top + 30;
    const bh = 52;
    const bx = W / 2 - bw / 2;
    g.fillStyle = 'rgba(10,14,34,0.85)';
    this._roundRect(g, bx, by - bh / 2, bw, bh, 13); g.fill();
    g.strokeStyle = unlocked ? hex(COLORS.uiGreen) : hex(COLORS.gold); g.lineWidth = 2.5;
    this._roundRect(g, bx, by - bh / 2, bw, bh, 13); g.stroke();
    // row 1: a little drawn padlock + the title.
    const lx = bx + 16, ly = by - 11;
    if (!unlocked) this._lsDrawLock(g, lx, ly, hex(COLORS.gold));
    g.font = '900 18px Rubik, sans-serif';
    g.fillStyle = unlocked ? hex(COLORS.uiGreen) : hex(COLORS.gold);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(title, bx + 32, ly);
    // row 2: progress number + ONE drawn star (NOT an emoji).
    const ry2 = by + 12;
    g.font = '900 15px Rubik, sans-serif';
    g.fillStyle = 'rgba(238,246,255,0.92)';
    g.fillText(prog, bx + 20, ry2);
    this._lsDrawStar(g, bx + 20 + progW + 4 + starSz / 2, ry2, starSz / 2,
      unlocked ? hex(COLORS.gold) : hex(COLORS.gold), true);
    g.restore();
  }

  // Draw a 5-point star on the canvas (filled gold, or grey outline if !on).
  _lsDrawStar(g, cx, cy, r, color, on = true) {
    g.save();
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const oa = -Math.PI / 2 + i * (2 * Math.PI / 5);
      const ia = oa + Math.PI / 5;
      const ox = cx + Math.cos(oa) * r, oy = cy + Math.sin(oa) * r;
      const ix = cx + Math.cos(ia) * r * 0.46, iy = cy + Math.sin(ia) * r * 0.46;
      i ? g.lineTo(ox, oy) : g.moveTo(ox, oy);
      g.lineTo(ix, iy);
    }
    g.closePath();
    if (on) {
      g.fillStyle = color; g.fill();
      g.strokeStyle = shade(COLORS.gold, 0.7); g.lineWidth = 0.8; g.stroke();
    } else {
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1; g.stroke();
    }
    g.restore();
  }

  // Draw a small padlock on the canvas (body + shackle), tinted `color`.
  _lsDrawLock(g, cx, cy, color) {
    g.save();
    g.strokeStyle = color; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy - 2, 4, Math.PI, 2 * Math.PI); g.stroke();
    g.fillStyle = color;
    this._roundRect(g, cx - 5.5, cy - 2, 11, 9, 2); g.fill();
    g.fillStyle = 'rgba(10,14,34,0.9)';
    g.beginPath(); g.arc(cx, cy + 2.4, 1.4, 0, 6.283); g.fill();
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
   * cache, size the spacer/canvas, and lay out the node markers (one per
   * campaign level — count read from campaign.levels.length, never hardcoded).
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

    // Haze band: nodes that ride up into the mountain foot are faded so the
    // higher (locked) levels dissolve seamlessly into the range at the top.
    const fadeTop = layout.finish.y - layout.nodeStep * 0.55;
    const fadeStart = fadeTop + layout.nodeStep * 1.6;  // below here = full opacity

    for (const p of layout.pts) {
      const index = p.index;
      const completed = this._isCompleted(index);
      const isCurrent = !completed && index === unlocked;
      const locked = index > unlocked;

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

      // fade nodes that sit up in the mountain haze (atmospheric depth).
      if (p.y < fadeStart) {
        const f = Math.max(0.3, Math.min(1, (p.y - fadeTop) / (fadeStart - fadeTop)));
        node.style.opacity = f.toFixed(2);
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
        if (completed) {
          node.appendChild(this._svgCheck());     // drawn check
          // STARS ARE BACK: completed levels show their earned stars (0..3) as
          // drawn SVG stars (gold filled / grey empty) below the node.
          const stars = this._starsFor(index);
          const row = el('div', 'mf-ls-stars', node);
          for (let k = 0; k < 3; k++) {
            const star = this._svgStar(k < stars);
            star.classList.add('mf-ls-nodestar');
            if (k >= stars) star.classList.add('mf-ls-nodestar-off');
            row.appendChild(star);
          }
        }
        node.setAttribute('aria-label',
          `Level ${index}${completed ? `, completed, ${this._starsFor(index)} stars` : ''}${isCurrent ? ', current' : ''}, goal ${fmt(p.target)} points`);
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
  // A drawn CROSS (failed objective) — a red circle with an X, mirrors the
  // structure of _svgCheck so the result objective rows line up.
  _svgCross() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'mf-ls-check mf-lr-cross');
    svg.setAttribute('viewBox', '0 0 24 24');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '11');
    c.setAttribute('class', 'mf-lr-cross-bg');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M8 8l8 8M16 8l-8 8'); p.setAttribute('class', 'mf-lr-cross-x');
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
    this._refreshCoinWidgets();
    this._refreshBeachWorld();
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
    this._lrCancelAnims();
    this._pruneResultCoins();
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
   *   won, index, score, target, time, isNewBest, hasNext
   *   (NOTE: levels are pass/fail — no stars. `starsEarned` is accepted for
   *   backward-compat but ignored.)
   */
  /**
   * Rich campaign result screen.
   * @param {object} o
   *   won:boolean, index:number, score:number, target:number, isNewBest:boolean
   *   objectives: [{label,done} × 3]  (1 = score goal, 2 & 3 = bonus missions)
   *   stars: 0..3 earned this run
   *   coinRewards: [50,100,150]  (reward per star slot)
   *   coinsEarned: coins newly banked this run
   *   prevBalance / newBalance: cow-coin totals before / after
   * Older callers may still pass {time, hasNext, starsEarned} — those are
   * tolerated and sensible defaults are derived from the campaign model.
   */
  showLevelResult(opts = {}) {
    const {
      won = false, index = 1, score = 0, target = 0, isNewBest = false,
    } = opts;
    // hasNext is DERIVED per the contract: a next level exists only on a win.
    const hasNext = won && index < this._levels().length;

    // Stars earned this run (clamp 0..3). Backward-compat: accept starsEarned.
    let stars = opts.stars != null ? opts.stars
      : (opts.starsEarned != null ? opts.starsEarned : (won ? this._starsFor(index) : 0));
    stars = Math.max(0, Math.min(3, stars | 0));

    // Coin rewards per star slot.
    const coinRewards = Array.isArray(opts.coinRewards) && opts.coinRewards.length === 3
      ? opts.coinRewards.map((v) => Math.max(0, v | 0))
      : [50, 100, 150];

    // Objectives: exactly 3 rows. Derive a sensible default set if none given
    // (objective 1 = the score goal; 2 & 3 = generic bonus missions).
    let objectives = Array.isArray(opts.objectives) ? opts.objectives.slice(0, 3) : null;
    if (!objectives || objectives.length < 3) {
      const base = objectives || [];
      const fill = [
        { label: `Reach ${fmt(target)}`, done: won || (target > 0 && score >= target) },
        { label: 'Earn 2 stars', done: stars >= 2 },
        { label: 'Earn 3 stars', done: stars >= 3 },
      ];
      objectives = [base[0] || fill[0], base[1] || fill[1], base[2] || fill[2]];
    }

    // Coin balances. Default prev/new from the wallet + the earned coins.
    const earnedDefault = coinRewards.slice(0, stars).reduce((a, b) => a + b, 0);
    const coinsEarned = opts.coinsEarned != null ? Math.max(0, opts.coinsEarned | 0) : earnedDefault;
    const newBalance = opts.newBalance != null ? Math.max(0, opts.newBalance | 0) : this._coinBalance();
    const prevBalance = opts.prevBalance != null ? Math.max(0, opts.prevBalance | 0)
      : Math.max(0, newBalance - coinsEarned);

    // The level-select map (if open) should give way to the result.
    if (this._levelSelectVisible) this.hideLevelSelect();
    // Drop any coin widget left over from a previous result screen.
    this._pruneResultCoins();
    this._lrCancelAnims();

    const s = this._endEl;
    s.textContent = '';
    s.className = `mf-screen mf-end mf-levelresult ${won ? 'mf-theme-win mf-lr-won' : 'mf-theme-over mf-lr-fail'}`;

    const panel = el('div', 'mf-panel mf-end-panel mf-lr-panel', s);

    // Header row: eyebrow + the result-screen coin balance widget (coins fly
    // into this one). It starts at prevBalance and counts up as stars fill.
    const head = el('div', 'mf-lr-head', panel);
    el('div', 'mf-lr-eyebrow', head, `LEVEL ${index}`);
    const coinW = this._buildCoinWidget(head, 'mf-coin-lr');
    this._lrCoinWidget = coinW;
    // seed every coin widget (header + result) to the PREVIOUS balance.
    this._coinShown = prevBalance;
    this._renderCoin(prevBalance);

    el('h2', 'mf-panel-title mf-end-title mf-lr-title', panel,
      won ? 'MISSION COMPLETE' : 'MISSION FAILED');
    if (!won) el('div', 'mf-end-sub mf-lr-sub', panel, 'The herd got away. Try again!');

    // --- THREE big STAR slots in a row; each shows its coin reward inside. ---
    // Earned stars START greyed/empty and FILL one-by-one during _lrAnimate so
    // the player sees each star pop in sequence. Unearned stays empty/dimmed.
    const starRow = el('div', 'mf-lr-starrow', panel);
    const starEls = [];
    for (let k = 0; k < 3; k++) {
      const earned = k < stars;
      const slot = el('div', `mf-lr-starslot${earned ? ' mf-lr-starslot-pending' : ' mf-lr-starslot-empty'}`, starRow);
      // always draw an empty star initially; the animator swaps earned ones in.
      const star = this._svgStar(false);
      star.classList.add('mf-lr-bigstar', 'mf-lr-bigstar-off');
      slot.appendChild(star);
      slot._starEl = star;
      // coin reward shown INSIDE each star (dimmed until the star fills).
      const reward = el('div', `mf-lr-reward${earned ? ' mf-lr-reward-pending' : ' mf-lr-reward-dim'}`, slot, `+${coinRewards[k]}`);
      slot._rewardEl = reward;
      starEls.push(slot);
    }

    if (isNewBest) el('div', 'mf-ribbon mf-lr-best', panel, 'NEW BEST!');

    // SCORE vs TARGET ("1240 / 1000").
    const scoreWrap = el('div', 'mf-lr-scoreline', panel);
    const scoreVal = el('span', 'mf-lr-score', scoreWrap, '0');
    el('span', 'mf-lr-sep', scoreWrap, ' / ');
    el('span', 'mf-lr-target', scoreWrap, fmt(target));
    scoreWrap.classList.toggle('mf-lr-hit', won || (target > 0 && score >= target));
    countUp(scoreVal, score, { duration: 900, delay: 300 });
    el('div', 'mf-lr-scorelabel', panel, 'SCORE / TARGET');

    // --- THREE objective rows (drawn check / cross + label). ---
    const objWrap = el('div', 'mf-lr-objectives', panel);
    for (const o of objectives) {
      const row = el('div', `mf-lr-obj${o && o.done ? ' mf-lr-obj-done' : ''}`, objWrap);
      row.appendChild(o && o.done ? this._svgCheck() : this._svgCross());
      el('span', 'mf-lr-obj-label', row, (o && o.label) || '');
    }

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

    // Sequence the star pops + flying coins + balance count-up once laid out.
    this._lrAnimate({ starEls, stars, coinRewards, prevBalance, newBalance, coinW, panel });
  }

  /** Drop any coin widget that belonged to a (now-stale) result screen. */
  _pruneResultCoins() {
    if (this._coins) {
      this._coins = this._coins.filter((w) => !w.classList.contains('mf-coin-lr'));
    }
    this._lrCoinWidget = null;
  }

  /** Cancel any in-flight result-screen timers / rAFs. */
  _lrCancelAnims() {
    if (this._lrTimers) for (const t of this._lrTimers) clearTimeout(t);
    this._lrTimers = [];
    if (this._lrFlyRaf) { cancelAnimationFrame(this._lrFlyRaf); this._lrFlyRaf = 0; }
  }

  /**
   * Choreograph the result reveal: each EARNED star pops/fills in sequence; as
   * it fills, its coin reward FLIES (an animated coin sprite) from the star to
   * the coin-balance widget, which counts up prevBalance → newBalance. Unearned
   * stars stay empty/greyed with their reward dimmed. All rAF/CSS — smooth.
   */
  _lrAnimate({ starEls, stars, coinRewards, prevBalance, newBalance, coinW, panel }) {
    this._lrCancelAnims();
    if (stars <= 0) { this.setCoinBalance(newBalance); return; }
    const s = this._endEl;
    // cumulative coin target after each star fills (so the count-up lands on
    // exactly newBalance after the final earned star).
    let running = prevBalance;
    const baseDelay = 420;       // wait for the panel-in animation to settle
    const perStar = 540;         // cadence between star pops

    for (let k = 0; k < stars; k++) {
      const t = setTimeout(() => {
        if (!this._endVisible || !s.classList.contains('mf-levelresult')) return;
        const slot = starEls[k];
        if (slot) {
          // FILL the star: turn the empty/greyed star gold + brighten its
          // reward, then play the pop.
          slot.classList.remove('mf-lr-starslot-pending');
          slot.classList.add('mf-lr-starslot-filled');
          if (slot._starEl) slot._starEl.classList.remove('mf-lr-bigstar-off');
          if (slot._rewardEl) slot._rewardEl.classList.remove('mf-lr-reward-pending', 'mf-lr-reward-dim');
          slot.classList.remove('mf-lr-star-pop');
          void slot.offsetWidth;
          slot.classList.add('mf-lr-star-pop');
        }
        const from = running;
        running += coinRewards[k];
        const to = (k === stars - 1) ? newBalance : running;
        // fly a coin sprite from this star to the coin widget, then count up.
        this._lrFlyCoin(slot, coinW, () => this.animateCoinBalance(from, to, { duration: 500 }));
      }, baseDelay + k * perStar);
      this._lrTimers.push(t);
    }
    // safety: ensure the widget lands on the final balance even if a frame is
    // dropped mid-animation.
    const tEnd = setTimeout(() => {
      if (this._endVisible) this.setCoinBalance(newBalance);
    }, baseDelay + stars * perStar + 700);
    this._lrTimers.push(tEnd);
  }

  /**
   * Spawn an animated gold coin sprite that flies from `fromEl` to `toEl`
   * (the coin widget) along a smooth eased arc, then invokes `onArrive`.
   */
  _lrFlyCoin(fromEl, toEl, onArrive) {
    const host = this._endEl;
    if (!fromEl || !toEl || !host) { if (onArrive) onArrive(); return; }
    const hb = host.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const x0 = a.left + a.width / 2 - hb.left;
    const y0 = a.top + a.height / 2 - hb.top;
    const x1 = b.left + b.width / 2 - hb.left;
    const y1 = b.top + b.height / 2 - hb.top;

    const sprite = el('div', 'mf-fly-coin', host);
    sprite.appendChild(this._svgCoin());
    sprite.style.left = `${x0}px`;
    sprite.style.top = `${y0}px`;

    const dur = 520;
    const t0 = performance.now();
    // arc apex lifts above the straight line for a satisfying toss.
    const lift = Math.min(120, Math.abs(y1 - y0) * 0.5 + 50);
    let arrived = false;
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0) / dur));
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOut
      const x = x0 + (x1 - x0) * e;
      const y = y0 + (y1 - y0) * e - Math.sin(e * Math.PI) * lift;
      const sc = 1 - 0.45 * e;
      sprite.style.transform = `translate(-50%,-50%) scale(${sc})`;
      sprite.style.left = `${x}px`;
      sprite.style.top = `${y}px`;
      sprite.style.opacity = t > 0.85 ? String((1 - t) / 0.15) : '1';
      if (t < 1 && this._endVisible) {
        this._lrFlyRaf = requestAnimationFrame(tick);
      } else {
        sprite.remove();
        if (!arrived) { arrived = true; this._pulseCoins(); if (onArrive) onArrive(); }
      }
    };
    this._lrFlyRaf = requestAnimationFrame(tick);
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
