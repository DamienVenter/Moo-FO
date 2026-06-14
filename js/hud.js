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

// Crisp inline-SVG icons (no emojis anywhere in the HUD).
const COW_SVG =
  '<svg width="20" height="17" viewBox="0 0 20 17" aria-hidden="true">' +
  '<path d="M3 3 Q1 1 2 5 Z" fill="#2b2b2b"/><path d="M17 3 Q19 1 18 5 Z" fill="#2b2b2b"/>' +
  '<ellipse cx="10" cy="9" rx="6.6" ry="5.4" fill="#f5f5f0"/>' +
  '<ellipse cx="6.4" cy="6.6" rx="2" ry="1.5" fill="#2b2b2b"/>' +
  '<ellipse cx="13.8" cy="10.8" rx="1.5" ry="1.1" fill="#2b2b2b"/>' +
  '<circle cx="8" cy="8.4" r="0.9" fill="#2b2b2b"/><circle cx="12" cy="8.4" r="0.9" fill="#2b2b2b"/>' +
  '<ellipse cx="10" cy="12" rx="3.2" ry="2.2" fill="#f2a9b8"/>' +
  '<circle cx="8.7" cy="12.1" r="0.6" fill="#c97a8c"/><circle cx="11.3" cy="12.1" r="0.6" fill="#c97a8c"/>' +
  '</svg>';
