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
  constructor({ onStart, onResume, onRestart, onQuitToMenu, onToggleMute, onSelectMode, controls } = {}) {
    this.cb = {
      onStart: onStart || (() => {}),
      onResume: onResume || (() => {}),
      onRestart: onRestart || (() => {}),
      onQuitToMenu: onQuitToMenu || (() => {}),
      onToggleMute: onToggleMute || (() => {}),
      onSelectMode: onSelectMode || (() => {}),
    };
    // Controls instance (binds / bindLabels / rebind / resetBinds /
    // gamepadConnected). Optional & duck-typed so the UI degrades gracefully
    // if it isn't wired up yet.
    this.controls = controls || null;

    this._startVisible = false;
    this._pauseVisible = false;
    this._endVisible = false;
    this._startArmed = false; // guards double-starts
    this._muted = false;
    this._startView = 'title'; // 'title' | 'modes' — start-overlay sub-view
    this._pauseView = 'root'; // 'root' | 'settings'
    this._capturing = false;  // true while a key-rebind capture is active

    this._buildStart();
    this._buildCountdown();
    this._buildPause();
    this._buildEndShell();
    this._bindKeys();
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

    const MODES = [
      { key: 'campaign',    name: 'CAMPAIGN',    sub: 'Story missions across the galaxy', locked: true },
      { key: 'multiplayer', name: 'MULTIPLAYER', sub: 'Beam-off against your friends',    locked: true },
      { key: 'freeplay',    name: 'FREE PLAY',   sub: '90-second high-score rush',         locked: false },
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
  // Keyboard: Enter/Space confirms the visible screen's primary action.
  // ======================================================================

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const confirm = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
      if (!confirm) return;
      if (this._startVisible) {
        e.preventDefault();
        if (this._startView === 'modes') {
          // If a specific card is focused, honour it (locked → coming soon);
          // otherwise default to starting Free Play.
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
        this.cb.onRestart();
      }
    });
  }
}
