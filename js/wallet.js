// MOO-FO — Cow Coins wallet. Persistent gold-coin balance earned from campaign
// stars; spent later in the shop/upgrades. Tiny, synchronous, localStorage-backed.

const KEY = 'moofo-coins';

export class Wallet {
  constructor() {
    this._n = 0;
    try { this._n = Math.max(0, Math.floor(Number(localStorage.getItem(KEY)) || 0)); } catch (_) { /* blocked */ }
  }

  getBalance() { return this._n; }

  /** Add coins (rounded, non-negative). Returns the new balance. */
  add(n) {
    this._n += Math.max(0, Math.round(n));
    this._save();
    return this._n;
  }

  /** Spend coins if affordable. Returns true on success. */
  spend(n) {
    n = Math.round(n);
    if (n < 0 || n > this._n) return false;
    this._n -= n;
    this._save();
    return true;
  }

  _save() {
    try { localStorage.setItem(KEY, String(this._n)); } catch (_) { /* full/blocked */ }
  }
}
