// MOO-FO — daily missions. Three challenges (EASY / MEDIUM / HARD) that refresh
// on a global 12-hour cycle, paying 100 / 200 / 300 Cow Coins on completion.
// Progress accumulates across runs within the active window and is persisted.

const KEY = 'moofo-daily-v1';
export const PERIOD_MS = 12 * 60 * 60 * 1000;   // 12 hours

const TIERS = [
  { key: 'easy',   label: 'EASY',   reward: 100, scale: 1.0 },
  { key: 'medium', label: 'MEDIUM', reward: 200, scale: 2.2 },
  { key: 'hard',   label: 'HARD',   reward: 300, scale: 4.0 },
];

// Mission archetypes. `base` is the EASY goal; medium/hard scale it up.
const POOL = [
  { t: 'cows',     base: 8,    kind: 'count', label: (n) => `Abduct ${n} cows` },
  { t: 'sheep',    base: 5,    kind: 'count', label: (n) => `Abduct ${n} sheep` },
  { t: 'chickens', base: 6,    kind: 'count', label: (n) => `Abduct ${n} chickens` },
  { t: 'pigs',     base: 4,    kind: 'count', label: (n) => `Abduct ${n} pigs` },
  { t: 'horses',   base: 2,    kind: 'count', label: (n) => `Abduct ${n} horses` },
  { t: 'any',      base: 15,   kind: 'count', label: (n) => `Abduct ${n} animals` },
  { t: 'golden',   base: 1,    kind: 'count', label: (n) => `Abduct ${n} golden cow${n > 1 ? 's' : ''}` },
  { t: 'score',    base: 4000, kind: 'sum',   label: (n) => `Earn ${n.toLocaleString('en-US')} points` },
  { t: 'combo',    base: 4,    kind: 'max',   label: (n) => `Reach a ×${n} combo` },
];

// Deterministic 3 distinct archetypes for a period seed.
function pickThree(seed) {
  const idx = [];
  let s = (seed * 2654435761) >>> 0;
  const order = POOL.map((_, i) => i);
  // Fisher–Yates with the seeded PRNG.
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  for (let i = 0; i < 3; i++) idx.push(order[i]);
  return idx.map((i) => POOL[i]);
}

function goalFor(arch, tier) {
  if (arch.kind === 'max') return Math.round(arch.base + (tier.scale - 1));      // combo: +1/+2/+3-ish
  if (arch.t === 'score') return Math.round(arch.base * tier.scale / 500) * 500; // round to 500
  return Math.max(1, Math.round(arch.base * tier.scale));
}

export class DailyMissions {
  constructor(wallet) {
    this.wallet = wallet;
    this.periodStart = 0;
    this.missions = [];
    this._load();
    this.refreshIfNeeded();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.missions)) { this.periodStart = d.periodStart || 0; this.missions = d.missions; }
    } catch (_) { /* fresh */ }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify({ periodStart: this.periodStart, missions: this.missions })); } catch (_) { /* blocked */ }
  }

  /** Regenerate the set when the global 12h window rolls over. */
  refreshIfNeeded() {
    const aligned = Math.floor(Date.now() / PERIOD_MS) * PERIOD_MS;
    if (this.periodStart === aligned && this.missions.length === 3) return false;
    this.periodStart = aligned;
    const picks = pickThree(aligned / PERIOD_MS);
    this.missions = TIERS.map((tier, i) => {
      const arch = picks[i];
      const n = goalFor(arch, tier);
      return { tier: tier.key, tierLabel: tier.label, reward: tier.reward, t: arch.t, kind: arch.kind, n, label: arch.label(n), prog: 0, done: false };
    });
    this._save();
    return true;
  }

  timeLeftMs() { return Math.max(0, PERIOD_MS - (Date.now() - this.periodStart)); }

  /** "11h 59m" / "8m 3s" style remaining-time string. */
  timeLeftLabel() {
    let s = Math.floor(this.timeLeftMs() / 1000);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // ---- progress recording (returns array of missions completed this call) ----
  _award(m) { if (this.wallet) this.wallet.add(m.reward); }

  onAbduct(kind) {
    const map = { cow: 'cows', golden: 'golden', sheep: 'sheep', chicken: 'chickens', pig: 'pigs', horse: 'horses' };
    const done = [];
    for (const m of this.missions) {
      if (m.done) continue;
      if (m.t === 'any' || m.t === map[kind]) {
        m.prog = Math.min(m.n, m.prog + 1);
        if (m.prog >= m.n) { m.done = true; this._award(m); done.push(m); }
      }
    }
    this._save();
    return done;
  }

  onScore(points) {
    const done = [];
    for (const m of this.missions) {
      if (m.done || m.t !== 'score') continue;
      m.prog = Math.min(m.n, m.prog + points);
      if (m.prog >= m.n) { m.done = true; this._award(m); done.push(m); }
    }
    if (done.length) this._save();
    return done;
  }

  onCombo(mult) {
    const done = [];
    for (const m of this.missions) {
      if (m.done || m.t !== 'combo') continue;
      if (mult > m.prog) m.prog = Math.min(m.n, mult);
      if (m.prog >= m.n) { m.done = true; this._award(m); done.push(m); }
    }
    if (done.length) this._save();
    return done;
  }

  /** Count of missions completed this window. */
  completedCount() { return this.missions.filter((m) => m.done).length; }
}
