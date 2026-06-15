// MOO-FO — UFO cosmetics. 15 distinct UFO MODELS (each a unique shape) with 5
// recolour SKINS apiece (75 UFOs), plus 50 tractor-beam styles. Buying a model's
// cheapest "boring" skin UNLOCKS that model's group; the other four then become
// purchasable. Ownership + current selection persisted to localStorage.

// HSL → 0xRRGGBB (compact, no deps) for generating cohesive per-model palettes.
function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * Math.max(0, Math.min(1, c)));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

// Five recolour treatments per model (skin 0 = the cheapest, "most boring" one
// that unlocks the group). Each derives hull/dome/light from the model's hue.
const TREAT = [
  { sfx: 'matte',  name: 'Matte',  hs: 0.16, hl: 0.54, dShift: 50,  ls: 0.55, ll: 0.62, lShift: 0 },
  { sfx: 'gloss',  name: 'Gloss',  hs: 0.58, hl: 0.55, dShift: 35,  ls: 0.85, ll: 0.60, lShift: 0 },
  { sfx: 'neon',   name: 'Neon',   hs: 0.96, hl: 0.56, dShift: 6,   ls: 0.95, ll: 0.62, lShift: -40 },
  { sfx: 'noir',   name: 'Noir',   hs: 0.55, hl: 0.30, dShift: 18,  ls: 0.90, ll: 0.60, lShift: 8 },
  { sfx: 'aurora', name: 'Aurora', hs: 0.82, hl: 0.58, dShift: 120, ls: 0.85, ll: 0.66, lShift: 165 },
];

// Per-model config (order = unlock tier 0..14). cap = 4 + tier (later models
// upgrade higher). hue drives the whole skin family.
const MODEL_CFG = [
  { shape: 'saucer',   name: 'Saucer',  hue: 205 },
  { shape: 'orb',      name: 'Orb',     hue: 135 },
  { shape: 'ringed',   name: 'Ringer',  hue: 280 },
  { shape: 'bell',     name: 'Bell',    hue: 35 },
  { shape: 'delta',    name: 'Delta',   hue: 0 },
  { shape: 'spinner',  name: 'Spinner', hue: 190 },
  { shape: 'mushroom', name: 'Shroom',  hue: 95 },
  { shape: 'cube',     name: 'Cube',    hue: 315 },
  { shape: 'donut',    name: 'Donut',   hue: 45 },
  { shape: 'star',     name: 'Star',    hue: 58 },
  { shape: 'manta',    name: 'Manta',   hue: 170 },
  { shape: 'tripod',   name: 'Tripod',  hue: 22 },
  { shape: 'beetle',   name: 'Beetle',  hue: 265 },
  { shape: 'crystal',  name: 'Crystal', hue: 150 },
  { shape: 'jelly',    name: 'Jelly',   hue: 330 },
];
const UNLOCKS = [0, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500, 6600, 7800, 9100, 10500, 12000, 13600];

function buildSkins(modelId, tier, hue, unlock) {
  const skins = TREAT.map((t, i) => {
    const price = i === 0 ? unlock : unlock + i * (Math.round(unlock * 0.18) + 120);
    return {
      id: `${modelId}_${t.sfx}`,
      name: t.name,
      price,
      hull: hsl(hue, t.hs, t.hl),
      dome: hsl(hue + t.dShift, 0.55, 0.72),
      light: hsl(hue + t.lShift, t.ls, t.ll),
    };
  });
  // The free starter is the classic grey saucer (model 0, skin 0).
  if (tier === 0) skins[0] = { id: 'classic', name: 'Classic', price: 0, hull: 0x9aa7b8, dome: 0x7ce8ff, light: 0x7cfc9a };
  return skins;
}

export const MODELS = MODEL_CFG.map((cfg, tier) => {
  const id = 'm_' + cfg.shape;
  return {
    id, name: cfg.name, shape: cfg.shape, tier, cap: 4 + tier,
    unlock: UNLOCKS[tier], hue: cfg.hue,
    skins: buildSkins(id, tier, cfg.hue, UNLOCKS[tier]),
  };
});

// Flat skin list (each augmented with its model). Back-compat for callers that
// iterate every skin (e.g. the preview thumbnailer).
export const SKINS = MODELS.flatMap((m) =>
  m.skins.map((s) => ({ ...s, model: m.id, modelName: m.name, shape: m.shape })));

const SKIN_MODEL = {};
MODELS.forEach((m) => m.skins.forEach((s) => { SKIN_MODEL[s.id] = m; }));
export function modelOfSkin(id) { return SKIN_MODEL[id] || null; }

