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
  { id: 'bubblegum',   name: 'Bubblegum',   price: 380,  shape: 'saucer', hull: 0xff8fc8, dome: 0xffe3f3, light: 0xff5fb0 },
  { id: 'toxic_disc',  name: 'Toxic Saucer',price: 520,  shape: 'saucer', hull: 0x3a4a12, dome: 0xeaffb0, light: 0x9dff3a },
  { id: 'gold',        name: 'Golden Disc', price: 2500, shape: 'saucer', hull: 0xe8b53a, dome: 0xfff4cf, light: 0xffe14a },
  { id: 'chrome_dream',name: 'Chrome Dream',price: 2800, shape: 'saucer', hull: 0xdfe6ef, dome: 0xffffff, light: 0xbfeaff },

  // — orbs —
  { id: 'mint',        name: 'Mint Orb',    price: 250,  shape: 'orb',    hull: 0x3fae84, dome: 0xd6fff0, light: 0x8effc8 },
  { id: 'orb_blue',    name: 'Blue Orb',    price: 450,  shape: 'orb',    hull: 0x3a6ea5, dome: 0xbfe6ff, light: 0x66c8ff },
  { id: 'cosmic_egg',  name: 'Cosmic Egg',  price: 820,  shape: 'orb',    hull: 0x1a1240, dome: 0xc7a6ff, light: 0x8e7bff },
  { id: 'lava_lamp',   name: 'Lava Lamp',   price: 980,  shape: 'orb',    hull: 0x5a124a, dome: 0xffc56b, light: 0xff5fa0 },
  { id: 'galaxy',      name: 'Galaxy',      price: 1700, shape: 'orb',    hull: 0x120a2e, dome: 0x8fb4ff, light: 0xd07aff },
  { id: 'sunspot',     name: 'Sunspot',     price: 2200, shape: 'orb',    hull: 0xffb000, dome: 0xfff6d0, light: 0xffdf4a },

  // — deltas —
  { id: 'delta_g',     name: 'Green Delta', price: 700,  shape: 'delta',  hull: 0x4c8c3a, dome: 0xd9ffce, light: 0x9cff7a },
  { id: 'delta_st',    name: 'Stealth',     price: 900,  shape: 'delta',  hull: 0x23262b, dome: 0x8fd0ff, light: 0x6ad0ff },
  { id: 'phantom_wing',name: 'Phantom Wing',price: 1050, shape: 'delta',  hull: 0x1a1d24, dome: 0xc0c8d4, light: 0x7c9eff },
  { id: 'neon_cyan',   name: 'Neon Cyan',   price: 1500, shape: 'delta',  hull: 0x081a22, dome: 0x39fff0, light: 0x00f0ff },
  { id: 'thunderbird', name: 'Thunderbird', price: 1850, shape: 'delta',  hull: 0x3a2a08, dome: 0xfff0a0, light: 0xffe14a },
  { id: 'nightraven',  name: 'Nightraven',  price: 2100, shape: 'delta',  hull: 0x141622, dome: 0x6a5fff, light: 0x9a7bff },

  // — ringed —
  { id: 'ring_aqua',   name: 'Aqua Ring',   price: 800,  shape: 'ringed', hull: 0x2f8f9e, dome: 0xc4fff7, light: 0x7cf2e6 },
  { id: 'saturn_v',    name: 'Saturn V',    price: 1300, shape: 'ringed', hull: 0xc8a25a, dome: 0xfff0cf, light: 0xffd88f },
  { id: 'royal',       name: 'Royal',       price: 1800, shape: 'ringed', hull: 0x3b2a8c, dome: 0xe6d8ff, light: 0xc9a6ff },
  { id: 'mothership',  name: 'Mothership',  price: 2600, shape: 'ringed', hull: 0x2a2f3a, dome: 0x7ce8ff, light: 0x39ff14 },
  { id: 'eclipse',     name: 'Eclipse',     price: 3200, shape: 'ringed', hull: 0x0c0c14, dome: 0xffce6b, light: 0xffa600 },
  { id: 'ring_jade',   name: 'Jade Ring',   price: 1000, shape: 'ringed', hull: 0x1f6b52, dome: 0xc4ffe0, light: 0x5fe6a0 },
  { id: 'halo_king',   name: 'Halo King',   price: 3600, shape: 'ringed', hull: 0xd4af37, dome: 0xfff7d0, light: 0xfff04a },

  // — mushroom —
  { id: 'fungal',      name: 'Fungal',      price: 320,  shape: 'mushroom', hull: 0x8a5a3a, dome: 0xffe0c4, light: 0xffb07a },
  { id: 'amanita',     name: 'Amanita',     price: 680,  shape: 'mushroom', hull: 0xc0392b, dome: 0xfff0f0, light: 0xffffff },
  { id: 'morel',       name: 'Morel',       price: 540,  shape: 'mushroom', hull: 0x5a4630, dome: 0xd8c0a0, light: 0xe8d0a8 },
  { id: 'glowcap',     name: 'Glowcap',     price: 1250, shape: 'mushroom', hull: 0x2a1a4a, dome: 0xa0ffe6, light: 0x5fffd0 },
  { id: 'truffle',     name: 'Truffle',     price: 2300, shape: 'mushroom', hull: 0x1a1410, dome: 0x6a5a40, light: 0x8a7a50 },
  { id: 'fairy_ring',  name: 'Fairy Ring',  price: 1600, shape: 'mushroom', hull: 0x6a3a8a, dome: 0xffd6f5, light: 0xff8fe0 },

  // — crystal —
  { id: 'quartz',      name: 'Quartz',      price: 340,  shape: 'crystal', hull: 0xc8d0e0, dome: 0xffffff, light: 0xd0e8ff },
  { id: 'amethyst',    name: 'Amethyst',    price: 760,  shape: 'crystal', hull: 0x6a3aa0, dome: 0xe0c0ff, light: 0xb070ff },
  { id: 'emerald_cut', name: 'Emerald Cut', price: 1300, shape: 'crystal', hull: 0x0f6b4a, dome: 0xb0ffd8, light: 0x3fffa0 },
  { id: 'ruby_shard',  name: 'Ruby Shard',  price: 1450, shape: 'crystal', hull: 0x8a0e2a, dome: 0xffb0c0, light: 0xff3a6a },
  { id: 'sapphire',    name: 'Sapphire',    price: 2400, shape: 'crystal', hull: 0x163a8a, dome: 0xb0d0ff, light: 0x4a8aff },
  { id: 'diamond',     name: 'Diamond',     price: 3800, shape: 'crystal', hull: 0xeaf2ff, dome: 0xffffff, light: 0xc0f0ff },

  // — star —
  { id: 'starlight',   name: 'Starlight',   price: 300,  shape: 'star',   hull: 0x2a3a6a, dome: 0xfff8d0, light: 0xfff04a },
  { id: 'nova_star',   name: 'Nova',        price: 880,  shape: 'star',   hull: 0x3a0a1a, dome: 0xffd0a0, light: 0xff6a3a },
  { id: 'sheriff',     name: 'Sheriff',     price: 620,  shape: 'star',   hull: 0x8a6a2a, dome: 0xfff0c0, light: 0xffd24a },
  { id: 'pulsar',      name: 'Pulsar',      price: 1500, shape: 'star',   hull: 0x0a1a3a, dome: 0xc0e0ff, light: 0x6ad0ff },
  { id: 'shooting',    name: 'Shooting Star',price: 2050,shape: 'star',   hull: 0x141022, dome: 0xfff0ff, light: 0xffffff },
  { id: 'celeste',     name: 'Celeste',     price: 3100, shape: 'star',   hull: 0x1a2a5a, dome: 0xd0e8ff, light: 0x8fb4ff },
  { id: 'gold_star',   name: 'Gold Star',   price: 3700, shape: 'star',   hull: 0xb8860b, dome: 0xfff7c0, light: 0xffe14a },

  // — tripod —
  { id: 'tripod_war',  name: 'War Tripod',  price: 360,  shape: 'tripod', hull: 0x4a3a2a, dome: 0xc0a080, light: 0xff8a4a },
  { id: 'martian',     name: 'Martian',     price: 740,  shape: 'tripod', hull: 0x7a2a18, dome: 0xffb89a, light: 0xff5a3a },
  { id: 'scarab',      name: 'Scarab',      price: 1100, shape: 'tripod', hull: 0x0a3a3a, dome: 0x8affe0, light: 0x3fe0c8 },
  { id: 'walker',      name: 'Walker',      price: 1350, shape: 'tripod', hull: 0x2a2a30, dome: 0xa0c0ff, light: 0x6a8aff },
  { id: 'arachnid',    name: 'Arachnid',    price: 1950, shape: 'tripod', hull: 0x14101a, dome: 0xc06aff, light: 0xff3a8a },
  { id: 'titan_pod',   name: 'Titan',       price: 2800, shape: 'tripod', hull: 0x3a2a08, dome: 0xfff0a0, light: 0xffc24a },
  { id: 'striderx',    name: 'Strider X',   price: 3400, shape: 'tripod', hull: 0x101820, dome: 0x5fffd0, light: 0x00ffc8 },

  // — cube —
  { id: 'borg',        name: 'Borg',        price: 280,  shape: 'cube',   hull: 0x2a2e2a, dome: 0x9aff9a, light: 0x39ff14 },
  { id: 'pixel',       name: 'Pixel',       price: 520,  shape: 'cube',   hull: 0x2a4a8a, dome: 0xa0ffff, light: 0x4afff0 },
  { id: 'rubik',       name: 'Rubik',       price: 900,  shape: 'cube',   hull: 0x1a1a1a, dome: 0xffd24a, light: 0xff3a3a },
  { id: 'sandstone',   name: 'Sandstone',   price: 640,  shape: 'cube',   hull: 0xc2a878, dome: 0xfff0d0, light: 0xffd89a },
  { id: 'tesseract',   name: 'Tesseract',   price: 2350, shape: 'cube',   hull: 0x10142a, dome: 0xb0c0ff, light: 0x6a7bff },
  { id: 'ice_cube',    name: 'Ice Cube',    price: 1200, shape: 'cube',   hull: 0xaecbe0, dome: 0xeafbff, light: 0xcfeeff },
  { id: 'monolith',    name: 'Monolith',    price: 3300, shape: 'cube',   hull: 0x08080a, dome: 0x4a5060, light: 0x6a7280 },

  // — bell —
  { id: 'bell_brass',  name: 'Brass Bell',  price: 330,  shape: 'bell',   hull: 0xb08d3a, dome: 0xffe8a0, light: 0xffd24a },
  { id: 'jellybell',   name: 'Jellybell',   price: 580,  shape: 'bell',   hull: 0x6a3a8a, dome: 0xffc0f5, light: 0xff8fe0 },
  { id: 'liberty',     name: 'Liberty',     price: 1050, shape: 'bell',   hull: 0x3a5a4a, dome: 0xc0e0d0, light: 0x8fd0b0 },
  { id: 'tulip_bell',  name: 'Tulip',       price: 870,  shape: 'bell',   hull: 0xc0395f, dome: 0xffd6e0, light: 0xff7aa0 },
  { id: 'nautilus',    name: 'Nautilus',    price: 1700, shape: 'bell',   hull: 0x143a5a, dome: 0xa0e0ff, light: 0x4ac0ff },
  { id: 'chime',       name: 'Chime',       price: 2500, shape: 'bell',   hull: 0xd0d8e8, dome: 0xffffff, light: 0xc0e8ff },
  { id: 'midnight_bell',name: 'Midnight Bell',price: 3000,shape: 'bell',  hull: 0x0c0c20, dome: 0x6a5fff, light: 0x9a7bff },

  // — manta —
  { id: 'manta_reef',  name: 'Reef Manta',  price: 360,  shape: 'manta',  hull: 0x1f6b7a, dome: 0xb0fff0, light: 0x5fe6d0 },
  { id: 'stingray',    name: 'Stingray',    price: 690,  shape: 'manta',  hull: 0x3a3a4a, dome: 0xc0c8d4, light: 0x8fa0c0 },
  { id: 'devilray',    name: 'Devil Ray',   price: 1250, shape: 'manta',  hull: 0x2a0a14, dome: 0xff8a8a, light: 0xff3a3a },
  { id: 'glider',      name: 'Glider',      price: 980,  shape: 'manta',  hull: 0x6a5a2a, dome: 0xfff0c0, light: 0xffd24a },
  { id: 'abyssal',     name: 'Abyssal',     price: 1900, shape: 'manta',  hull: 0x081420, dome: 0x4a8aff, light: 0x2affe0 },
  { id: 'aurora_ray',  name: 'Aurora Ray',  price: 2600, shape: 'manta',  hull: 0x101a30, dome: 0x8fffd0, light: 0xff8fe0 },
  { id: 'phantom_ray', name: 'Phantom Ray', price: 3500, shape: 'manta',  hull: 0x14141c, dome: 0xc0c0ff, light: 0x9a7bff },

  // — spinner —
  { id: 'top_red',     name: 'Spinner',     price: 290,  shape: 'spinner',hull: 0xc0392b, dome: 0xffd1c7, light: 0xff7a5c },
  { id: 'gyro',        name: 'Gyro',        price: 560,  shape: 'spinner',hull: 0x2a4a6a, dome: 0xa0d8ff, light: 0x5fb0ff },
  { id: 'dervish',     name: 'Dervish',     price: 1000, shape: 'spinner',hull: 0x6a2a8a, dome: 0xe0b0ff, light: 0xb070ff },
  { id: 'cyclone',     name: 'Cyclone',     price: 1400, shape: 'spinner',hull: 0x143a4a, dome: 0xb0f0ff, light: 0x4ad0ff },
  { id: 'fidget',      name: 'Fidget',      price: 820,  shape: 'spinner',hull: 0x2a2e34, dome: 0xff9ee6, light: 0x6ff5ff },
  { id: 'tornado',     name: 'Tornado',     price: 2150, shape: 'spinner',hull: 0x3a3a40, dome: 0xd0d8e8, light: 0x9ad8ff },
  { id: 'maelstrom',   name: 'Maelstrom',   price: 3900, shape: 'spinner',hull: 0x081018, dome: 0x4affd0, light: 0x00e0ff },
];

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
