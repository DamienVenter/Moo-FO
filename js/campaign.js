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
    const time = 120 + (i - 1) * 3;                        // 120s → 177s
    levels.push({ index: i, target, time });
  }
  return levels;
}

export class Campaign {
  constructor() {
    this.levels = buildLevels();
    this._best = {};    // index -> best score
    this._stars = {};   // index -> best star count (0..3)
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && typeof d === 'object') {
        this._best = d.best || {};
        this._stars = d.stars || {};
      }
    } catch (_) { /* corrupted — start fresh */ }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ best: this._best, stars: this._stars }));
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
  starsFor(i) { return this._stars[i] || 0; }

  /** Stars for a winning run: 1 = met the goal, 2 = +25%, 3 = +60%. */
  starCount(score, target) {
    if (score < target) return 0;
    if (score >= target * 1.6) return 3;
    if (score >= target * 1.25) return 2;
    return 1;
  }

  /** Record a completed level; returns true if this beat the stored best. */
  complete(i, score, stars) {
    const prev = this._best[i] || 0;
    const isNew = score > prev;
    if (isNew) this._best[i] = score;
    if ((stars || 0) > (this._stars[i] || 0)) this._stars[i] = stars || 0;
    this._save();
    return isNew;
  }

  /** Total stars earned across the campaign (for a header/summary). */
  get totalStars() {
    let s = 0;
    for (let i = 1; i <= COUNT; i++) s += this.starsFor(i);
    return s;
  }
}
