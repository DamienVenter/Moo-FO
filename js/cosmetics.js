// MOO-FO — shop cosmetics: UFO skins (shape + colour bundles) and beam styles.
// Each is unlocked with Cow Coins; simpler looks are cheap, flashy ones cost
// more. Ownership + current selection persisted to localStorage.
//
// `shape` ids must match the geometries js/models.js createUFO(opts) supports:
//   'saucer' | 'orb' | 'delta' | 'ringed'.

export const SKINS = [
  // shape + colour bundles — the "UFO" tab
  { id: 'classic',     name: 'Classic',     price: 0,    shape: 'saucer', hull: 0x9aa7b8, dome: 0x7ce8ff, light: 0x7cfc9a },

  // — saucers —
  { id: 'slate',       name: 'Slate',       price: 150,  shape: 'saucer', hull: 0x6b7686, dome: 0xafe9ff, light: 0x9ad8ff },
  { id: 'cherry',      name: 'Cherry',      price: 200,  shape: 'saucer', hull: 0xc0392b, dome: 0xffd1c7, light: 0xff7a5c },
  { id: 'mint',        name: 'Mint',        price: 250,  shape: 'saucer', hull: 0x3fae84, dome: 0xd6fff0, light: 0x8effc8 },
  { id: 'sunburst',    name: 'Sunburst',    price: 350,  shape: 'saucer', hull: 0xe8a13a, dome: 0xfff0c4, light: 0xffd24a },
  { id: 'bubblegum',   name: 'Bubblegum',   price: 380,  shape: 'saucer', hull: 0xff8fc8, dome: 0xffe3f3, light: 0xff5fb0 },
  { id: 'toxic_disc',  name: 'Toxic Saucer',price: 520,  shape: 'saucer', hull: 0x3a4a12, dome: 0xeaffb0, light: 0x9dff3a },
  { id: 'vaporwave',   name: 'Vaporwave',   price: 700,  shape: 'saucer', hull: 0x2a1a4a, dome: 0xff9ee6, light: 0x6ff5ff },
  { id: 'coral_reef',  name: 'Coral Reef',  price: 760,  shape: 'saucer', hull: 0xff6f59, dome: 0xd8fff5, light: 0x4fe0c8 },
  { id: 'magma',       name: 'Magma',       price: 1200, shape: 'saucer', hull: 0x7a2218, dome: 0xffb070, light: 0xff5e2a },
  { id: 'inferno',     name: 'Inferno',     price: 1400, shape: 'saucer', hull: 0x5a0e08, dome: 0xffd07a, light: 0xff3a14 },
  { id: 'gold',        name: 'Golden Disc', price: 2500, shape: 'saucer', hull: 0xe8b53a, dome: 0xfff4cf, light: 0xffe14a },
  { id: 'chrome_dream',name: 'Chrome Dream',price: 2800, shape: 'saucer', hull: 0xdfe6ef, dome: 0xffffff, light: 0xbfeaff },

  // — orbs —
  { id: 'orb_blue',    name: 'Blue Orb',    price: 450,  shape: 'orb',    hull: 0x3a6ea5, dome: 0xbfe6ff, light: 0x66c8ff },
  { id: 'orb_void',    name: 'Void Orb',    price: 600,  shape: 'orb',    hull: 0x2b2440, dome: 0xb38bff, light: 0xb388ff },
  { id: 'cosmic_egg',  name: 'Cosmic Egg',  price: 820,  shape: 'orb',    hull: 0x1a1240, dome: 0xc7a6ff, light: 0x8e7bff },
  { id: 'lava_lamp',   name: 'Lava Lamp',   price: 980,  shape: 'orb',    hull: 0x5a124a, dome: 0xffc56b, light: 0xff5fa0 },
  { id: 'frostbite',   name: 'Frostbite',   price: 1100, shape: 'orb',    hull: 0x9fc7e8, dome: 0xeafbff, light: 0x6fd6ff },
  { id: 'ice',         name: 'Glacier',     price: 1200, shape: 'orb',    hull: 0xaecbe0, dome: 0xeafbff, light: 0xcfeeff },
  { id: 'galaxy',      name: 'Galaxy',      price: 1700, shape: 'orb',    hull: 0x120a2e, dome: 0x8fb4ff, light: 0xd07aff },
  { id: 'obsidian',    name: 'Obsidian',    price: 1900, shape: 'orb',    hull: 0x101015, dome: 0x6a7280, light: 0x9ad8ff },
  { id: 'sunspot',     name: 'Sunspot',     price: 2200, shape: 'orb',    hull: 0xffb000, dome: 0xfff6d0, light: 0xffdf4a },

  // — deltas —
  { id: 'delta_g',     name: 'Green Delta', price: 700,  shape: 'delta',  hull: 0x4c8c3a, dome: 0xd9ffce, light: 0x9cff7a },
  { id: 'delta_st',    name: 'Stealth',     price: 900,  shape: 'delta',  hull: 0x23262b, dome: 0x8fd0ff, light: 0x6ad0ff },
  { id: 'phantom_wing',name: 'Phantom Wing',price: 1050, shape: 'delta',  hull: 0x1a1d24, dome: 0xc0c8d4, light: 0x7c9eff },
  { id: 'neon',        name: 'Neon',        price: 1500, shape: 'delta',  hull: 0x1b1030, dome: 0xff5ff0, light: 0x39ff14 },
  { id: 'neon_cyan',   name: 'Neon Cyan',   price: 1500, shape: 'delta',  hull: 0x081a22, dome: 0x39fff0, light: 0x00f0ff },
  { id: 'neon_amber',  name: 'Neon Amber',  price: 1550, shape: 'delta',  hull: 0x2a1600, dome: 0xffd25f, light: 0xffa600 },
  { id: 'thunderbird', name: 'Thunderbird', price: 1850, shape: 'delta',  hull: 0x3a2a08, dome: 0xfff0a0, light: 0xffe14a },
  { id: 'nightraven',  name: 'Nightraven',  price: 2100, shape: 'delta',  hull: 0x141622, dome: 0x6a5fff, light: 0x9a7bff },

  // — ringed —
  { id: 'ring_aqua',   name: 'Aqua Ring',   price: 800,  shape: 'ringed', hull: 0x2f8f9e, dome: 0xc4fff7, light: 0x7cf2e6 },
  { id: 'ring_rose',   name: 'Rose Ring',   price: 1000, shape: 'ringed', hull: 0xd05a8c, dome: 0xffe0ef, light: 0xff9ecb },
  { id: 'saturn_v',    name: 'Saturn V',    price: 1300, shape: 'ringed', hull: 0xc8a25a, dome: 0xfff0cf, light: 0xffd88f },
  { id: 'royal',       name: 'Royal',       price: 1800, shape: 'ringed', hull: 0x3b2a8c, dome: 0xe6d8ff, light: 0xc9a6ff },
  { id: 'mothership',  name: 'Mothership',  price: 2600, shape: 'ringed', hull: 0x2a2f3a, dome: 0x7ce8ff, light: 0x39ff14 },
  { id: 'ufoance',     name: 'UFOancé',     price: 3000, shape: 'ringed', hull: 0xf2d6e6, dome: 0xffffff, light: 0xff9ecb },
  { id: 'eclipse',     name: 'Eclipse',     price: 3200, shape: 'ringed', hull: 0x0c0c14, dome: 0xffce6b, light: 0xffa600 },
];