const TARGET_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:-2px;margin-right:5px">' +
  '<circle cx="8" cy="8" r="7" fill="none" stroke="#7cfc9a" stroke-width="2"/>' +
  '<circle cx="8" cy="8" r="3.4" fill="none" stroke="#7cfc9a" stroke-width="2"/>' +
  '<circle cx="8" cy="8" r="1.1" fill="#7cfc9a"/></svg>';

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
      canComplete: false,
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
    const cowIco = el('span', 'mf-cow-chip-ico', chip);
    cowIco.innerHTML = COW_SVG;
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
    this._goalEl.innerHTML = TARGET_SVG;
    this._goalTxt = el('span', '', this._goalEl, '');

    // --- Campaign objectives (top-center, below the goal; out of the way) ---
    this._objEl = el('div', 'mf-objectives', root);
    Object.assign(this._objEl.style, {
      position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 86px)',
      left: '50%', transform: 'translateX(-50%)', display: 'none',
      flexDirection: 'column', gap: '3px', alignItems: 'flex-start',
      font: '700 12px/1.2 system-ui, sans-serif', pointerEvents: 'none',
      padding: '6px 10px', borderRadius: '10px', background: 'rgba(20,16,40,0.42)',
    });
    this._objRows = [];

    // --- Campaign COMPLETE button (bottom-center; hidden until goal met) ---
    this._completeBtn = document.createElement('button');
    this._completeBtn.type = 'button';
    this._completeBtn.innerHTML =
      'MISSION COMPLETE <span style="opacity:.65;font-size:.85em">Q</span>';
    Object.assign(this._completeBtn.style, {
      position: 'absolute', left: '50%', transform: 'translateX(-50%)',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
      display: 'none', pointerEvents: 'auto', cursor: 'pointer',
      font: '900 16px/1 system-ui, sans-serif', letterSpacing: '0.5px',
      color: '#1a1230', background: 'linear-gradient(180deg,#ffe07a,#ffc23a)',
      border: '3px solid #7a5a18', borderRadius: '999px', padding: '10px 20px',
      boxShadow: '0 4px 0 rgba(0,0,0,0.35), 0 0 18px rgba(255,210,80,0.55)',
    });
    this._completeBtn.addEventListener('click', () => { if (this.onComplete) this.onComplete(); });
    root.appendChild(this._completeBtn);
    this.onComplete = null;

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

  // ======================================================================
  // Public API
  // ======================================================================

  show() {
    this.root.classList.remove('mf-hidden');
    // reset campaign-only widgets each round (re-populated if in campaign)
    this._objEl.style.display = 'none';
    this._completeBtn.style.display = 'none';
    this._prev.canComplete = false;
  }
  hide() {
    this.root.classList.add('mf-hidden');
    this._objEl.style.display = 'none';
    this._completeBtn.style.display = 'none';
  }

  /** Campaign objectives panel: rows of {label, done}. Pass null to hide. */
  setObjectives(objectives) {
    if (!objectives || !objectives.length) { this._objEl.style.display = 'none'; return; }
    this._objEl.style.display = 'flex';
    while (this._objRows.length < objectives.length) {
      const row = el('div', '', this._objEl);
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' });
      const mark = el('span', '', row);
      Object.assign(mark.style, { width: '14px', display: 'inline-block', textAlign: 'center', fontWeight: '900' });
      const txt = el('span', '', row);
      this._objRows.push({ row, mark, txt });
    }
    for (let i = 0; i < this._objRows.length; i++) {
      const r = this._objRows[i];
      if (i >= objectives.length) { r.row.style.display = 'none'; continue; }
      r.row.style.display = 'flex';
      const o = objectives[i];
      r.mark.textContent = o.done ? '✓' : '•';
      r.mark.style.color = o.done ? '#7cfc9a' : 'rgba(255,255,255,0.5)';
      r.txt.textContent = o.label;
      r.txt.style.color = o.done ? '#dffbe6' : 'rgba(255,255,255,0.82)';
      r.txt.style.textShadow = '0 1px 2px rgba(0,0,0,0.6)';
    }
  }

  /** Called every frame by main — only touches DOM when a value changed. */
  update({ score, timeLeft, health, maxHealth, combo, warpEnergy, cows, goal, canComplete } = {}) {
    const p = this._prev;

    // Campaign COMPLETE button — appears once the score goal is met.
    if (typeof canComplete === 'boolean' && canComplete !== p.canComplete) {
      p.canComplete = canComplete;
      this._completeBtn.style.display = canComplete ? 'block' : 'none';
      if (canComplete) this._repop(this._completeBtn, 'mf-pop');
    }

    // Campaign goal pill (target icon + "score / target"); greener once hit.
    if (typeof goal === 'number') {
      const on = goal > 0;
      if (on !== p.goalOn) {
        p.goalOn = on;
        this._goalEl.classList.toggle('mf-hidden', !on);
        this._goalEl.style.display = on ? 'block' : 'none';
      }
      if (on) {
        const sc = typeof score === 'number' ? score : 0;
        this._goalTxt.textContent = `${sc.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}`;
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
      // Use the ship's CURRENT max (hull upgrades raise it) so an undamaged
      // hull always reads full, whatever the player's hull level.
      const hpMax = (typeof maxHealth === 'number' && maxHealth > 0) ? maxHealth : CFG.UFO_MAX_HEALTH;
      const frac = Math.max(0, Math.min(1, health / hpMax));
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

  /** ~10 Hz: a simplified map — muted terrain + little cow/sheep/farmer/dog
   *  icons + the golden cow + the player arrow. */
  updateMinimap({ player, cows = [], farmers = [], dogs = [] } = {}) {
    const ctx = this._mctx;
    const size = this._mapSize;
    const scale = size / (CFG.MAP_HALF * 2);
    const toX = (x) => (x + CFG.MAP_HALF) * scale;
    const toY = (z) => (z + CFG.MAP_HALF) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this._mapStatic, 0, 0, size, size);
    // Simplify: wash out the detailed terrain so only faint water/roads show
    // through and the icons read clearly.
    ctx.fillStyle = 'rgba(42, 78, 48, 0.5)';
    ctx.fillRect(0, 0, size, size);

    let golden = null;
    // cows (white box + black spot) and sheep (fluffy cream circle)
    for (let i = 0; i < cows.length; i++) {
      const c = cows[i];
      if (c.kind === 'golden') { golden = c; continue; }
      const x = toX(c.x), y = toY(c.z);
      if (c.kind === 'cow') {
        ctx.fillStyle = '#f5f5f0';
        ctx.fillRect(x - 2, y - 1.5, 4, 3);
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(x - 1.6, y - 1, 1.6, 1.4);
      } else if (c.kind === 'sheep') {
        ctx.fillStyle = '#eae6da';
        ctx.beginPath();
        ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a3330';
        ctx.fillRect(x + 0.7, y - 0.8, 1.3, 1.6);
      }
      // chickens omitted to keep the map clean
    }

    // dogs (Astro): orange body with a black collie face patch
    for (let i = 0; i < dogs.length; i++) {
      const x = toX(dogs[i].x), y = toY(dogs[i].z);
      ctx.fillStyle = '#d98a3a';
      ctx.fillRect(x - 1.9, y - 1.3, 3.8, 2.6);
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(x - 1.9, y - 1.3, 1.5, 2.6);
    }

    // farmers (red body + dark hat brim)
    for (let i = 0; i < farmers.length; i++) {
      const x = toX(farmers[i].x), y = toY(farmers[i].z);
      ctx.fillStyle = '#ff5252';
      ctx.fillRect(x - 2, y - 1.4, 4, 3.4);
      ctx.fillStyle = '#7a1414';
      ctx.fillRect(x - 2.2, y - 2.2, 4.4, 1.1);
    }

    // golden cow — pulsing gold (the prize)
    if (golden) {
      const r = 3.4 + Math.sin(performance.now() * 0.008) * 0.7;
      ctx.fillStyle = '#ffd54f';
      ctx.shadowColor = '#ffd54f';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(toX(golden.x), toY(golden.z), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // player — green arrow (heading 0 = -Z = map up)
    if (player) {
      ctx.save();
      ctx.translate(toX(player.x), toY(player.z));
      ctx.rotate(player.heading || 0);
      ctx.fillStyle = '#7cfc9a';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.2, 4.2);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4.2, 4.2);
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
