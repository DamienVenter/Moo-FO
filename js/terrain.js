// MOO-FO — js/terrain.js
// Deterministic heightfield: rolling hills, a mountain ring at the map edge,
// flattened zones for the farm, fields and pastures, and carved water basins.
// Everything that touches the ground samples terrainHeight(x, z).

import { CFG } from './config.js';

export const WATER_LEVEL = 0;        // water surfaces sit at y ≈ 0.05
const H = CFG.MAP_HALF;

// ---------------------------------------------------------------- value noise
function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x, z) {
  return (
    noise2(x, z) * 0.55 +
    noise2(x * 2.13 + 7.7, z * 2.13 + 3.1) * 0.3 +
    noise2(x * 4.9 + 19.2, z * 4.9 + 11.4) * 0.15
  );
}

// same river the world builds — terrain carves its valley.
// riverW is the bank-to-bank WATER width; the channel bed sits below WATER.
export function riverX(z) {
  return -120 + 60 * Math.sin(z * 0.005 + 0.5) + 30 * Math.sin(z * 0.0021 - 0.4);
}
export function riverW(z) {
  return 22 + 5 * Math.sin(z * 0.011 + 2.0);
}

const RIVER_BED = -1.8;   // channel floor, well below WATER_LEVEL
const RIVER_BANK = 7;     // horizontal run for the bank to rise to base ground

// Giant landmark mountain (NW). Too tall to fly over — the lower slopes are
// climbable but pushing too high crashes you into the rock (see ufo.js). The
// waterfall pours from a notch on its SE face into a plunge pool, and a short
// stream carries that water into the reservoir lake.
export const MOUNTAIN = { x: -300, z: -300, r: 124, peak: 108 };
export const WFALL_POOL = { x: -232, z: -244, rx: 22, rz: 17 };
export const WFALL_STREAM = { x1: -222, z1: -236, x2: -188, z2: -210, w: 9 };

function distToSeg(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - x1) * dx + (pz - z1) * dz) / l2;
  t = clamp01(t);
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

// Gentle interior hills — rounded bumps in the middle of the playable map
// (NOT the big edge mountains). Added on top of the base before the flats are
// applied, so building/pasture zones still get flattened over them.
const HILLS = [
  { x: 120, z: -165, r: 52, h: 13 },
  { x: -78, z: -150, r: 46, h: 11 },
  { x: 135, z: 232, r: 48, h: 12 },
  { x: -150, z: 70, r: 50, h: 13 },
  { x: 250, z: -95, r: 44, h: 10 },
  { x: -40, z: 250, r: 40, h: 9 },
  { x: 300, z: 250, r: 46, h: 11 },
  // more rolling elevation across the open country
  { x: 250, z: 150, r: 50, h: 14 },
  { x: -260, z: -60, r: 46, h: 12 },
  { x: 60, z: 210, r: 44, h: 10 },
  { x: -210, z: 130, r: 42, h: 10 },
  { x: 300, z: -200, r: 50, h: 15 },
  { x: -300, z: 40, r: 46, h: 12 },
  { x: 95, z: 300, r: 44, h: 10 },
  { x: 250, z: 30, r: 46, h: 13 },
  { x: -150, z: -280, r: 44, h: 11 },
];

// Flat plateaus (farm compound, crop fields, pastures, meadows). Each blends
// the terrain toward `y` inside radius r, with a soft skirt.
const FLATS = [
  { x: 45, z: -15, r: 95, y: 0.8 },     // farm core
  { x: 167, z: 100, r: 62, y: 1.0 },    // corn field
  { x: 52, z: 253, r: 40, y: 0.9 },     // pumpkin patch
  { x: 30, z: 176, r: 58, y: 0.9 },     // orchard
  { x: -190, z: -80, r: 48, y: 1.0 },   // pasture W
  { x: 160, z: -70, r: 52, y: 1.0 },    // pasture E
  { x: -120, z: 282, r: 46, y: 0.9 },   // pasture S
  { x: 268, z: 118, r: 46, y: 1.1 },    // pasture SE
  { x: -28, z: 78, r: 36, y: 0.8 },     // front meadow
  { x: -20, z: -200, r: 44, y: 1.0 },   // open meadow
  { x: 224, z: -212, r: 44, y: 1.1 },   // second barn + hay field
  { x: -255, z: 170, r: 40, y: 1.2 },   // sheep meadow
];

