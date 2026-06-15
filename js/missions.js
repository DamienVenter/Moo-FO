// MOO-FO — campaign mission objectives. A run-time tracker counts what the
// player does; objective specs (from campaign.js level.missions) are turned
// into human labels and evaluated against the tracker for the bonus stars.

export function labelFor(spec) {
  switch (spec.t) {
    case 'nohit': return "Don't get hit by a farmer";
    case 'sheep': return `Abduct ${spec.n} sheep`;
    case 'chickens': return `Abduct ${spec.n} chickens`;
    case 'pigs': return `Abduct ${spec.n} pigs`;
    case 'horses': return `Abduct ${spec.n} horses`;
    case 'cows':
      return spec.variant === 'brown'
        ? `Abduct ${spec.n} brown cows`
        : `Abduct ${spec.n} white cows`;
    case 'golden': return 'Abduct the golden cow';
    case 'total': return `Abduct ${spec.n} animals`;
    case 'variety': return 'Abduct a cow, sheep, chicken, pig & horse';
    case 'combo': return `Reach a ×${spec.n} combo`;
    case 'nowarp': return 'Finish without warping';
    default: return 'Bonus objective';
  }
}

export class MissionTracker {
  constructor() { this.reset(); }

  reset() {
    this.hits = 0;
    this.sheep = 0;
    this.chickens = 0;
    this.pigs = 0;
    this.horses = 0;
    this.cows = { holstein: 0, brown: 0 };
    this.golden = 0;
    this.total = 0;
    this.maxCombo = 0;
    this.warpUsed = false;
  }

  onAbduct(kind, variant) {
    this.total++;
    if (kind === 'sheep') this.sheep++;
    else if (kind === 'chicken') this.chickens++;
    else if (kind === 'pig') this.pigs++;
    else if (kind === 'horse') this.horses++;
    else if (kind === 'golden') this.golden++;
    else if (kind === 'cow') {
      if (variant === 'brown') this.cows.brown++;
      else this.cows.holstein++;   // holstein = "white" cows
    }
  }

  onHit() { this.hits++; }
  onCombo(mult) { if (mult > this.maxCombo) this.maxCombo = mult; }
  onWarp() { this.warpUsed = true; }

  /** Is a single objective spec satisfied right now? */
  met(spec) {
    switch (spec.t) {
      case 'nohit': return this.hits === 0;
      case 'sheep': return this.sheep >= spec.n;
      case 'chickens': return this.chickens >= spec.n;
      case 'pigs': return this.pigs >= spec.n;
      case 'horses': return this.horses >= spec.n;
      case 'cows': return (this.cows[spec.variant === 'brown' ? 'brown' : 'holstein'] || 0) >= spec.n;
      case 'golden': return this.golden >= 1;
      case 'total': return this.total >= spec.n;
      case 'variety':
        return (this.cows.holstein + this.cows.brown) > 0 && this.sheep > 0 &&
               this.chickens > 0 && this.pigs > 0 && this.horses > 0;
      case 'combo': return this.maxCombo >= spec.n;
      case 'nowarp': return !this.warpUsed;
      default: return false;
    }
  }
}

/**
 * Build the 3 objective rows for a level given the live score + tracker.
 * Row 1 is always the score goal (= ★1 / level completion); rows 2 & 3 are the
 * level's bonus objectives. Returns { objectives:[{label,done}×3], bonusMet,
 * scoreDone }.
 */
export function evaluateLevel(level, score, tracker) {
  const scoreDone = score >= level.target;
  const objectives = [
    { label: `Reach ${level.target.toLocaleString('en-US')} points`, done: scoreDone },
  ];
  let bonusMet = 0;
  for (const spec of level.missions) {
    const done = tracker.met(spec);
    if (done) bonusMet++;
    objectives.push({ label: labelFor(spec), done });
  }
  return { objectives, bonusMet, scoreDone };
}
