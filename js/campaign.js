// MOO-FO — Campaign: 15 missions on the farm map, each a 90-second run.
//
// Stars (per level, persisted):
//   ★1 — reach the level's score target (also what "completes" the level)
//   ★2, ★3 — two bonus objectives that change every level (see `missions`)
// Coins (Cow Coins) are awarded the FIRST time each star slot is earned:
//   ★1 = 50, ★2 = 100, ★3 = 150.
// The next world (Beach) unlocks once you've banked BEACH_STARS of the 45.

export const STAR_COINS = [50, 100, 150];
export const BEACH_STARS = 35;          // of 45 (15 levels × 3)

const KEY = 'moofo-campaign-v2';
const COUNT = 15;

// Two bonus objectives per level (★2, ★3). Objective specs are evaluated by
// js/missions.js. Difficulty ramps across the campaign.
const MISSIONS = [
  [{ t: 'chickens', n: 2 }, { t: 'nohit' }],                         // 1
  [{ t: 'sheep', n: 2 }, { t: 'cows', variant: 'brown', n: 3 }],     // 2
  [{ t: 'nohit' }, { t: 'chickens', n: 3 }],                         // 3
  [{ t: 'cows', variant: 'holstein', n: 5 }, { t: 'golden' }],       // 4
  [{ t: 'sheep', n: 3 }, { t: 'combo', n: 3 }],                      // 5
  [{ t: 'nohit' }, { t: 'cows', variant: 'brown', n: 4 }],           // 6
  [{ t: 'chickens', n: 4 }, { t: 'golden' }],                        // 7
  [{ t: 'sheep', n: 4 }, { t: 'nowarp' }],                           // 8
  [{ t: 'cows', variant: 'holstein', n: 8 }, { t: 'nohit' }],        // 9
  [{ t: 'combo', n: 4 }, { t: 'sheep', n: 4 }],                      // 10
  [{ t: 'golden' }, { t: 'chickens', n: 5 }],                        // 11
  [{ t: 'nohit' }, { t: 'cows', variant: 'brown', n: 6 }],           // 12
  [{ t: 'sheep', n: 5 }, { t: 'combo', n: 4 }],                      // 13
  [{ t: 'nowarp' }, { t: 'golden' }],                                // 14
  [{ t: 'nohit' }, { t: 'sheep', n: 6 }],                            // 15
];

function buildLevels() {
  const levels = [];
  for (let i = 1; i <= COUNT; i++) {
    const t = (i - 1) / (COUNT - 1);                          // 0 .. 1
    const target = Math.round((1000 + t * 7000) / 250) * 250; // 1000 → 8000
    levels.push({ index: i, target, time: 90, missions: MISSIONS[i - 1] });
  }
  return levels;
}

export class Campaign {
  constructor() {
    this.levels = buildLevels();
    this.BEACH_STARS = BEACH_STARS;
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
    } catch (_) { /* full/blocked */ }
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

  get totalStars() {
    let s = 0;
    for (let i = 1; i <= COUNT; i++) s += this.starsFor(i);
    return s;
  }

  get beachUnlocked() { return this.totalStars >= BEACH_STARS; }

  /**
   * Record a finished run. `bonusMet` = number of the two bonus objectives met
   * (0..2). Stars this run = passed ? 1 + bonusMet : 0. Coins are awarded only
   * for star slots earned for the FIRST time. Returns the data the result
   * screen needs.
   */
  recordRun(i, score, bonusMet) {
    const target = this.levels[i - 1].target;
    const passed = score >= target;
    const stars = passed ? 1 + Math.max(0, Math.min(2, bonusMet)) : 0;
    const prevStars = this._stars[i] || 0;
    const bestStars = Math.max(prevStars, stars);

    let coinsEarned = 0;
    for (let k = prevStars; k < bestStars; k++) coinsEarned += STAR_COINS[k] || 0;

    const prevScore = this._best[i] || 0;
    const isNewBest = score > prevScore;
    if (isNewBest) this._best[i] = score;
    if (bestStars > prevStars) this._stars[i] = bestStars;
    this._save();

    return { passed, stars, bestStars, prevStars, coinsEarned, isNewBest };
  }
}
