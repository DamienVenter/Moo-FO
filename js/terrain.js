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
// Each has a `seed` that drives an organic, blobby outline shared with the
// water surface built in world.js — so the carved bank exactly tracks the
// water edge (no floating-disc gap). `depth` is the basin floor below WATER.
export const BASINS = [
  { x: riverX(-195), z: -198, rx: 46, rz: 40, depth: 3.0, seed: 11.0, name: 'lake' },  // reservoir lake
  { x: 210, z: 185, rx: 23, rz: 19, depth: 2.4, seed: 4.0, name: 'pondE' },
  { x: -305, z: 70, rx: 17, rz: 14, depth: 2.2, seed: 7.3, name: 'pondW' },
];

// Plunge pool also gets an organic outline (shared with world.js).
export const WFALL_POOL_SHAPE = { x: WFALL_POOL.x, z: WFALL_POOL.z, rx: WFALL_POOL.rx, rz: WFALL_POOL.rz, depth: 2.6, seed: 19.0 };

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// Organic radius multiplier for a blobby pond outline. Returns a smooth value
// roughly in [0.72, 1.18] that varies with angle, deterministic per `seed`.
// Shared by terrain.js (basin carve) and world.js (water surface polygon) so
// the two always agree edge-to-edge.
export function blobRadius(seed, ang) {
  return 1
    + 0.16 * Math.sin(ang * 2 + seed)
    + 0.10 * Math.sin(ang * 3 - seed * 1.7)
    + 0.06 * Math.sin(ang * 5 + seed * 0.6);
}

// Signed "inside" factor for an organic basin: returns how deep into the blob a
// point is. >0 inside the water outline, ramps to 0 at `skirt` units beyond the
// bank toe. `b` is a BASINS-style record with x,z,rx,rz,seed.
function basinField(x, z, b, skirt) {
  const dx = x - b.x;
  const dz = z - b.z;
  const ang = Math.atan2(dz / b.rz, dx / b.rx);
  const rmul = blobRadius(b.seed, ang);
  // normalized elliptical distance, 1 at the (organic) water edge
  const d = Math.hypot(dx / (b.rx * rmul), dz / (b.rz * rmul));
  return d;
}

function farmHeight(x, z) {
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

  // water basins carve below water level, following each pond's ORGANIC blob
  // outline. Inside the outline the bed sits at -depth (well under WATER_LEVEL);
  // a skirt just outside the outline raises a bank ABOVE water so the surface
  // fills the bowl edge-to-edge with no exposed disc rim.
  for (let i = 0; i < BASINS.length; i++) {
    const b = BASINS[i];
    const d = basinField(x, z, b);          // 1 at the water edge
    if (d < 1.5) {
      // inside (d<=1): full carve to the floor.
      // bank ring (1<d<1.5): lift the rim up so it crests above water.
      if (d <= 1) {
        const t = smooth(clamp01(1 - d * 0.85));      // deepest at center
        h = h + (-b.depth - h) * t;
      } else {
        const bt = smooth(clamp01(1 - (d - 1) / 0.5)); // 1 at edge → 0 outside
        const bankTop = 1.1;                            // bank crest above water
        h = h + (bankTop - h) * bt * 0.7;
      }
    }
  }

  // waterfall plunge pool at the mountain's foot — organic, carved + banked.
  {
    const b = WFALL_POOL_SHAPE;
    const d = basinField(x, z, b);
    if (d < 1.5) {
      if (d <= 1) {
        const t = smooth(clamp01(1 - d * 0.85));
        h = h + (-b.depth - h) * t;
      } else {
        const bt = smooth(clamp01(1 - (d - 1) / 0.5));
        h = h + (1.0 - h) * bt * 0.6;
      }
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

// The shoreline runs (roughly N–S) along z, meandering a little, at this x.
// Left of it (smaller x) = OCEAN; right of it = BEACH sand + dunes.
export const BEACH_SHORE_X = -30;
export function beachShoreX(z) {
  return BEACH_SHORE_X + Math.sin(z * 0.03) * 5 + Math.sin(z * 0.013 + 1.0) * 7;
}

// Beach biome height: ocean on the left (sloping down underwater), a sandy
// shore, then gently rising sand with rolling dunes inland on the right.
function beachHeight(x, z) {
  const dx = x - beachShoreX(z);              // <0 sea side, >0 beach side
  if (dx < 0) {
    // ocean floor — slopes deeper to the left, with a soft seabed ripple.
    let depth = -1.2 + dx * 0.05;             // dx negative → goes negative
    depth += (fbm(x * 0.02 + 5, z * 0.02 + 5) - 0.5) * 1.2;
    return Math.max(depth, -16);
  }
  // wet sand near the waterline rising into the dry beach.
  let h = 0.15 + dx * 0.03;
  // rolling dunes further inland (fade in past the foreshore, capped so the
  // UFO always clears them).
  const dune = (fbm(x * 0.013 + 20, z * 0.013 + 20) - 0.45) * 16;
  h += Math.max(0, dune) * clamp01((dx - 18) / 70);
  return Math.min(h, 7.5);
}

let _biome = 'farm';
/** Switch the global heightfield biome ('farm' | 'beach'). */
export function setBiome(name) { _biome = (name === 'beach') ? 'beach' : 'farm'; }
export function getBiome() { return _biome; }

export function terrainHeight(x, z) {
  return _biome === 'beach' ? beachHeight(x, z) : farmHeight(x, z);
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
