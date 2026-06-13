// MOO-FO — Campaign: 20 missions on the same farm map. Each level asks for a
// score `target` within a `time` limit; reaching the target ends the run early
// (mission complete). Progress (best score + stars per level, and therefore
// which levels are unlocked) is persisted to localStorage.
//
// Difficulty ramps gently: level 1 = 1000 pts in 2:00, level 20 = 10000 pts,
// with a little extra time on the later levels so it never gets unfair.

const KEY = 'moofo-campaign-v1';
const COUNT = 20;

function buildLevels() {
  const levels = [];
  for (let i = 1; i <= COUNT; i++) {
    const t = (i - 1) / (COUNT - 1);                       // 0 .. 1
    const target = Math.round((1000 + t * 9000) / 250) * 250; // 1000 → 10000, in 250s
    const time = 90;                                       // every level is a 90s rush
    levels.push({ index: i, target, time });
  }
  return levels;
}

export class Campaign {
  constructor() {
    this.levels = buildLevels();
    this._best = {};    // index -> best score
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && typeof d === 'object') this._best = d.best || {};
    } catch (_) { /* corrupted — start fresh */ }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ best: this._best }));
    } catch (_) { /* storage full / blocked */ }
  }

  /** Levels 1..unlockedCount are playable. = (highest consecutive completed) + 1. */
  get unlockedCount() {
    let done = 0;
    for (let i = 1; i <= COUNT; i++) {
      if (this.isCompleted(i)) done = i; else break;
    }
    return Math.min(COUNT, done + 1);
  }

  isCompleted(i) { return (this._best[i] || 0) >= this.levels[i - 1].target; }
  bestScore(i) { return this._best[i] || 0; }

  // Campaign levels are pass/fail — no stars. Kept as 0-stubs so any older UI
  // reference can't throw.
  starsFor() { return 0; }
  starCount() { return 0; }

  /** Record a completed level; returns true if this beat the stored best. */
  complete(i, score) {
    const prev = this._best[i] || 0;
    const isNew = score > prev;
    if (isNew) this._best[i] = score;
    this._save();
    return isNew;
  }
}
