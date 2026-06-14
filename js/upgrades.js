// MOO-FO — UFO upgrades. Four tracks, each bought up in tiers with Cow Coins.
//
// A fresh player starts 70% weaker than the game's tuned baseline (mult 0.30 of
// the CFG values) and can upgrade to ~3× the baseline. Costs rise 200 → 1500.
// Persisted to localStorage.

export const TRACKS = ['speed', 'beam', 'warpSpeed', 'warpStrength'];

export const TRACK_INFO = {
  speed:        { name: 'UFO Speed',     blurb: 'Fly faster and turn quicker.' },
  beam:         { name: 'Tractor Beam',  blurb: 'Wider, stronger abduction beam.' },
  warpSpeed:    { name: 'Warp Speed',    blurb: 'Go faster when you warp.' },
  warpStrength: { name: 'Warp Capacity', blurb: 'Warp for longer before it drains.' },
};

// Cost of each successive upgrade: 200, 300, ... 1500 (14 tiers).
export const UPGRADE_COSTS = Array.from({ length: 14 }, (_, i) => 200 + i * 100);
export const MAX_LEVEL = UPGRADE_COSTS.length;   // 14

const MIN_MULT = 0.30;   // level 0 — 70% weaker than baseline
const MAX_MULT = 3.00;   // max level — ~3× baseline
const KEY = 'moofo-upgrades-v1';

export class Upgrades {
  constructor() {
    this._lvl = { speed: 0, beam: 0, warpSpeed: 0, warpStrength: 0 };
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

  /** Effectiveness multiplier for a track: 0.30 (level 0) → 3.00 (max). */
  mult(track) {
    return MIN_MULT + (MAX_MULT - MIN_MULT) * this.progress(track);
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
