// MOO-FO — UI screens (Agent U)
// Title / countdown / pause / game-over / win screens. All DOM is built here
// and appended to document.body. Screens are keyboard navigable (Enter/Space
// confirms the primary action, Tab cycles real <button>s) and touch friendly.

import { CFG, IS_MOBILE } from './config.js';

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
  constructor({ onStart, onResume, onRestart, onQuitToMenu, onToggleMute } = {}) {
    this.cb = {
      onStart: onStart || (() => {}),
      onResume: onResume || (() => {}),
      onRestart: onRestart || (() => {}),
      onQuitToMenu: onQuitToMenu || (() => {}),
      onToggleMute: onToggleMute || (() => {}),
    };

    this._startVisible = false;
    this._pauseVisible = false;
    this._endVisible = false;
    this._startArmed = false; // guards double-starts
    this._muted = false;

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

    // Starfield backdrop (semi-transparent so the 3D scene shows through).
    const stars = el('div', 'mf-stars', s);
    const layerA = el('div', 'mf-stars-layer mf-stars-a', stars);
    const layerB = el('div', 'mf-stars-layer mf-stars-b', stars);
    layerA.style.boxShadow = starShadows(90, 2000, 1400);
    layerB.style.boxShadow = starShadows(50, 2000, 1400);

    const panel = el('div', 'mf-start-panel', s);

    // CSS-art scene: UFO bobbing over a cow caught in a looping beam.
    const scene = el('div', 'mf-title-scene', panel);
    const ufo = el('div', 'mf-ufo-art', scene);
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
    const logo = el('h1', 'mf-logo', panel);
    logo.setAttribute('aria-label', 'MOO-FO');
    'MOO-FO'.split('').forEach((ch, i) => {
      const span = el('span', ch === '-' ? 'mf-logo-ch mf-logo-dash' : 'mf-logo-ch', logo, ch);
      span.style.setProperty('--i', i);
    });

    el('div', 'mf-tagline', panel, 'ABDUCT ALL THE COWS');
    this._bestEl = el('div', 'mf-best mf-hidden', panel);

    this._startBtn = button('mf-btn-primary mf-btn-start', panel, 'START', () => this._pressStart());

    // Adaptive controls help.
    const help = el('div', 'mf-help', panel);
    if (IS_MOBILE) {
      const row = el('div', 'mf-help-row', help);
      el('span', 'mf-help-item', row, '☝️ drag left side to fly');
      el('span', 'mf-help-item', row, '🛸 hold BEAM to abduct');
      el('span', 'mf-help-item', row, '⚡ hold WARP for speed');
    } else {
      const row = el('div', 'mf-help-row', help);
      const item = (keys, label) => {
        const it = el('span', 'mf-help-item', row);
        keys.forEach((k) => el('kbd', 'mf-kbd', it, k));
        el('span', 'mf-help-txt', it, label);
      };
      item(['W', 'A', 'S', 'D'], 'fly');
      item(['␣'], 'beam');
      item(['⇧'], 'warp');
      item(['ESC'], 'pause');
    }

    el('div', 'mf-vignette-static', s);

    document.body.appendChild(s);
    this._startEl = s;
  }

  showStart(highscore = 0) {
    this._startEl.classList.remove('mf-hidden', 'mf-exit');
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

  /** Exit animation (logo flies up, panel drops); resolves when done. */
  hideStart() {
    if (!this._startVisible) return Promise.resolve();
    this._startVisible = false;
    this._startEl.classList.add('mf-exit');
    return new Promise((resolve) => {
      setTimeout(() => {
        this._startEl.classList.add('mf-hidden');
        this._startEl.classList.remove('mf-exit', 'mf-anim');
        resolve();
      }, 700);
    });
  }

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
    el('h2', 'mf-panel-title', panel, 'PAUSED');

    const col = el('div', 'mf-btn-col', panel);
    this._resumeBtn = button('mf-btn-primary', col, 'RESUME', () => this.cb.onResume());
    button('', col, 'RESTART', () => this.cb.onRestart());
    this._muteBtn = button('mf-btn-mute', col, '🔊 SOUND ON', () => this.cb.onToggleMute());
    button('mf-btn-quiet', col, 'QUIT TO MENU', () => this.cb.onQuitToMenu());

    const recap = el('div', 'mf-recap', panel);
    recap.textContent = IS_MOBILE
      ? '☝️ drag = fly · 🛸 BEAM = abduct · ⚡ WARP = speed'
      : 'WASD/arrows fly · SPACE beam · SHIFT warp · ESC resume';

    document.body.appendChild(s);
    this._pauseEl = s;
  }

  showPause(muted) {
    this.setMuteUI(!!muted);
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
      this._muteBtn.textContent = this._muted ? '🔇 SOUND OFF' : '🔊 SOUND ON';
      this._muteBtn.classList.toggle('mf-muted', this._muted);
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
        this._pressStart();
      } else if (this._pauseVisible) {
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
