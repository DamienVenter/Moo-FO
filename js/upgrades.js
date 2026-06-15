// MOO-FO — UFO upgrades. Five tracks, each bought up in tiers with Cow Coins.
//
// A fresh player starts well below the game's tuned baseline (level 0 multiplier)
// and can upgrade to ~3× it. Each track has its OWN starting weakness:
//   - speed starts at 0.60 (the ship is sluggish but not crawling),
//   - hull starts super weak (0.30 → ~one solid hit and you're down),
//   - the rest start at 0.30 (70% weaker than baseline).
// Costs rise 200 → 1500. Persisted to localStorage.

export const TRACKS = ['speed', 'beam', 'warpSpeed', 'warpStrength', 'hull'];

export const TRACK_INFO = {
  speed:        { name: 'UFO Speed',     blurb: 'Fly faster and turn quicker.',         icon: '🚀' },
  beam:         { name: 'Tractor Beam',  blurb: 'Wider, stronger abduction beam.',       icon: '🔦' },
  warpSpeed:    { name: 'Warp Speed',    blurb: 'Go faster when you warp.',               icon: '✨' },
  warpStrength: { name: 'Warp Capacity', blurb: 'Warp for longer before it drains.',      icon: '🔋' },
  hull:         { name: 'UFO Hull',      blurb: 'Tougher hull — survive more hits.',      icon: '🛡️' },
};

// Cost of each successive upgrade: 200, 300, ... 1500 (14 tiers).
export const UPGRADE_COSTS = Array.from({ length: 14 }, (_, i) => 200 + i * 100);
export const MAX_LEVEL = UPGRADE_COSTS.length;   // 14

// Per-track effectiveness range: level 0 → level MAX. 1.0 is the tuned baseline.
// Starting power was doubled (beam width+strength, warp speed and fly speed) so
// the early game is less punishing.
const RANGE = {
  speed:        { min: 1.20, max: 3.00 },   // starts above baseline — nimble from the off
  beam:         { min: 0.60, max: 3.00 },   // double the old 0.30 floor (width + strength)
  warpSpeed:    { min: 0.60, max: 3.00 },   // double the old 0.30 floor
  warpStrength: { min: 0.30, max: 3.00 },
  hull:         { min: 0.30, max: 3.00 },   // super weak start (~9 HP) → tanky at max
};
const DEFAULT_RANGE = { min: 0.30, max: 3.00 };
const KEY = 'moofo-upgrades-v1';

export class Upgrades {
  constructor() {
    this._lvl = { speed: 0, beam: 0, warpSpeed: 0, warpStrength: 0, hull: 0 };
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d) for (const t of TRACKS) if (Number.isFinite(d[t])) this._lvl[t] = Math.max(0, Math.min(MAX_LEVEL, d[t]));
    } catch (_) { /* fresh */ }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this._lvl)); } catch (_) { /* blocked */ }
  }

  level(track) { return this._lvl[track] || 0; }
  maxed(track) { return this.level(track) >= MAX_LEVEL; }
  progress(track) { return this.level(track) / MAX_LEVEL; }   // 0..1

  /** Coin cost of the NEXT tier, or null when maxed. */
  cost(track) {
    const lvl = this.level(track);
    return lvl >= MAX_LEVEL ? null : UPGRADE_COSTS[lvl];
  }

  /** Effectiveness multiplier for a track: range.min (level 0) → range.max (max). */
  mult(track) {
    const r = RANGE[track] || DEFAULT_RANGE;
    return r.min + (r.max - r.min) * this.progress(track);
  }

  /** Buy the next tier, spending from `wallet`. Returns true on success. */
  buy(track, wallet) {
    const c = this.cost(track);
    if (c == null) return false;
    if (!wallet.spend(c)) return false;
    this._lvl[track] = this.level(track) + 1;
    this._save();
    return true;
  }
}
