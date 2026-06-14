// MOO-FO — shop cosmetics: UFO skins (shape + colour bundles) and beam styles.
// Each is unlocked with Cow Coins; simpler looks are cheap, flashy ones cost
// more. Ownership + current selection persisted to localStorage.
//
// `shape` ids must match the geometries js/models.js createUFO(opts) supports:
//   'saucer' | 'orb' | 'delta' | 'ringed'.

export const SKINS = [
  // shape + colour bundles — the "UFO" tab
  { id: 'classic',  name: 'Classic',     price: 0,    shape: 'saucer', hull: 0x9aa7b8, dome: 0x7ce8ff, light: 0x7cfc9a },
  { id: 'slate',    name: 'Slate',       price: 150,  shape: 'saucer', hull: 0x6b7686, dome: 0xafe9ff, light: 0x9ad8ff },
  { id: 'cherry',   name: 'Cherry',      price: 200,  shape: 'saucer', hull: 0xc0392b, dome: 0xffd1c7, light: 0xff7a5c },
  { id: 'mint',     name: 'Mint',        price: 250,  shape: 'saucer', hull: 0x3fae84, dome: 0xd6fff0, light: 0x8effc8 },
  { id: 'sunburst', name: 'Sunburst',    price: 350,  shape: 'saucer', hull: 0xe8a13a, dome: 0xfff0c4, light: 0xffd24a },
  { id: 'orb_blue', name: 'Blue Orb',    price: 450,  shape: 'orb',    hull: 0x3a6ea5, dome: 0xbfe6ff, light: 0x66c8ff },
  { id: 'orb_void', name: 'Void Orb',    price: 600,  shape: 'orb',    hull: 0x2b2440, dome: 0xb38bff, light: 0xb388ff },
  { id: 'delta_g',  name: 'Green Delta', price: 700,  shape: 'delta',  hull: 0x4c8c3a, dome: 0xd9ffce, light: 0x9cff7a },
  { id: 'delta_st', name: 'Stealth',     price: 900,  shape: 'delta',  hull: 0x23262b, dome: 0x8fd0ff, light: 0x6ad0ff },
  { id: 'ring_aqua',name: 'Aqua Ring',   price: 800,  shape: 'ringed', hull: 0x2f8f9e, dome: 0xc4fff7, light: 0x7cf2e6 },
  { id: 'ring_rose',name: 'Rose Ring',   price: 1000, shape: 'ringed', hull: 0xd05a8c, dome: 0xffe0ef, light: 0xff9ecb },
  { id: 'magma',    name: 'Magma',       price: 1200, shape: 'saucer', hull: 0x7a2218, dome: 0xffb070, light: 0xff5e2a },
  { id: 'ice',      name: 'Glacier',     price: 1200, shape: 'orb',    hull: 0xaecbe0, dome: 0xeafbff, light: 0xcfeeff },
  { id: 'neon',     name: 'Neon',        price: 1500, shape: 'delta',  hull: 0x1b1030, dome: 0xff5ff0, light: 0x39ff14 },
  { id: 'royal',    name: 'Royal',       price: 1800, shape: 'ringed', hull: 0x3b2a8c, dome: 0xe6d8ff, light: 0xc9a6ff },
  { id: 'gold',     name: 'Golden Disc', price: 2500, shape: 'saucer', hull: 0xe8b53a, dome: 0xfff4cf, light: 0xffe14a },
];

export const BEAMS = [
  { id: 'emerald',  name: 'Emerald',  price: 0,    color: 0x9af7b0 },
  { id: 'sky',      name: 'Sky',      price: 150,  color: 0x8fd8ff },
  { id: 'amber',    name: 'Amber',    price: 200,  color: 0xffd24a },
  { id: 'rose',     name: 'Rose',     price: 300,  color: 0xff9ecb },
  { id: 'violet',   name: 'Violet',   price: 400,  color: 0xb388ff },
  { id: 'crimson',  name: 'Crimson',  price: 500,  color: 0xff6b5a },
  { id: 'ice',      name: 'Ice',      price: 700,  color: 0xcfeeff },
  { id: 'toxic',    name: 'Toxic',    price: 900,  color: 0x9dff3a },
  { id: 'gold',     name: 'Gold',     price: 1200, color: 0xffe14a },
  { id: 'rainbow',  name: 'Rainbow',  price: 1800, color: 0xffffff, rainbow: true },
];

const KEY = 'moofo-cosmetics-v1';

export class Cosmetics {
  constructor() {
    this._owned = new Set(['classic', 'emerald']);   // starters
    this._skin = 'classic';
    this._beam = 'emerald';
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d) {
        if (Array.isArray(d.owned)) { this._owned = new Set(d.owned); this._owned.add('classic'); this._owned.add('emerald'); }
        if (d.skin && this._owned.has(d.skin)) this._skin = d.skin;
        if (d.beam && this._owned.has(d.beam)) this._beam = d.beam;
      }
    } catch (_) { /* fresh */ }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ owned: [...this._owned], skin: this._skin, beam: this._beam }));
    } catch (_) { /* blocked */ }
  }

  _find(id) { return SKINS.find((s) => s.id === id) || BEAMS.find((b) => b.id === id) || null; }

  owns(id) { return this._owned.has(id); }
  priceOf(id) { const it = this._find(id); return it ? it.price : 0; }

  /** Unlock an item, spending from `wallet`. Returns true on success. */
  buy(id, wallet) {
    if (this.owns(id)) return false;
    const it = this._find(id);
    if (!it) return false;
    if (!wallet.spend(it.price)) return false;
    this._owned.add(id);
    this._save();
    return true;
  }

  isSkin(id) { return SKINS.some((s) => s.id === id); }
  isBeam(id) { return BEAMS.some((b) => b.id === id); }
  isSelectedSkin(id) { return this._skin === id; }
  isSelectedBeam(id) { return this._beam === id; }

  /** Equip an owned item (skin or beam). Returns true if equipped. */
  select(id) {
    if (!this.owns(id)) return false;
    if (this.isSkin(id)) this._skin = id;
    else if (this.isBeam(id)) this._beam = id;
    else return false;
    this._save();
    return true;
  }

  selectedSkin() { return SKINS.find((s) => s.id === this._skin) || SKINS[0]; }
  selectedBeam() { return BEAMS.find((b) => b.id === this._beam) || BEAMS[0]; }
}