export const BEAMS = [
  { id: 'emerald',     name: 'Emerald',     price: 0,    color: 0x9af7b0 },
  { id: 'sky',         name: 'Sky',         price: 150,  color: 0x8fd8ff },
  { id: 'amber',       name: 'Amber',       price: 200,  color: 0xffd24a },
  { id: 'bubble_pink', name: 'Bubblegum',   price: 260,  color: 0xff8fc8 },
  { id: 'rose',        name: 'Rose',        price: 300,  color: 0xff9ecb },
  { id: 'tangerine',   name: 'Tangerine',   price: 340,  color: 0xff9a3a },
  { id: 'violet',      name: 'Violet',      price: 400,  color: 0xb388ff },
  { id: 'lime',        name: 'Lime',        price: 440,  color: 0xbfff5a },
  { id: 'crimson',     name: 'Crimson',     price: 500,  color: 0xff6b5a },
  { id: 'teal',        name: 'Teal',        price: 560,  color: 0x3fe0c8 },
  { id: 'beam_ice',    name: 'Ice',         price: 700,  color: 0xcfeeff },
  { id: 'magenta',     name: 'Magenta',     price: 760,  color: 0xff4fe0 },
  { id: 'toxic',       name: 'Toxic',       price: 900,  color: 0x9dff3a },
  { id: 'plasma',      name: 'Plasma',      price: 1050, color: 0x6f8fff },
  { id: 'beam_gold',   name: 'Gold',        price: 1200, color: 0xffe14a },
  { id: 'beam_inferno',name: 'Inferno',     price: 1350, color: 0xff3a14 },
  { id: 'frost',       name: 'Frost',       price: 1450, color: 0x9fe6ff },
  { id: 'void',        name: 'Void',        price: 1600, color: 0x7a3aff },
  { id: 'rainbow',     name: 'Rainbow',     price: 1800, color: 0xffffff, rainbow: true },
  { id: 'aurora',      name: 'Aurora',      price: 2200, color: 0xffffff, rainbow: true },
  { id: 'prism',       name: 'Prism',       price: 2600, color: 0xffffff, rainbow: true },
  { id: 'supernova',   name: 'Supernova',   price: 3000, color: 0xffe9a0 },
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