// Water basins (must match world.js shapes): lake + ponds carve below 0.
const BASINS = [
  { x: riverX(-195), z: -198, rx: 46, rz: 40 },  // reservoir lake
  { x: 210, z: 185, rx: 23, rz: 19 },
  { x: -305, z: 70, rx: 17, rz: 14 },
];

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

export function terrainHeight(x, z) {
  // base rolling hills (broader + taller now for more elevation variety)
  let h = 0.6 + fbm(x * 0.011, z * 0.011) * 8.5;

  // mountain ring beyond the playable bound, peaking at the very edge
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 310) {
    const t = clamp01((edge - 310) / (H - 310));
    const ridge = 0.65 + fbm(x * 0.02 + 31, z * 0.02 + 47) * 0.7;
    h += t * t * 52 * ridge;
  }

  // gentle interior hills (rounded cosine bumps, with a little noise texture)
  for (let i = 0; i < HILLS.length; i++) {
    const hl = HILLS[i];
    const d = Math.hypot(x - hl.x, z - hl.z);
    if (d < hl.r) {
      const t = 0.5 + 0.5 * Math.cos((d / hl.r) * Math.PI); // 1 at center → 0 at rim
      h += hl.h * t * t * (0.85 + fbm(x * 0.05 + 60, z * 0.05 + 60) * 0.3);
    }
  }

  // giant landmark mountain — a steep cone (steeper toward the peak) with a
  // rocky fbm texture; rises well above everything else.
  {
    const d = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
    if (d < MOUNTAIN.r) {
      const t = clamp01(1 - d / MOUNTAIN.r);
      const cone = Math.pow(t, 1.7);
      h += MOUNTAIN.peak * cone * (0.88 + fbm(x * 0.03 + 90, z * 0.03 + 90) * 0.24);
    }
  }

  // flatten plateaus
  for (let i = 0; i < FLATS.length; i++) {
    const f = FLATS[i];
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r + 28) {
      const t = smooth(clamp01(1 - (d - f.r) / 28));   // 1 inside, 0 at skirt edge
      h = h + (f.y - h) * t;
    }
  }

  // River valley: a flat bed below water out to the bank-to-bank half-width,
  // then banks rising over RIVER_BANK units. Water (built in world.js at the
  // same half-width) fills the channel edge-to-edge — no exposed dry trench.
  const rx = riverX(z);
  const half = riverW(z) / 2;
  const dr = Math.abs(x - rx);
  if (dr < half + RIVER_BANK) {
    const t = dr <= half ? 1 : smooth(clamp01(1 - (dr - half) / RIVER_BANK));
    h = h + (RIVER_BED - h) * t;
  }

  // water basins carve below water level
  for (let i = 0; i < BASINS.length; i++) {
    const b = BASINS[i];
    const d = Math.hypot((x - b.x) / (b.rx + 12), (z - b.z) / (b.rz + 12));
    if (d < 1) {
      const t = smooth(clamp01(1 - d));
      h = h + (-1.6 - h) * t;
    }
  }

  // waterfall plunge pool at the mountain's foot
  {
    const d = Math.hypot((x - WFALL_POOL.x) / (WFALL_POOL.rx + 10),
                         (z - WFALL_POOL.z) / (WFALL_POOL.rz + 10));
    if (d < 1) {
      const t = smooth(clamp01(1 - d));
      h = h + (-1.9 - h) * t;
    }
  }

  // stream carrying the pool's overflow into the reservoir lake
  {
    const s = WFALL_STREAM;
    const dd = distToSeg(x, z, s.x1, s.z1, s.x2, s.z2);
    if (dd < s.w / 2 + RIVER_BANK) {
      const t = dd <= s.w / 2 ? 1 : smooth(clamp01(1 - (dd - s.w / 2) / RIVER_BANK));
      h = h + (RIVER_BED - h) * t;
    }
  }

  return h;
}

// Highest ground in a small disc — the UFO probes this so it never clips a slope.
export function terrainMaxAround(x, z, r) {
  let m = terrainHeight(x, z);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const h2 = terrainHeight(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (h2 > m) m = h2;
  }
  return m;
}

export function isUnderwater(x, z) {
  return terrainHeight(x, z) < WATER_LEVEL - 0.15;
}