export const BEAMS = [
  { id: 'emerald',     name: 'Emerald',     price: 0,    style: 'solid',   color: 0x9af7b0 },

  // — solid —
  { id: 'sky',         name: 'Sky',         price: 150,  style: 'solid',   color: 0x8fd8ff },
  { id: 'amber',       name: 'Amber',       price: 200,  style: 'solid',   color: 0xffd24a },
  { id: 'crimson',     name: 'Crimson',     price: 500,  style: 'solid',   color: 0xff6b5a },
  { id: 'beam_gold',   name: 'Gold',        price: 1200, style: 'solid',   color: 0xffe14a },

  // — rings —
  { id: 'rose',        name: 'Rose Rings',  price: 300,  style: 'rings',   color: 0xff9ecb },
  { id: 'teal_rings',  name: 'Teal Rings',  price: 560,  style: 'rings',   color: 0x3fe0c8 },
  { id: 'ringfire',    name: 'Ring of Fire',price: 1350, style: 'rings',   color: 0xff5a2a },
  { id: 'haloways',    name: 'Ringways',    price: 2100, style: 'rings',   color: 0xc0a6ff, color2: 0xfff0c0 },
  { id: 'ring_cycle',  name: 'Ring Cycle',  price: 3500, style: 'rings',   color: 0xffffff, rainbow: true },

  // — spiral —
  { id: 'dna_helix',   name: 'DNA Helix',   price: 640,  style: 'spiral',  color: 0x5fffd0, color2: 0xff6ad0 },
  { id: 'cyclone_beam',name: 'Cyclone',     price: 1100, style: 'spiral',  color: 0x6fd8ff, color2: 0xffffff },
  { id: 'whirlpool',   name: 'Whirlpool',   price: 1700, style: 'spiral',  color: 0x2a8fff, color2: 0x9affe0 },
  { id: 'galaxy_arm',  name: 'Galaxy Arm',  price: 2900, style: 'spiral',  color: 0xd07aff, color2: 0x8fb4ff },

  // — dashed —
  { id: 'morse',       name: 'Morse',       price: 220,  style: 'dashed',  color: 0xbfff5a },
  { id: 'tracer',      name: 'Tracer',      price: 680,  style: 'dashed',  color: 0xff9a3a, color2: 0xfff0c0 },
  { id: 'barcode',     name: 'Barcode',     price: 1250, style: 'dashed',  color: 0xeaf2ff, color2: 0x2a2e34 },
  { id: 'stutter',     name: 'Stutter',     price: 1900, style: 'dashed',  color: 0xff4fe0, color2: 0x6ff5ff },

  // — double —
  { id: 'twin_lime',   name: 'Twin Lime',   price: 440,  style: 'double',  color: 0xbfff5a, color2: 0x39ff14 },
  { id: 'duet',        name: 'Duet',        price: 820,  style: 'double',  color: 0x8fd8ff, color2: 0xff9ecb },
  { id: 'split_beam',  name: 'Split',       price: 1500, style: 'double',  color: 0xffd24a, color2: 0x7a3aff },
  { id: 'binary_star', name: 'Binary Star', price: 3100, style: 'double',  color: 0xfff0a0, color2: 0x6ad0ff },

  // — twist —
  { id: 'tractor_twist',name: 'Tractor Twist',price: 760,style: 'twist',   color: 0x9af7b0, color2: 0xffd24a },
  { id: 'candy_cane',  name: 'Candy Cane',  price: 1000, style: 'twist',   color: 0xff5a5a, color2: 0xffffff },
  { id: 'licorice',    name: 'Licorice',    price: 1550, style: 'twist',   color: 0x14141c, color2: 0xff4fe0 },
  { id: 'venom_twist', name: 'Venom',       price: 2300, style: 'twist',   color: 0x9dff3a, color2: 0x2a1a4a },

  // — sparkle —
  { id: 'fairy_dust',  name: 'Fairy Dust',  price: 380,  style: 'sparkle', color: 0xffd6f5 },
  { id: 'stardust',    name: 'Stardust',    price: 900,  style: 'sparkle', color: 0xc0e0ff },
  { id: 'glitterbomb', name: 'Glitterbomb', price: 1600, style: 'sparkle', color: 0xffe14a, color2: 0xff8fc8 },
  { id: 'fireworks',   name: 'Fireworks',   price: 2700, style: 'sparkle', color: 0xffffff, rainbow: true },

  // — pillars —
  { id: 'pillar_light',name: 'Pillar of Light',price: 540,style: 'pillars',color: 0xfff0c4 },
  { id: 'colonnade',   name: 'Colonnade',   price: 1050, style: 'pillars', color: 0xc8d0e0, color2: 0x8fa0c0 },
  { id: 'stonehenge',  name: 'Stonehenge',  price: 1750, style: 'pillars', color: 0x9a8a6a },
  { id: 'ion_columns', name: 'Ion Columns', price: 2400, style: 'pillars', color: 0x4affd0, color2: 0x2a8fff },

  // — plasma —
  { id: 'plasma',      name: 'Plasma',      price: 1050, style: 'plasma',  color: 0x6f8fff },
  { id: 'plasma_storm',name: 'Plasma Storm',price: 1850, style: 'plasma',  color: 0xb070ff, color2: 0x39fff0 },
  { id: 'beam_inferno',name: 'Inferno',     price: 1350, style: 'plasma',  color: 0xff3a14 },
  { id: 'ion_cascade', name: 'Ion Cascade', price: 3300, style: 'plasma',  color: 0xffffff, rainbow: true },

  // — halo —
  { id: 'halo_drop',   name: 'Halo Drop',   price: 700,  style: 'halo',    color: 0xfff8d0 },
  { id: 'angelic',     name: 'Angelic',     price: 1450, style: 'halo',    color: 0xffffff, color2: 0xffe9a0 },
  { id: 'eclipse_beam',name: 'Eclipse',     price: 2500, style: 'halo',    color: 0xffce6b, color2: 0x0c0c14 },
  { id: 'saturn_halo', name: 'Saturn Halo', price: 3000, style: 'halo',    color: 0xffd88f, color2: 0xc8a25a },

  // — lattice —
  { id: 'gridlock',    name: 'Gridlock',    price: 600,  style: 'lattice', color: 0x39ff14, color2: 0x081a22 },
  { id: 'matrix',      name: 'Matrix',      price: 1300, style: 'lattice', color: 0x4aff8a, color2: 0x062012 },
  { id: 'circuit',     name: 'Circuit',     price: 2000, style: 'lattice', color: 0x6ff5ff, color2: 0xffd24a },
  { id: 'web',         name: 'Web',         price: 2600, style: 'lattice', color: 0xeaf2ff, color2: 0x7a3aff },

  // — comet —
  { id: 'comet_tail',  name: 'Comet Tail',  price: 460,  style: 'comet',   color: 0x9fe6ff, color2: 0xffffff },
  { id: 'meteor',      name: 'Meteor',      price: 1150, style: 'comet',   color: 0xff8a3a, color2: 0xffe14a },
  { id: 'shooting_beam',name: 'Shooting Star',price: 2200,style: 'comet',  color: 0xfff0ff, color2: 0xc0e0ff },
  { id: 'supernova',   name: 'Supernova',   price: 3000, style: 'comet',   color: 0xffffff, rainbow: true },
];

