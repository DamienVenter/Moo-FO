// MOO-FO — UI screens (Agent U)
// Title / countdown / pause (+ settings & key binds) / game-over / win
// screens. All DOM is built here and appended to document.body. Screens are
// keyboard navigable (Enter/Space confirms the primary action, Tab cycles
// real <button>s) and touch friendly.

import { CFG, IS_MOBILE } from './config.js';

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
    this._modesBackBtn = button('mf-btn-back mf-modes-back', head, '◀ BACK',
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
      this._bestEl.textContent = `🏆 BEST ${fmt(highscore)}`;
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
  // LEVEL SELECT — a Mario/Candy-Crush style mini world map. A winding SVG
  // path snakes from START to FINISH across a stylized farm; 20 UFO nodes
  // sit along it (completed / current / locked states). Its own overlay so
  // it floats above the start screen and survives day-cycle re-tints.
  // ======================================================================

  _buildLevelSelect() {
    const s = el('div', 'mf-screen mf-levelsel mf-hidden');
    s.id = 'mf-levelsel';

    // Sky tint overlay — driven by --mf-phase-glow (set on :root by the HUD).
    el('div', 'mf-ls-sky', s);
    // Decorative twinkling starfield (re-using the start-screen technique).
    const stars = el('div', 'mf-ls-stars', s);
    const sa = el('div', 'mf-stars-layer mf-ls-star-a', stars);
    const sb = el('div', 'mf-stars-layer mf-ls-star-b', stars);
    sa.style.boxShadow = starShadows(70, 1600, 1000);
    sb.style.boxShadow = starShadows(40, 1600, 1000);
    // Drifting clouds.
    for (let i = 0; i < 3; i++) {
      const c = el('div', `mf-ls-cloud mf-ls-cloud-${i}`, s);
      c.style.setProperty('--i', i);
    }

    const head = el('div', 'mf-ls-head', s);
    this._lsBackBtn = button('mf-btn-back mf-ls-back', head, '◀ BACK',
      () => this._closeLevelSelect());
    el('h2', 'mf-panel-title mf-ls-title', head, 'CAMPAIGN');
    // spacer to keep the title centred opposite the back button
    el('div', 'mf-ls-headspacer', head);

    // Scroll container so the tall map fits / scrolls on small screens.
    const scroll = el('div', 'mf-ls-scroll', s);
    this._lsScroll = scroll;
    this._lsMap = el('div', 'mf-ls-map', scroll);

    document.body.appendChild(s);
    this._levelSelEl = s;
  }

  /**
   * Render the winding path + 20 nodes into the map. Re-built on every show
   * so completion / unlock state always reflects the latest campaign data.
   */
  _renderLevelMap() {
    const map = this._lsMap;
    map.textContent = '';

    const levels = this._levels();
    const n = levels.length;
    const unlocked = this._unlockedCount();

    // --- layout: a serpentine path on a 100×(rows*step) viewBox. Nodes zig-
    // zag left↔right as they climb so the SVG path can weave between them. ---
    const VW = 100;
    const rowStep = 150;            // vertical spacing between nodes (viewBox units)
    const top = 90, bottom = 70;    // padding at FINISH (top) and START (bottom)
    const VH = top + bottom + (n - 1) * rowStep;
    const leftX = 26, rightX = 74;  // the two zig-zag columns
    const midX = 50;

    // Nodes are laid out bottom→top (level 1 at the bottom, by the START flag).
    const pts = levels.map((lvl, i) => {
      const y = VH - bottom - i * rowStep;
      // gentle sine sway so columns aren't perfectly rigid
      const base = i % 2 === 0 ? leftX : rightX;
      const x = base + Math.sin(i * 1.3) * 6;
      return { x, y, lvl, i };
    });

    // SVG: sky-less (the overlay paints sky); just the trail + doodads + flags.
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'mf-ls-svg');
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
    map.style.setProperty('--mf-ls-ratio', `${VW} / ${VH}`);

    // Build a smooth path string through the points (quadratic midpoints).
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      const cx = (p0.x + p1.x) / 2;
      const cy = (p0.y + p1.y) / 2;
      // control point pushed toward mid-column for a lazy S-curve
      const ctrlX = (cx + midX) / 2;
      d += ` Q ${ctrlX} ${p0.y - rowStep / 2} ${p1.x} ${p1.y}`;
    }

    // dashed "shadow" under-trail + bright trail on top
    const trailShadow = document.createElementNS(svgNS, 'path');
    trailShadow.setAttribute('class', 'mf-ls-trail-shadow');
    trailShadow.setAttribute('d', d);
    svg.appendChild(trailShadow);
    const trail = document.createElementNS(svgNS, 'path');
    trail.setAttribute('class', 'mf-ls-trail');
    trail.setAttribute('d', d);
    svg.appendChild(trail);

    // little fence / tree doodads scattered beside the path
    const doodads = [
      { t: 'tree', x: 12, fy: 0.14 }, { t: 'fence', x: 88, fy: 0.30 },
      { t: 'tree', x: 90, fy: 0.52 }, { t: 'fence', x: 10, fy: 0.66 },
      { t: 'tree', x: 14, fy: 0.84 }, { t: 'fence', x: 86, fy: 0.92 },
    ];
    for (const dd of doodads) {
      const gy = top + dd.fy * (VH - top - bottom);
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', `mf-ls-doodad mf-ls-${dd.t}`);
      g.setAttribute('transform', `translate(${dd.x} ${gy})`);
      if (dd.t === 'tree') {
        const trunk = document.createElementNS(svgNS, 'rect');
        trunk.setAttribute('x', '-1.1'); trunk.setAttribute('y', '0');
        trunk.setAttribute('width', '2.2'); trunk.setAttribute('height', '7');
        trunk.setAttribute('class', 'mf-ls-trunk');
        const top1 = document.createElementNS(svgNS, 'circle');
        top1.setAttribute('cx', '0'); top1.setAttribute('cy', '-2'); top1.setAttribute('r', '5');
        top1.setAttribute('class', 'mf-ls-leaf');
        g.appendChild(trunk); g.appendChild(top1);
      } else {
        for (let k = 0; k < 4; k++) {
          const post = document.createElementNS(svgNS, 'rect');
          post.setAttribute('x', String(-6 + k * 4)); post.setAttribute('y', '-5');
          post.setAttribute('width', '1.6'); post.setAttribute('height', '8');
          post.setAttribute('class', 'mf-ls-post');
          g.appendChild(post);
        }
        const rail = document.createElementNS(svgNS, 'rect');
        rail.setAttribute('x', '-6.5'); rail.setAttribute('y', '-3.5');
        rail.setAttribute('width', '13'); rail.setAttribute('height', '1.6');
        rail.setAttribute('class', 'mf-ls-post');
        g.appendChild(rail);
      }
      svg.appendChild(g);
    }
    map.appendChild(svg);

    // START / FINISH flags as DOM (positioned in %).
    const start = el('div', 'mf-ls-flag mf-ls-flag-start', map, 'START');
    start.style.left = `${pts[0].x}%`;
    start.style.top = `${((pts[0].y + 34) / VH) * 100}%`;
    const finish = el('div', 'mf-ls-flag mf-ls-flag-finish', map, 'FINISH');
    finish.style.left = `${pts[n - 1].x}%`;
    finish.style.top = `${((pts[n - 1].y - 46) / VH) * 100}%`;

    // --- nodes ---
    this._lsNodes = [];
    let firstFocus = null;
    for (const p of pts) {
      const index = p.lvl.index ?? (p.i + 1);
      const completed = this._isCompleted(index);
      const isCurrent = !completed && index === unlocked;
      const locked = index > unlocked;
      const stars = completed ? this._starsFor(index) : 0;

      let cls = 'mf-ls-node';
      if (locked) cls += ' mf-ls-locked';
      else if (completed) cls += ' mf-ls-done';
      else if (isCurrent) cls += ' mf-ls-current';
      else cls += ' mf-ls-open';

      const node = el(locked ? 'div' : 'button', cls, map);
      if (!locked) node.type = 'button';
      node.style.left = `${p.x}%`;
      node.style.top = `${(p.y / VH) * 100}%`;
      node.dataset.index = String(index);

      // little UFO icon (CSS art)
      const ufo = el('div', 'mf-ls-ufo', node);
      el('div', 'mf-ls-ufo-dome', ufo);
      el('div', 'mf-ls-ufo-body', ufo);
      // level number on the UFO body
      el('div', 'mf-ls-num', node, String(index));

      // goal pill (tiny "1000 pts")
      const target = Number(p.lvl.target) || 0;
      if (target > 0) el('div', 'mf-ls-goal', node, `${fmt(target)} pts`);

      if (locked) {
        el('div', 'mf-ls-lock', node, '🔒');
        node.setAttribute('aria-disabled', 'true');
      } else {
        if (completed) {
          el('div', 'mf-ls-check', node, '✓');
          // earned stars
          const sw = el('div', 'mf-ls-stars', node);
          for (let k = 0; k < 3; k++) {
            el('div', `mf-ls-star${k < stars ? ' mf-ls-star-on' : ''}`, sw, '★');
          }
        }
        node.setAttribute('aria-label',
          `Level ${index}${completed ? ', completed' : ''}${isCurrent ? ', current' : ''}, goal ${fmt(target)} points`);
        node.addEventListener('click', (e) => {
          e.preventDefault();
          this._startLevel(index);
        });
        // Prefer focusing the "current" level; else the first playable node.
        if (isCurrent) firstFocus = node;
        else if (!firstFocus) firstFocus = node;
      }
      this._lsNodes.push(node);
    }
    this._lsFocusNode = firstFocus;
  }

  /** Public: open the LEVEL SELECT world map. */
  showLevelSelect() {
    // If the start overlay is up, it stays beneath; the level-select sits over
    // it (and over the result overlay if that was showing).
    this.hideEnd();
    this._renderLevelMap();
    const s = this._levelSelEl;
    s.classList.remove('mf-hidden');
    s.classList.remove('mf-anim');
    void s.offsetWidth;
    s.classList.add('mf-anim');
    this._levelSelectVisible = true;
    // Scroll so the current level (bottom-ish) is in view, then focus it.
    requestAnimationFrame(() => {
      const focus = this._lsFocusNode;
      if (focus) {
        focus.scrollIntoView({ block: 'center', behavior: 'auto' });
        focus.focus({ preventScroll: true });
      } else {
        this._lsBackBtn.focus({ preventScroll: true });
      }
    });
  }

  /** Hide the level-select map (without choosing a level). */
  hideLevelSelect() {
    this._levelSelEl.classList.add('mf-hidden');
    this._levelSelectVisible = false;
  }

  /** BACK from level select → return to the mode selector view. */
  _closeLevelSelect() {
    this.hideLevelSelect();
    // Make sure the start overlay is visible on the modes view behind it.
    if (!this._startVisible) {
      this.showStart(this._lastHighscore || 0);
    }
    this._setStartViewForced('modes');
  }

  /** Like _setStartView but tolerant of being called when already on title. */
  _setStartViewForced(name) {
    if (this._startView === name) {
      // Re-assert the DOM classes (showStart resets to title).
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
    this._backBtn = button('mf-btn-back', head, '◀ BACK', () => this._setPauseView('root'));
    el('h2', 'mf-panel-title mf-set-title', head, 'SETTINGS');

    // SOUND toggle row (state mirrored via setMuteUI, as before).
    const soundRow = el('div', 'mf-set-row', view);
    el('div', 'mf-set-label', soundRow, 'SOUND');
    this._muteBtn = button('mf-btn-toggle mf-btn-mute', soundRow, '🔊 ON',
      () => this.cb.onToggleMute());

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
    el('span', 'mf-recap-ico', touch, '☝️');
    el('span', 'mf-recap-txt', touch, 'left side: joystick / hold BEAM / hold WARP');
    this._gamepadRow = el('div', 'mf-recap-row mf-hidden', sec);
    el('span', 'mf-recap-ico', this._gamepadRow, '🎮');
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
      this._muteBtn.textContent = this._muted ? '🔇 OFF' : '🔊 ON';
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
        el('span', 'mf-medal-star', disc, '★');
        el('div', 'mf-medal-label', wrap, `${medal.toUpperCase()} MEDAL`);
      } else {
        el('div', 'mf-nomedal', panel,
          `NO MEDAL — ${fmt(CFG.MEDALS.bronze)} PTS FOR BRONZE. KEEP BEAMING!`);
      }
    }

    if (isNewBest) {
      el('div', 'mf-ribbon', panel, '★ NEW RECORD! ★');
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
      // Three star slots; the earned ones pop in on a stagger.
      const sw = el('div', 'mf-lr-stars', panel);
      for (let k = 0; k < 3; k++) {
        const slot = el('div', `mf-lr-star${k < stars ? ' mf-lr-star-on' : ''}`, sw, '★');
        slot.style.setProperty('--i', k);
      }
      if (isNewBest) el('div', 'mf-ribbon mf-lr-best', panel, '★ NEW BEST! ★');
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
