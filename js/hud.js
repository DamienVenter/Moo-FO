// MOO-FO — HUD (Agent U)
// In-game overlay: score + cow chip + combo badge (top-left), timer
// (top-center, red pulse in the last CFG.TICK_WARN_TIME seconds), health +
// warp bars (bottom-left), live minimap (top-right), damage vignette and
// center announcements. All DOM updates are diffed against cached values so
// per-frame update() stays cheap.
//
// Also owns the always-visible day-cycle clock widget (its OWN root on
// document.body, z-index above every menu screen, pointer-events none) —
// driven by updateClock({ phase, name, icon }) every frame.

import { CFG } from './config.js';

const HEALTH_SEGS = 10;

// Day-phase tints — forwarded to end-screen backdrops via --mf-phase-glow.
const CLOCK_TINTS = {
  NIGHT: '#7aa2ff',   // soft blue
  SUNRISE: '#ff9e80', // peachy orange
  DAY: '#ffd54f',     // gold
  SUNSET: '#ff8a50',  // deep orange
};

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export class HUD {
  constructor(world) {
    this._buildDOM();
    this._buildMinimap(world);
    this._clockName = null;   // last day-phase name seen (drives end-screen tint)

    // Cached previous values — update() only touches DOM on change.
    this._prev = {
      score: -1,
      cows: -1,
      combo: -1,
      timeText: '',
      warn: null,
      healthSegs: -1,
      healthCls: '',
      health: CFG.UFO_MAX_HEALTH,
      warpPct: -1,
      warpFull: null,
      goalOn: null,
      goalHit: null,
    };
  }

  // ======================================================================
  // DOM
  // ======================================================================

  _buildDOM() {
    const root = el('div', 'mf-hud mf-hidden');
    root.id = 'mf-hud';

    // --- Score (top-left) ---
    const scoreWrap = el('div', 'mf-score-wrap', root);
    el('div', 'mf-score-label', scoreWrap, 'SCORE');
    this._scoreEl = el('div', 'mf-score', scoreWrap, '0');
    const chipRow = el('div', 'mf-chip-row', scoreWrap);
    const chip = el('div', 'mf-cow-chip', chipRow);
    el('span', 'mf-cow-chip-ico', chip, '🐄');
    this._cowsEl = el('span', 'mf-cow-chip-n', chip, '×0');
    this._comboEl = el('div', 'mf-combo mf-hidden', chipRow, '×2');

    // --- Timer (top-center) ---
    this._timerEl = el('div', 'mf-timer', root, '1:30');

    // --- Campaign goal pill (below the timer; hidden in free play) ---
    this._goalEl = el('div', 'mf-goal mf-hidden', root, '');
    Object.assign(this._goalEl.style, {
      position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
      left: '50%', transform: 'translateX(-50%)',
      font: '700 15px/1 system-ui, sans-serif', letterSpacing: '0.5px',
      color: '#fff', background: 'rgba(20,16,40,0.55)',
      border: '2px solid rgba(124,252,154,0.55)', borderRadius: '999px',
      padding: '5px 12px', whiteSpace: 'nowrap', pointerEvents: 'none',
      textShadow: '0 1px 2px rgba(0,0,0,0.6)',
    });

    // --- Bars (bottom-left) ---
    const bars = el('div', 'mf-bars', root);

    const hpRow = el('div', 'mf-bar-row', bars);
    el('div', 'mf-bar-label', hpRow, 'HULL');
    this._healthBar = el('div', 'mf-bar mf-health-bar mf-hp-hi', hpRow);
    this._healthSegEls = [];
    for (let i = 0; i < HEALTH_SEGS; i++) {
      this._healthSegEls.push(el('div', 'mf-seg mf-on', this._healthBar));
    }

    const wpRow = el('div', 'mf-bar-row', bars);
    el('div', 'mf-bar-label', wpRow, 'WARP');
    this._warpBar = el('div', 'mf-bar mf-warp-bar', wpRow);
    this._warpFill = el('div', 'mf-warp-fill', this._warpBar);
    el('div', 'mf-warp-shimmer', this._warpFill);

    // --- Minimap (top-right) ---
    this._mapWrap = el('div', 'mf-minimap-wrap', root);
    this._mapCanvas = el('canvas', 'mf-minimap', this._mapWrap);
    this._mapCanvas.id = 'mf-minimap';

    // --- Announcements + damage vignette ---
    this._announceLayer = el('div', 'mf-announce-layer', root);
    this._vignette = el('div', 'mf-vignette', root);

    document.body.appendChild(root);
    this.root = root;
  }

  _buildMinimap(world) {
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const size = small ? 130 : 170;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._mapSize = size;

    const setup = (canvas) => {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    this._mapCanvas.style.width = `${size}px`;
    this._mapCanvas.style.height = `${size}px`;
    this._mctx = setup(this._mapCanvas);

    // Pre-render the static world ONCE into an offscreen canvas; per-tick
    // updates just blit this and stamp dots on top.
    this._mapStatic = document.createElement('canvas');
    const offCtx = setup(this._mapStatic);
    try {
      world.drawMinimap(offCtx, size);
    } catch (err) {
      // Defensive: never let a world hiccup kill the HUD.
      offCtx.fillStyle = '#1c2a26';
      offCtx.fillRect(0, 0, size, size);
      console.warn('[HUD] world.drawMinimap failed:', err);
    }
    this._mctx.drawImage(this._mapStatic, 0, 0, size, size);
  }

  /**
   * Day-cycle clock — a small semicircular arc dial. Lives OUTSIDE the HUD
   * root (own element on document.body) so it stays visible through menus,
   * pause and end screens; z-index sits above every overlay, pointer-events
   * none. Hidden until the first updateClock() call arrives.
   */
  _buildClock() {
    const root = el('div', 'mf-clock mf-clock-idle');
    root.id = 'mf-clock';

    const dial = el('div', 'mf-clock-dial', root);
    el('div', 'mf-clock-horizon', dial);
    this._sunEl = el('div', 'mf-clock-marker mf-clock-sun', dial, '☀️');
    this._moonEl = el('div', 'mf-clock-marker mf-clock-moon', dial, '🌙');

    const label = el('div', 'mf-clock-name', root);
    this._clockIconEl = el('span', 'mf-clock-ico', label, '');
    this._clockNameEl = el('span', 'mf-clock-txt', label, '');

    // Desktop docking: directly below the minimap (wrap = size + 12px chrome,
    // top 10px, 8px gap). Small screens reposition via media query in CSS.
    root.style.setProperty('--mf-clock-top', `${10 + this._mapSize + 12 + 8}px`);

    document.body.appendChild(root);
    this._clockEl = root;
    this._clockQ = null;     // last phase, quantized to CLOCK_STEP
    this._clockName = null;  // last phase name
  }

  // ======================================================================
  // Public API
  // ======================================================================

  show() { this.root.classList.remove('mf-hidden'); }
  hide() { this.root.classList.add('mf-hidden'); }

  /** Called every frame by main — only touches DOM when a value changed. */
  update({ score, timeLeft, health, combo, warpEnergy, cows, goal } = {}) {
    const p = this._prev;

    // Campaign goal pill: "🎯 score / target", greener once the goal is hit.
    if (typeof goal === 'number') {
      const on = goal > 0;
      if (on !== p.goalOn) {
        p.goalOn = on;
        this._goalEl.classList.toggle('mf-hidden', !on);
        this._goalEl.style.display = on ? 'block' : 'none';
      }
      if (on) {
        const sc = typeof score === 'number' ? score : 0;
        this._goalEl.textContent = `🎯 ${sc.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}`;
        const hit = sc >= goal;
        if (hit !== p.goalHit) {
          p.goalHit = hit;
          this._goalEl.style.borderColor = hit ? 'rgba(124,252,154,1)' : 'rgba(124,252,154,0.55)';
          this._goalEl.style.background = hit ? 'rgba(40,120,60,0.7)' : 'rgba(20,16,40,0.55)';
        }
      }
    }

    // Score
    if (typeof score === 'number' && score !== p.score) {
      p.score = score;
      this._scoreEl.textContent = score.toLocaleString('en-US');
      this._repop(this._scoreEl, 'mf-score-bump');
    }

    // Cow count chip (optional field — main may include it)
    if (typeof cows === 'number' && cows !== p.cows) {
      p.cows = cows;
      this._cowsEl.textContent = `×${cows}`;
    }

    // Combo badge (visible when combo >= 2, bouncy pop on change)
    if (typeof combo === 'number' && combo !== p.combo) {
      p.combo = combo;
      if (combo >= 2) {
        this._comboEl.textContent = `×${combo}`;
        this._comboEl.classList.remove('mf-hidden');
        this._repop(this._comboEl, 'mf-pop');
      } else {
        this._comboEl.classList.add('mf-hidden');
      }
    }

    // Timer
    if (typeof timeLeft === 'number') {
      const t = Math.max(0, Math.ceil(timeLeft));
      const text = t >= 60
        ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
        : `${t}`;
      if (text !== p.timeText) {
        p.timeText = text;
        this._timerEl.textContent = text;
      }
      const warn = timeLeft <= CFG.TICK_WARN_TIME && timeLeft > 0;
      if (warn !== p.warn) {
        p.warn = warn;
        this._timerEl.classList.toggle('mf-warn', warn);
      }
    }

    // Health (segments + green→yellow→red + shake on damage)
    if (typeof health === 'number') {
      if (health < p.health - 0.001) this._repop(this._healthBar, 'mf-shake');
      p.health = health;
      const frac = Math.max(0, Math.min(1, health / CFG.UFO_MAX_HEALTH));
      const segs = frac <= 0 ? 0 : Math.max(1, Math.ceil(frac * HEALTH_SEGS));
      if (segs !== p.healthSegs) {
        p.healthSegs = segs;
        for (let i = 0; i < HEALTH_SEGS; i++) {
          this._healthSegEls[i].classList.toggle('mf-on', i < segs);
        }
      }
      const cls = frac > 0.6 ? 'mf-hp-hi' : frac > 0.3 ? 'mf-hp-mid' : 'mf-hp-low';
      if (cls !== p.healthCls) {
        this._healthBar.classList.remove('mf-hp-hi', 'mf-hp-mid', 'mf-hp-low');
        this._healthBar.classList.add(cls);
        p.healthCls = cls;
      }
    }

    // Warp energy
    if (typeof warpEnergy === 'number') {
      const pct = Math.round(Math.max(0, Math.min(1, warpEnergy)) * 100);
      if (pct !== p.warpPct) {
        p.warpPct = pct;
        this._warpFill.style.width = `${pct}%`;
      }
      const full = pct >= 100;
      if (full !== p.warpFull) {
        p.warpFull = full;
        this._warpBar.classList.toggle('mf-warp-full', full);
      }
    }
  }

  /** ~10 Hz: blit pre-rendered map, then stamp entity dots + player arrow. */
  updateMinimap({ player, cows = [], farmers = [] } = {}) {
    const ctx = this._mctx;
    const size = this._mapSize;
    const scale = size / (CFG.MAP_HALF * 2);
    const toX = (x) => (x + CFG.MAP_HALF) * scale;
    const toY = (z) => (z + CFG.MAP_HALF) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this._mapStatic, 0, 0, size, size);

    // Keep the minimap uncluttered: show only the objective (golden cow),
    // the threats (farmers) and the player — not the whole herd.
    let golden = null;
    for (let i = 0; i < cows.length; i++) {
      if (cows[i].kind === 'golden') { golden = cows[i]; break; }
    }

    if (golden) {
      const r = 3.5 + Math.sin(performance.now() * 0.008) * 0.7; // 2.8–4.2px
      ctx.fillStyle = '#ffd54f';
      ctx.shadowColor = '#ffd54f';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(toX(golden.x), toY(golden.z), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Farmers: red 3px
    ctx.fillStyle = '#ff5252';
    for (let i = 0; i < farmers.length; i++) {
      ctx.fillRect(toX(farmers[i].x) - 1.5, toY(farmers[i].z) - 1.5, 3, 3);
    }

    // Player: green triangle rotated by heading (heading 0 = -Z = map up)
    if (player) {
      ctx.save();
      ctx.translate(toX(player.x), toY(player.z));
      ctx.rotate(player.heading || 0);
      ctx.fillStyle = '#7cfc9a';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -5.5);
      ctx.lineTo(4, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Day-cycle clock indicator was removed at the player's request; the cycle
   * itself still runs. Kept as a no-op so existing call sites stay safe, and
   * it forwards the live phase tint to end-screen backdrops via --mf-phase-glow.
   */
  updateClock({ name } = {}) {
    if (name && name !== this._clockName) {
      this._clockName = name;
      document.documentElement.style.setProperty(
        '--mf-phase-glow', CLOCK_TINTS[name] || CLOCK_TINTS.NIGHT);
    }
  }

  /** Full-screen red vignette flash on damage. */
  flashDamage() {
    this._repop(this._vignette, 'mf-flash');
  }

  /**
   * Big center banner that stamps in and fades out.
   * opts: { sub?:string, color?:string, duration?:ms }
   */
  announce(text, opts = {}) {
    const { sub, color, duration = 1800 } = opts;

    // Keep at most 2 banners on screen.
    while (this._announceLayer.children.length >= 2) {
      this._announceLayer.removeChild(this._announceLayer.firstChild);
    }

    const banner = el('div', 'mf-announce', this._announceLayer);
    if (color) banner.style.setProperty('--mf-ann-color', color);
    el('div', 'mf-announce-main', banner, text);
    if (sub) el('div', 'mf-announce-sub', banner, sub);
    banner.style.animationDuration = `${duration}ms`;

    setTimeout(() => {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, duration + 100);
  }

  // ======================================================================
  // Helpers
  // ======================================================================

  /** Restart a one-shot CSS animation class on an element. */
  _repop(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // force reflow so the animation replays
    node.classList.add(cls);
  }
}
