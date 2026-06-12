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

// same river the world builds — terrain carves its valley
export function riverX(z) {
  return -120 + 60 * Math.sin(z * 0.005 + 0.5) + 30 * Math.sin(z * 0.0021 - 0.4);
}
export function riverW(z) {
  return 12 + 3 * Math.sin(z * 0.011 + 2.0);
}

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
  // base rolling hills, 0..7
  let h = 0.6 + fbm(x * 0.012, z * 0.012) * 6.5;

  // mountain ring beyond the playable bound, peaking at the very edge
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 310) {
    const t = clamp01((edge - 310) / (H - 310));
    const ridge = 0.65 + fbm(x * 0.02 + 31, z * 0.02 + 47) * 0.7;
    h += t * t * 52 * ridge;
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

  // river valley: pull terrain down toward the channel
  const rx = riverX(z);
  const rw = riverW(z);
  const dr = Math.abs(x - rx);
  if (dr < rw / 2 + 16) {
    const t = smooth(clamp01(1 - (dr - rw / 2) / 16)); // 1 in channel
    const bed = -1.4;
    h = h + (bed - h) * t;
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
