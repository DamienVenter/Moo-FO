// MOO-FO — PER-MODEL UFO upgrades. Each of the 15 UFO models has its OWN
// upgrade levels across five tracks, and its own CAP (later models cap higher).
// A model's five skins share its upgrades. When you unlock a new model it
// starts at ~30% of the PREVIOUS model's cap, then climbs to its own (higher)
// ceiling. Multipliers use a fixed per-track floor + per-level step, so a
// higher cap reaches a higher effective stat. Persisted to localStorage.

import { MODELS } from './cosmetics.js';

export const TRACKS = ['speed', 'beam', 'warpSpeed', 'warpStrength', 'hull'];

// name + blurb + a colour and icon id (the UI draws a coloured SVG glyph).
export const TRACK_INFO = {
  speed:        { name: 'UFO Speed',     blurb: 'Fly faster and turn quicker.',     color: '#5ad0ff', icon: 'speed' },
  beam:         { name: 'Tractor Beam',  blurb: 'Wider, stronger abduction beam.',  color: '#7cfc9a', icon: 'beam' },
  warpSpeed:    { name: 'Warp Speed',    blurb: 'Go faster when you warp.',          color: '#c08bff', icon: 'warp' },
  warpStrength: { name: 'Warp Capacity', blurb: 'Warp for longer before it drains.', color: '#ffd24a', icon: 'battery' },
  hull:         { name: 'UFO Hull',      blurb: 'Tougher hull — survive more hits.', color: '#ff8a6e', icon: 'shield' },
};

// level-0 floor and per-level gain per track (1.0 = the tuned baseline).
const FLOOR = { speed: 0.84, beam: 0.60, warpSpeed: 0.60, warpStrength: 0.30, hull: 0.30 };
const STEP  = { speed: 0.12, beam: 0.14, warpSpeed: 0.14, warpStrength: 0.16, hull: 0.16 };

// Cost of each successive upgrade tier (level n → n+1): 200 … 1900.
export const MAX_CAP = MODELS.reduce((m, x) => Math.max(m, x.cap), 4);
export const UPGRADE_COSTS = Array.from({ length: MAX_CAP }, (_, i) => 200 + i * 100);

// Each model has the SAME number of purchasable upgrades (STEPS). A model of
// tier i STARTS at level i (already i levels in — it never restarts at zero)
// and CAPS at i + STEPS. So every next model both starts and caps one level
// higher than the one before, while keeping an identical upgrade count.
const STEPS = 6;
const KEY = 'moofo-upgrades-v3';
const byId = Object.fromEntries(MODELS.map((m) => [m.id, m]));
const startOf = (m) => (m ? m.tier : 0);
const capOf = (m) => (m ? m.tier + STEPS : STEPS);

export class Upgrades {
  constructor() {
    this._lvl = {};                  // modelId -> { track: level }
    this._active = MODELS[0].id;
    this._loadout = null;            // free-play per-track override (≤ purchased)
    this._load();
    this._ensure(this._active);
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.lvl) this._lvl = d.lvl;
      if (d && byId[d.active]) this._active = d.active;
    } catch (_) { /* fresh */ }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify({ lvl: this._lvl, active: this._active })); } catch (_) { /* blocked */ }
  }

  // Seed a model's levels to its STARTING level (= its tier) the first time
  // it's touched — it's already `tier` levels in, never restarts at zero.
  _ensure(id) {
    const m = byId[id];
    if (!m) return;
    if (this._lvl[id]) return;
    const start = startOf(m);
    const lv = {};
    for (const t of TRACKS) lv[t] = start;
    this._lvl[id] = lv;
    this._save();
  }

  setActiveModel(id) { if (byId[id]) { this._active = id; this._ensure(id); this._save(); } }
  activeModel() { return this._active; }
  modelName(id = this._active) { return byId[id] ? byId[id].name : ''; }

  startLevel(id = this._active) { return startOf(byId[id]); }
  cap(id = this._active) { return capOf(byId[id]); }
  level(track, id = this._active) { this._ensure(id); return (this._lvl[id] && this._lvl[id][track]) || 0; }
  maxed(track, id = this._active) { return this.level(track, id) >= this.cap(id); }
  progress(track, id = this._active) { const c = this.cap(id); return c ? this.level(track, id) / c : 0; }

  /** Coin cost of the NEXT upgrade for a track, or null when capped. Cost is
   *  by how many you've BOUGHT on this model (level − start), not the level. */
  cost(track, id = this._active) {
    const lv = this.level(track, id);
    if (lv >= this.cap(id)) return null;
    const bought = Math.max(0, lv - startOf(byId[id]));
    return UPGRADE_COSTS[Math.min(bought, UPGRADE_COSTS.length - 1)];
  }

  // Free-play LOADOUT override: temporarily run the active model's tracks at
  // chosen levels (always clamped to what's purchased). null = use purchased.
  setLoadout(levels) { this._loadout = levels ? { ...levels } : null; }
  clearLoadout() { this._loadout = null; }
  /** Effective (in-play) level for a track on the active model. */
  _eff(track) {
    const owned = this.level(track);
    if (!this._loadout || typeof this._loadout[track] !== 'number') return owned;
    return Math.max(0, Math.min(owned, Math.round(this._loadout[track])));
  }

  /** Effectiveness multiplier for a track on the ACTIVE model (loadout-aware). */
  mult(track) {
    return (FLOOR[track] || 0.3) + (STEP[track] || 0.13) * this._eff(track);
  }

  /** Hull is measured in SHOTS the ship can take: 2 at level 0, +~1 per level
   *  (so the cheapest model survives 2 hits, and tougher models far more). */
  shots() {
    return 2 + Math.round(this._eff('hull') * 0.85);
  }

  /** Buy the next tier for the active (or given) model. Returns true on success. */
  buy(track, wallet, id = this._active) {
    const c = this.cost(track, id);
    if (c == null) return false;
    if (!wallet.spend(c)) return false;
    this._ensure(id);
    this._lvl[id][track] += 1;
    this._save();
    return true;
  }
}