const KEY = 'moofo-cosmetics-v2';

export class Cosmetics {
  constructor() {
    this._owned = new Set(['classic', 'emerald']);
    this._skin = 'classic';
    this._beam = 'emerald';
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d) {
        if (Array.isArray(d.owned)) for (const id of d.owned) if (this._find(id)) this._owned.add(id);
        if (this.owns(d.skin)) this._skin = d.skin;
        if (this.owns(d.beam)) this._beam = d.beam;
      }
    } catch (_) { /* fresh */ }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify({ owned: [...this._owned], skin: this._skin, beam: this._beam })); } catch (_) { /* blocked */ }
  }

  _find(id) { return SKINS.find((s) => s.id === id) || BEAMS.find((b) => b.id === id) || null; }

  owns(id) { return this._owned.has(id); }
  priceOf(id) { const it = this._find(id); return it ? it.price : 0; }
  isSkin(id) { return !!SKIN_MODEL[id]; }
  isBeam(id) { return BEAMS.some((b) => b.id === id); }
  isSelectedSkin(id) { return this._skin === id; }
  isSelectedBeam(id) { return this._beam === id; }

  // ---- model / group helpers ----
  modelOf(id) { return modelOfSkin(id); }
  firstSkinId(modelId) { const m = MODELS.find((x) => x.id === modelId); return m ? m.skins[0].id : null; }
  /** A model's group is UNLOCKED once its cheapest (first) skin is owned. */
  modelUnlocked(modelId) { const f = this.firstSkinId(modelId); return f ? this.owns(f) : false; }
  /** The equipped UFO's model id (drives per-model upgrades). */
  activeModelId() { const m = modelOfSkin(this._skin); return m ? m.id : MODELS[0].id; }

  /** Whether `id` is purchasable right now (group-unlock gating for skins). */
  canBuy(id) {
    if (this.owns(id)) return false;
    if (this.isSkin(id)) {
      const m = modelOfSkin(id);
      if (!m) return false;
      if (id !== m.skins[0].id && !this.owns(m.skins[0].id)) return false;   // group locked
    }
    return true;
  }
  /** True when a skin is locked ONLY because its model group isn't unlocked. */
  groupLocked(id) {
    if (!this.isSkin(id) || this.owns(id)) return false;
    const m = modelOfSkin(id);
    return m && id !== m.skins[0].id && !this.owns(m.skins[0].id);
  }

  buy(id, wallet) {
    if (!this.canBuy(id)) return false;
    const it = this._find(id);
    if (!it) return false;
    if (!wallet.spend(it.price)) return false;
    this._owned.add(id);
    this._save();
    return true;
  }

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

  // ---- counts for the unlock display ----
  totalSkins() { return SKINS.length; }
  totalBeams() { return BEAMS.length; }
  unlockedSkinCount() { let n = 0; for (const s of SKINS) if (this._owned.has(s.id)) n++; return n; }
  unlockedBeamCount() { let n = 0; for (const b of BEAMS) if (this._owned.has(b.id)) n++; return n; }
}
