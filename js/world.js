// MOO-FO — js/world.js
// The 800×800 farm, now with real elevation: rolling hills, a snow-capped
// mountain ring, a carved river valley, draped roads, fenced pastures with
// collision, and living decor (owls, bats, fireflies, a patrolling tractor).

import * as THREE from 'three';
import { CFG, COLORS, ENABLE_SHADOWS } from './config.js';
import { terrainHeight, riverX, riverW, WATER_LEVEL, MOUNTAIN, WFALL_POOL, WFALL_STREAM, BASINS, WFALL_POOL_SHAPE, blobRadius } from './terrain.js';
import * as M from './models.js';

const H = CFG.MAP_HALF;
const CELL = 4;
const GRID_N = (H * 2) / CELL;
const WATER_Y = WATER_LEVEL + 0.05;

// Tileable ripple texture for moving water — scrolled downstream each frame so
// the river visibly runs. OPAQUE near-white base (it multiplies the material's
// blue color) with brighter highlight streaks; alpha stays 1 so the water is
// never made transparent by the map.
function makeFlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cfe6ff';                 // light base → blue survives the multiply
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#ffffff';               // crests
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const y = i * 11 + 3;
    ctx.beginPath();
    for (let x = 0; x <= 64; x += 8) {
      ctx.lineTo(x, y + Math.sin((x / 64) * Math.PI * 2 + i) * 2.5);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#9cc4ec';               // troughs (slightly darker)
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const y = i * 13 + 9;
    ctx.beginPath();
    ctx.moveTo(8, y); ctx.lineTo(20, y + 4); ctx.lineTo(32, y);
    ctx.moveTo(40, y); ctx.lineTo(52, y + 4); ctx.lineTo(64, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Vertical whitewater streaks for the waterfall sheet — opaque so the sheet
// stays bright; scrolled downward fast for a rushing-water read. `seed` varies
// the streak pattern so layered sheets don't look identical.
function makeFallTexture(seed = 0) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#dff1ff';
  ctx.fillRect(0, 0, 32, 64);
  const rnd = (() => { let s = seed * 9973 + 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#cfeaff' : '#a8d2f2';
    ctx.lineWidth = 1 + rnd() * 2.4;
    const x = rnd() * 32;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let cx = x;
    for (let y = 0; y <= 64; y += 8) {
      cx += (rnd() - 0.5) * 3;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }
  // a few horizontal foam ripples to suggest churn
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < 4; i++) {
    const y = rnd() * 64;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 32; x += 6) ctx.lineTo(x, y + Math.sin(x * 0.6 + i) * 1.5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft wet-stain decal: a vertical streak that is fully opaque down its core
// and feathers to zero alpha toward both side edges and the top/bottom, so a
// plane textured with it reads as a smooth, soft-edged wet patch hugging the
// rock — never a hard rectangular box. Used as an alphaMap on the waterfall's
// wet band and on the glossy plunge-pool ring.
function makeWetStainTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 128);
  // horizontal feather (soft left/right edges) via a centred gradient...
  const gx = ctx.createLinearGradient(0, 0, 64, 0);
  gx.addColorStop(0.0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.22, 'rgba(255,255,255,0.65)');
  gx.addColorStop(0.5, 'rgba(255,255,255,1)');
  gx.addColorStop(0.78, 'rgba(255,255,255,0.65)');
  gx.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, 64, 128);
  // ...then fade the top and bottom with a vertical multiply gradient.
  ctx.globalCompositeOperation = 'multiply';
  const gy = ctx.createLinearGradient(0, 0, 0, 128);
  gy.addColorStop(0.0, 'rgba(255,255,255,0.15)');
  gy.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  gy.addColorStop(0.85, 'rgba(255,255,255,1)');
  gy.addColorStop(1.0, 'rgba(255,255,255,0.45)');
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, 64, 128);
  // a couple of soft inner darker rivulets so the wet patch isn't a flat slab
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  for (const ox of [24, 40]) {
    ctx.beginPath();
    ctx.moveTo(ox, 6);
    for (let y = 6; y <= 122; y += 14) ctx.lineTo(ox + Math.sin(y * 0.13 + ox) * 5, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round foam puff sprite — for the crest foam, churning base whitewater,
// and the spreading ripple rings on the plunge pool.
function makeFoamTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(235,247,255,0.55)');
  g.addColorStop(1, 'rgba(220,240,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Grass palettes — different patches of the map grow different-coloured grass.
const _bladeGeo = (() => { const g = new THREE.BoxGeometry(0.07, 1, 0.07); g.translate(0, 0.5, 0); return g; })();
const GRASS_PALETTE = [
  [COLORS.grassC, COLORS.grassB],   // lush
  [0x9fbf4a, 0x86a83a],             // dry / golden
  [0x2f7d3a, 0x3c8f48],             // deep forest green
  [0x57b98a, 0x49a978],             // blue-green
  [0xa7a83f, 0x8f9a34],             // olive
];
const _grassMats = GRASS_PALETTE.map(([a, b]) => [
  new THREE.MeshLambertMaterial({ color: a }),
  new THREE.MeshLambertMaterial({ color: b }),
]);
// Low-frequency region index → big contiguous patches of one colour.
function grassRegion(x, z) {
  const v = Math.sin(x * 0.018 + 1.7) * Math.cos(z * 0.021 - 0.5) + 0.5 * Math.sin((x - z) * 0.013);
  const n = GRASS_PALETTE.length;
  return Math.max(0, Math.min(n - 1, Math.floor(((v + 1.6) / 3.2) * n)));
}

// A little clump of grass blades (a few thin angled boxes in two greens).
// Bottom-center origin so it sits on the terrain; instanced across the map.
function makeGrassTuft(matPair) {
  const g = new THREE.Group();
  const geo = _bladeGeo;
  const greens = matPair;
  const blades = [
    [0, 0, 0, 0.62, 0.0],
    [0.12, 0.05, 0.02, 0.5, 0.5],
    [-0.1, -0.04, 0.05, 0.46, -0.6],
    [0.03, 0.1, -0.1, 0.54, 0.25],
    [-0.08, 0.02, -0.06, 0.44, 1.0],
  ];
  for (let i = 0; i < blades.length; i++) {
    const [x, lz, lx, h, lean] = blades[i];
    const b = new THREE.Mesh(geo, greens[i % 2]);
    b.scale.set(1, h + Math.random() * 0.35, 1);
    b.position.set(x, 0, lx);
    b.rotation.z = lean + (Math.random() - 0.5) * 0.2;
    b.rotation.x = lz;
    g.add(b);
  }
  return g;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.cowSpawnAreas = [];
    this.chickenSpawnAreas = [];
    this.sheepSpawnAreas = [];
    this.duckAreas = [];
    this.farmerSpawns = [];
    this.fences = [];        // [{x1,z1,x2,z2}] solid fence segments (gates excluded)

    this._water = new Uint8Array(GRID_N * GRID_N);
    this._roads = [];
    this._blockers = [];
    this._clearRects = [];
    this._map = { ponds: [], lake: null, buildings: [], fields: [], bridges: [], fenceRuns: [], dam: null, stable: null };
    this._anim = {
      windmillBlades: null, tractor: null, waterMats: [], lilies: [],
      owls: [], bats: [],
    };
    this._goldenSpots = [];
    this._bushList = [];

    // Representative paddock-centre horse position for main.js proximity SFX
    // (set in _buildStable when createHorse/createStable are available).
    this.horsePos = null;

    this._buildWater();
    this._buildRoadNet();
    this._buildGround();
    this._buildFarmCore();
    this._buildOutposts();
    this._buildFields();
    this._buildPastures();
    this._buildForestRing();
    this._buildForest();
    this._buildMountainDecor();
    this._buildScatter();
    this._buildRiverDetail();
    this._buildGrass();
    this._buildRoadLanterns();
    this._buildTractor();
    this._buildStable();
    this._buildWildlife();
    this._defineSpawns();
  }

  // Street lanterns lining the road shoulders at a regular spacing, alternating
  // sides, skipping anything in water / on a blocker / too close to a neighbour.
  _buildRoadLanterns() {
    const SPACING = 30;
    const placed = [];
    let side = 1;
    for (const r of this._roads) {
      const dx = r.x2 - r.x1;
      const dz = r.z2 - r.z1;
      const len = Math.hypot(dx, dz);
      if (len < 20) continue;            // skip short bridge stubs
      const ux = dx / len;
      const uz = dz / len;
      const nx = -uz;                    // road-shoulder normal
      const nz = ux;
      const off = r.w / 2 + 1.7;
      for (let along = SPACING * 0.5; along < len - 4; along += SPACING) {
        side = -side;
        const x = r.x1 + ux * along + nx * off * side;
        const z = r.z1 + uz * along + nz * off * side;
        if (Math.abs(x) > H - 6 || Math.abs(z) > H - 6) continue;
        if (this.isWater(x, z)) continue;
        let ok = true;
        for (const b of this._blockers) {
          const rr = b.r + 1.2;
          if ((x - b.x) ** 2 + (z - b.z) ** 2 < rr * rr) { ok = false; break; }
        }
        if (!ok) continue;
        for (const p of placed) {
          if ((x - p.x) ** 2 + (z - p.z) ** 2 < 16 * 16) { ok = false; break; }
        }
        if (!ok) continue;
        // face the bracket arm toward the road centerline
        this._place(M.createLanternPost(), x, z, Math.atan2(-nx * side, -nz * side),
          { collider: { r: 0.5, h: 3.4 } });
        placed.push({ x, z });
      }
    }
  }

  // ------------------------------------------------------------- water
  // Mark water cells inside an ORGANIC blob outline (same shape the basin is
  // carved to in terrain.js, via the shared blobRadius), so isWater() tracks
  // the real pond edge rather than a perfect ellipse.
  _stampWaterBlob(b) {
    const maxR = 1.2;
    const x0 = Math.max(0, Math.floor((b.x - b.rx * maxR + H) / CELL));
    const x1 = Math.min(GRID_N - 1, Math.ceil((b.x + b.rx * maxR + H) / CELL));
    const z0 = Math.max(0, Math.floor((b.z - b.rz * maxR + H) / CELL));
    const z1 = Math.min(GRID_N - 1, Math.ceil((b.z + b.rz * maxR + H) / CELL));
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const wx = gx * CELL - H + CELL / 2;
        const wz = gz * CELL - H + CELL / 2;
        const ang = Math.atan2((wz - b.z) / b.rz, (wx - b.x) / b.rx);
        const rmul = blobRadius(b.seed, ang);
        const d = Math.hypot((wx - b.x) / (b.rx * rmul), (wz - b.z) / (b.rz * rmul));
        if (d <= 1.0) this._water[gz * GRID_N + gx] = 1;
      }
    }
  }

  _stampWaterCircle(cx, cz, rx, rz) {
    const x0 = Math.max(0, Math.floor((cx - rx + H) / CELL));
    const x1 = Math.min(GRID_N - 1, Math.ceil((cx + rx + H) / CELL));
    const z0 = Math.max(0, Math.floor((cz - rz + H) / CELL));
    const z1 = Math.min(GRID_N - 1, Math.ceil((cz + rz + H) / CELL));
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const wx = gx * CELL - H + CELL / 2;
        const wz = gz * CELL - H + CELL / 2;
        const dx = (wx - cx) / rx;
        const dz = (wz - cz) / rz;
        if (dx * dx + dz * dz <= 1) this._water[gz * GRID_N + gx] = 1;
      }
    }
  }

  _buildWater() {
    const flowTex = makeFlowTexture();
    this._flowTex = flowTex;
    const waterMat = new THREE.MeshLambertMaterial({
      color: COLORS.water, transparent: true, opacity: 0.93, map: flowTex,
      side: THREE.DoubleSide,   // light both faces
    });
    waterMat.emissive = new THREE.Color(COLORS.waterDeep);
    waterMat.emissiveIntensity = 0.25;
    this._anim.waterMats.push(waterMat);

    // Submerged-wall material for river side faces — darker deep water so the
    // channel reads as a filled body, never a flat see-through strip.
    const wallMat = new THREE.MeshLambertMaterial({
      color: COLORS.waterDeep, transparent: true, opacity: 0.96, side: THREE.DoubleSide,
    });
    wallMat.emissive = new THREE.Color(COLORS.waterDeep);
    wallMat.emissiveIntensity = 0.15;
    this._anim.waterMats.push(wallMat);

    // River as a FILLED channel whose cross-section CONFORMS to the carved
    // riverbed. At every station we walk outward from the centerline and find,
    // by sampling terrainHeight, the exact x where the sloped bank rises through
    // the waterline — that point becomes the water edge, so the surface meets
    // the bank with no gap and never floats. A submerged "skirt" then follows
    // the real bank/bed profile down into the channel (sampled, not a straight
    // vertical wall) so from any low angle you see water hugging the bank, never
    // a see-through strip or a hard step. UVs run v along the river's length.
    const pts = [];
    for (let z = -H; z <= H; z += 5) pts.push({ x: riverX(z), z, w: riverW(z) });
    const surfY = WATER_Y - 0.04;        // sit a touch below the bank crests
    // Find where the bank crosses the waterline, marching out from cx in
    // direction `dir` (+1 / -1). Returns the x at which terrain == surfY.
    const findBankEdge = (cx, z, dir) => {
      const half = riverW(z) / 2;
      let xIn = cx + dir * half;          // at the bed lip, terrain ≈ RIVER_BED (under water)
      let xOut = cx + dir * (half + 9);   // out past the bank toe, terrain above water
      // ensure we bracket the crossing; expand outward if the bank is low here
      let guard = 0;
      while (terrainHeight(xOut, z) < surfY && guard++ < 6) xOut += dir * 4;
      for (let b = 0; b < 14; b++) {       // bisection to the waterline
        const xm = (xIn + xOut) / 2;
        if (terrainHeight(xm, z) < surfY) xIn = xm; else xOut = xm;
      }
      return (xIn + xOut) / 2;
    };
    const pos = [];
    const uv = [];
    const idx = [];
    const wallPos = [];
    const wallIdx = [];
    // submerged skirt: sample this many rungs from the waterline edge down the
    // bank profile to the channel floor, so the underwater side hugs the carve.
    const SKIRT = 3;
    const vertsPerRing = 2 * (SKIRT + 1);  // L-edge..L-bed (centre) + R-edge..R-bed
    let runLen = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i > 0) runLen += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const lx = findBankEdge(p.x, p.z, -1);   // left waterline
      const rxw = findBankEdge(p.x, p.z, 1);    // right waterline
      // ---- flowing top surface: edge-to-edge between the two bank waterlines.
      pos.push(lx, surfY, p.z, rxw, surfY, p.z);
      uv.push(0, runLen / 14, 1, runLen / 14);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      // ---- submerged skirt ring, tracking the bank profile down to the bed.
      // Left side: from the left waterline inward/down to the centre floor.
      const b = i * vertsPerRing;
      const bedY = terrainHeight(p.x, p.z) - 0.05;   // carved channel floor at centre
      for (let s = 0; s <= SKIRT; s++) {
        const t = s / SKIRT;                         // 0 at edge → 1 at centre floor
        const sx = lx + (p.x - lx) * t;
        const sy = surfY + (bedY - surfY) * t;
        wallPos.push(sx, sy, p.z);
      }
      for (let s = 0; s <= SKIRT; s++) {
        const t = s / SKIRT;
        const sx = rxw + (p.x - rxw) * t;
        const sy = surfY + (bedY - surfY) * t;
        wallPos.push(sx, sy, p.z);
      }
      if (i > 0) {
        const pb = (i - 1) * vertsPerRing;
        // stitch the left skirt rungs
        for (let s = 0; s < SKIRT; s++) {
          const a0 = pb + s, a1 = pb + s + 1, b0 = b + s, b1 = b + s + 1;
          wallIdx.push(a0, a1, b0, a1, b1, b0);
        }
        // stitch the right skirt rungs (offset by SKIRT+1)
        const o = SKIRT + 1;
        for (let s = 0; s < SKIRT; s++) {
          const a0 = pb + o + s, a1 = pb + o + s + 1, b0 = b + o + s, b1 = b + o + s + 1;
          wallIdx.push(a0, b0, a1, a1, b0, b1);
        }
      }
      // stamp water cells out to the true bank edge so isWater() tracks the fit
      const halfStamp = Math.max(rxw - p.x, p.x - lx) + 1;
      this._stampWaterCircle(p.x, p.z, halfStamp, 4);
    }
    const riverGeo = new THREE.BufferGeometry();
    riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    riverGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    riverGeo.setIndex(idx);
    riverGeo.computeVertexNormals();
    const river = new THREE.Mesh(riverGeo, waterMat);
    river.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(river);

    const rWallGeo = new THREE.BufferGeometry();
    rWallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    rWallGeo.setIndex(wallIdx);
    rWallGeo.computeVertexNormals();
    const riverWalls = new THREE.Mesh(rWallGeo, wallMat);
    this.scene.add(riverWalls);

    this._riverPts = pts;

    // Dam wall sits in the carved riverbed.
    const damZ = -150;
    // Lake/ponds use the EXACT BASINS records from terrain.js (same seed +
    // radii) so each water surface matches its carved organic basin.
    const lakeB = BASINS.find((b) => b.name === 'lake');
    const pondEB = BASINS.find((b) => b.name === 'pondE');
    const pondWB = BASINS.find((b) => b.name === 'pondW');
    const lake = { x: lakeB.x, z: lakeB.z, rx: lakeB.rx, rz: lakeB.rz, seed: lakeB.seed, depth: lakeB.depth };
    this._map.lake = lake;
    this._addBlobWater(lakeB, waterMat);

    // Dam embeds INTO the carved riverbed: its base sinks ~2.5 below the bed so
    // it reads as keyed into the channel, not perched on it. A wider buttress
    // foot ties it into both banks. A wet darker streak runs the downstream face.
    const bedY = terrainHeight(riverX(damZ), damZ);
    const damLen = riverW(damZ) + 26;
    const embed = 2.6;
    const damH = 8.5 + embed;
    const dam = new THREE.Mesh(new THREE.BoxGeometry(damLen, damH, 7), M.mat(COLORS.stone));
    dam.position.set(riverX(damZ), bedY + 4.25 - embed / 2, damZ);
    this.scene.add(dam);
    // buttress foot wedged into the bed
    const foot = new THREE.Mesh(new THREE.BoxGeometry(damLen + 6, 3, 11), M.mat(0x8a8a8a));
    foot.position.set(riverX(damZ), bedY - 1, damZ);
    this.scene.add(foot);
    // SMOOTH wet streak on the downstream (south) face under the spillway — a
    // soft alpha-faded stain (alphaMap feathers all edges) so the wet rock grades
    // into the dry concrete, no hard rectangle.
    const wetMat = new THREE.MeshLambertMaterial({
      color: 0x4a5560, transparent: true, alphaMap: makeWetStainTexture(),
      depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    wetMat.emissive = new THREE.Color(0x223040);
    wetMat.emissiveIntensity = 0.25;
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(damLen * 0.62, damH), wetMat);
    wet.position.set(riverX(damZ), bedY + 4.25 - embed / 2, damZ + 3.56);
    this.scene.add(wet);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(damLen + 2, 1.2, 8.4), M.mat(0xb5b5b5));
    crest.position.set(riverX(damZ), bedY + 9, damZ);
    this.scene.add(crest);
    // spill pipes for charm
    for (const s of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 8, 8), M.mat(0x6e7479));
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(riverX(damZ) + s * 6, bedY + 1.6, damZ);
      this.scene.add(pipe);
    }
    this._map.dam = { x: riverX(damZ), z: damZ, len: damLen };
    for (const s of [-1, 1]) {
      this.colliders.push({ x: riverX(damZ) + s * damLen * 0.3, z: damZ, r: damLen * 0.22, h: bedY + 10 });
    }
    this._blockers.push({ x: riverX(damZ), z: damZ, r: damLen / 2 + 2 });

    // ponds carry their basin record (x,z,rx,rz,seed) so the minimap + scatter
    // can draw/sample the organic outline; `r` kept for legacy consumers.
    const ponds = [
      { x: pondEB.x, z: pondEB.z, r: pondEB.rx, rx: pondEB.rx, rz: pondEB.rz, seed: pondEB.seed, depth: pondEB.depth, _b: pondEB },
      { x: pondWB.x, z: pondWB.z, r: pondWB.rx, rx: pondWB.rx, rz: pondWB.rz, seed: pondWB.seed, depth: pondWB.depth, _b: pondWB },
    ];
    for (const p of ponds) {
      this._addBlobWater(p._b, waterMat);
      this._map.ponds.push(p);
      this.duckAreas.push({ x: p.x, z: p.z, rx: p.rx * 0.7, rz: p.rz * 0.55 });
    }
    this.duckAreas.push({ x: lake.x, z: lake.z, rx: lake.rx * 0.6, rz: lake.rz * 0.55 });

    // waterfall plunge pool + the stream that carries its overflow to the lake
    this._addBlobWater(WFALL_POOL_SHAPE, waterMat);
    this._map.ponds.push({ x: WFALL_POOL.x, z: WFALL_POOL.z, r: WFALL_POOL.rx, rx: WFALL_POOL.rx, rz: WFALL_POOL.rz, seed: WFALL_POOL_SHAPE.seed });
    this._addStreamWater(WFALL_STREAM, waterMat, flowTex);
    this._buildWaterfall();

    this._ponds = ponds;
  }

  // A straight water strip along a segment (the pool→lake stream).
  _addStreamWater(s, mat, flowTex) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const half = s.w / 2 + 0.5;
    const steps = Math.max(2, Math.ceil(len / 5));
    const surfY = WATER_Y - 0.04;
    const bedY = -1.8;
    const pos = [];
    const uv = [];
    const idx = [];
    const wpos = [];
    const widx = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = s.x1 + dx * t;
      const cz = s.z1 + dz * t;
      const lx = cx + nx * half, lz = cz + nz * half;
      const rx = cx - nx * half, rz = cz - nz * half;
      pos.push(lx, surfY, lz, rx, surfY, rz);
      uv.push(0, (len * t) / 12, 1, (len * t) / 12);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const b = i * 4;
      wpos.push(lx, surfY, lz, lx, bedY, lz, rx, surfY, rz, rx, bedY, rz);
      if (i > 0) {
        const pb = (i - 1) * 4;
        widx.push(pb, pb + 1, b, pb + 1, b + 1, b);
        widx.push(pb + 2, b + 2, pb + 3, pb + 3, b + 2, b + 3);
      }
      this._stampWaterCircle(cx, cz, half + 1, 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(m);
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    wgeo.setIndex(widx);
    wgeo.computeVertexNormals();
    const wallMat = new THREE.MeshLambertMaterial({
      color: COLORS.waterDeep, transparent: true, opacity: 0.96, side: THREE.DoubleSide,
    });
    this._anim.waterMats.push(wallMat);
    this.scene.add(new THREE.Mesh(wgeo, wallMat));
  }

  // The premium waterfall: a wet darker streak down the rock, MULTIPLE layered
  // falling sheets at varied widths/speeds, a foam crest at the top lip,
  // churning whitewater + heavy mist at the base, splashing droplets, and
  // ripple rings spreading on the plunge pool. Everything it touches goes wet.
  _buildWaterfall() {
    const top = { x: -276, z: -280 };          // a notch high on the SE face
    const base = { x: WFALL_POOL.x, z: WFALL_POOL.z };
    const baseY = WATER_Y;
    const dx = base.x - top.x;
    const dz = base.z - top.z;
    const horiz = Math.hypot(dx, dz);
    const ux = dx / horiz;
    const uz = dz / horiz;
    const nx = -uz;                              // across-flow
    const nz = ux;
    const foamTex = makeFoamTexture();
    this._foamTex = foamTex;

    // helper: build one cascade sheet hugging the slope, at a given half-width
    // and lateral offset, returning {mesh, tex}.
    const buildSheet = (width, lateral, opacity, seed, uvScale) => {
      const steps = 18;
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = top.x + dx * t + nx * lateral;
        const cz = top.z + dz * t + nz * lateral;
        const groundHere = terrainHeight(cx, cz);
        const y = (i === steps) ? baseY + 0.4 : Math.max(groundHere + 0.35, baseY + 0.4);
        pos.push(cx + nx * width / 2, y, cz + nz * width / 2, cx - nx * width / 2, y, cz - nz * width / 2);
        uv.push(0, t * uvScale, 1, t * uvScale);
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const tex = makeFallTexture(seed);
      const mat = new THREE.MeshLambertMaterial({
        color: 0xeaf6ff, transparent: true, opacity, side: THREE.DoubleSide,
        map: tex, depthWrite: false,
      });
      mat.emissive = new THREE.Color(0xbfe2ff);
      mat.emissiveIntensity = 0.5;
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);
      return { tex };
    };

    // SMOOTH wet-rock stain hugging the slope BEHIND the falling sheets. Instead
    // of a hard-edged box, this is a soft alpha-faded decal: a band that hugs the
    // rock following the water's path, gently widening toward the plunge pool,
    // with a wet-stain alphaMap that feathers its sides + ends to zero so the
    // glossy wet rock blends into the dry rock as a gradient, not a sharp cut.
    {
      const steps = 30;
      const wTop = 7.5, wBot = 13;        // tapered: narrow at the lip, broad at the pool
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = top.x + dx * t;
        const cz = top.z + dz * t;
        const groundHere = terrainHeight(cx, cz);
        const y = Math.max(groundHere + 0.16, baseY + 0.18);
        const w = wTop + (wBot - wTop) * t;
        pos.push(cx + nx * w / 2, y, cz + nz * w / 2, cx - nx * w / 2, y, cz - nz * w / 2);
        uv.push(0, t, 1, t);              // u across the band, v down its length
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const stainTex = makeWetStainTexture();
      this._wetStainTex = stainTex;
      const wetMat = new THREE.MeshLambertMaterial({
        color: 0x3a4750, side: THREE.DoubleSide,
        transparent: true, alphaMap: stainTex, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      wetMat.emissive = new THREE.Color(0x1e2c38);
      wetMat.emissiveIntensity = 0.3;
      this.scene.add(new THREE.Mesh(geo, wetMat));
    }

    // THREE layered sheets: a broad back sheet, a main sheet, a thin fast
    // foreground ribbon — each scrolls at a different speed.
    this._wfallTexes = [];
    this._wfallTexes.push({ tex: buildSheet(7.5, 0, 0.78, 1, 6).tex, speed: 1.9 });
    this._wfallTexes.push({ tex: buildSheet(5.0, 0.4, 0.92, 7, 7).tex, speed: 2.6 });
    this._wfallTexes.push({ tex: buildSheet(2.2, -1.6, 0.85, 13, 9).tex, speed: 3.4 });
    // legacy single-tex handle kept for update() back-compat
    this._wfallTex = this._wfallTexes[1].tex;

    // foam crest sprites along the top lip
    this._crestFoam = [];
    const crestY = Math.max(terrainHeight(top.x, top.z) + 0.6, baseY + 0.4);
    for (let i = 0; i < 7; i++) {
      const s = (i / 6 - 0.5) * 8;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: foamTex, transparent: true, opacity: 0.9, depthWrite: false,
      }));
      const fx = top.x + nx * s + ux * 1.5;
      const fz = top.z + nz * s + uz * 1.5;
      spr.position.set(fx, crestY + 0.3, fz);
      spr.scale.set(3 + Math.random() * 1.5, 2.4, 1);
      this.scene.add(spr);
      this._crestFoam.push({ spr, phase: Math.random() * 6, base: crestY + 0.3 });
    }

    // churning whitewater puffs sitting on the plunge pool around the impact
    this._churn = [];
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 6;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: foamTex, transparent: true, opacity: 0.7, depthWrite: false,
      }));
      const cx = base.x + Math.cos(a) * r;
      const cz = base.z + Math.sin(a) * r;
      spr.position.set(cx, baseY + 0.5, cz);
      const sc = 2.5 + Math.random() * 2.5;
      spr.scale.set(sc, sc * 0.7, 1);
      this.scene.add(spr);
      this._churn.push({ spr, x: cx, z: cz, phase: Math.random() * 6, sc });
    }

    // heavy MIST column — two stacked translucent cylinders that slowly billow.
    this._mistMeshes = [];
    for (let layer = 0; layer < 2; layer++) {
      const mist = new THREE.Mesh(
        new THREE.CylinderGeometry(6.5 - layer, 3.5, 11 + layer * 3, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xeaf6ff, transparent: true, opacity: 0.14 - layer * 0.04,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
      mist.position.set(base.x, baseY + 5 + layer * 1.5, base.z);
      this.scene.add(mist);
      this._mistMeshes.push(mist);
    }

    // splashing droplets — fine fast particles flung up off the impact + the
    // persistent bobbing spray cloud (drives the existing update() logic).
    const N = 90;
    const sp = new Float32Array(N * 3);
    this._splashBase = new Float32Array(N * 3);
    this._splashVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 6;
      const x = base.x + Math.cos(a) * r;
      const z = base.z + Math.sin(a) * r;
      sp[i * 3] = this._splashBase[i * 3] = x;
      sp[i * 3 + 1] = this._splashBase[i * 3 + 1] = baseY + Math.random() * 4;
      sp[i * 3 + 2] = this._splashBase[i * 3 + 2] = z;
      this._splashVel[i] = 1 + Math.random() * 3;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const smat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2.4, sizeAttenuation: true, transparent: true,
      opacity: 0.9, depthWrite: false, map: foamTex,
    });
    this._splash = new THREE.Points(sgeo, smat);
    this.scene.add(this._splash);

    // ripple rings spreading out on the plunge pool surface
    this._ripples = [];
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0xeaf6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 24), rippleMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(base.x, baseY + 0.08, base.z);
      this.scene.add(ring);
      this._ripples.push({ mesh: ring, t: i / 4 });
    }

    // soft wet-ground decal draped over the rock around the plunge pool: a
    // dark, alpha-faded ring that grades the glossy wet rock smoothly out into
    // the dry rock (gradient, no hard cut). Drapes the terrain so it follows
    // the slope, and is rendered as a soft transparent overlay.
    {
      const SEG = 36, RINGS = 5;
      const innerR = WFALL_POOL.rx * 0.85;
      const outerR = WFALL_POOL.rx * 2.1;
      const aspect = WFALL_POOL.rz / WFALL_POOL.rx;
      // Additive-dark fade: a centre vertex alpha of ~0.55 ramps smoothly to 0
      // at the rim. We bake the fade into the vertex color and pair it with an
      // additive-style multiply so the wet darkening dissolves into dry rock.
      const pos = [], col = [], idx = [];
      const wetC = new THREE.Color(0x2a3942);
      for (let r = 0; r < RINGS; r++) {
        const rt = r / (RINGS - 1);
        const rad = innerR + (outerR - innerR) * rt;
        const k = (1 - rt);                       // 1 at pool → 0 at rim
        const fade = k * k * 0.55;                // eased, fully wet → dry
        for (let s = 0; s <= SEG; s++) {
          const ang = (s / SEG) * Math.PI * 2;
          const x = base.x + Math.cos(ang) * rad;
          const z = base.z + Math.sin(ang) * rad * aspect;
          pos.push(x, terrainHeight(x, z) + 0.07, z);
          // lerp from wet colour (centre) toward white (rim); under multiply
          // blending white = no change, so the wet tint dissolves to nothing.
          col.push(
            1 - (1 - wetC.r) * fade,
            1 - (1 - wetC.g) * fade,
            1 - (1 - wetC.b) * fade);
        }
      }
      const row = SEG + 1;
      for (let r = 0; r < RINGS - 1; r++) {
        for (let s = 0; s < SEG; s++) {
          const a0 = r * row + s, a1 = a0 + 1, b0 = a0 + row, b1 = b0 + 1;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      // MultiplyBlending darkens the ground underneath by the vertex colour, so
      // the centre reads wet and the rim leaves the dry rock untouched — a true
      // soft gradient with no hard boundary.
      const decalMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false,
        blending: THREE.MultiplyBlending, side: THREE.DoubleSide,
        vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.scene.add(new THREE.Mesh(geo, decalMat));
    }

    // wet glossy rocks ringing the plunge pool (darker than the dry scatter)
    const wetRockMat = new THREE.MeshLambertMaterial({ color: 0x5a6168 });
    wetRockMat.emissive = new THREE.Color(0x202a30);
    wetRockMat.emissiveIntensity = 0.22;
    const wetRocks = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const rr = WFALL_POOL.rx * (1.0 + Math.random() * 0.25);
      const x = base.x + Math.cos(a) * rr;
      const z = base.z + Math.sin(a) * rr * (WFALL_POOL.rz / WFALL_POOL.rx);
      wetRocks.push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.7 + Math.random() * 1.0 });
    }
    const wetRockTemplate = M.createRock(1);
    wetRockTemplate.traverse((o) => { if (o.isMesh) o.material = wetRockMat; });
    this._instance(wetRockTemplate, wetRocks);

    // sound anchor for main.js proximity loop
    this.waterfallPos = { x: base.x, y: baseY + 2, z: base.z };
  }

  // Organic pond/lake surface: an irregular blob polygon at WATER_Y matching
  // the carved basin outline, PLUS a short downward "skirt" wall ringing the
  // edge so that from a low angle you see a wet wall sinking into the bank, not
  // a floating disc edge. The surface is inset a hair so it tucks under the
  // raised bank crest (carved in terrain.js) with no visible gap.
  _addBlobWater(b, mat) {
    const SEG = 40;
    const surfMat = mat;
    // ---- top surface (triangle fan) ----
    const pos = [b.x, WATER_Y, b.z];          // center vertex
    const uv = [0.5, 0.5];
    const rim = [];                            // remember rim ring for the wall
    for (let i = 0; i <= SEG; i++) {
      const ang = (i / SEG) * Math.PI * 2;
      const rmul = blobRadius(b.seed, ang) * 0.995;   // tuck just under the bank
      const rx = b.rx * rmul;
      const rz = b.rz * rmul;
      const x = b.x + Math.cos(ang) * rx;
      const z = b.z + Math.sin(ang) * rz;
      pos.push(x, WATER_Y, z);
      uv.push(0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5);
      rim.push({ x, z });
    }
    const idx = [];
    for (let i = 1; i <= SEG; i++) idx.push(0, i, i + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, surfMat);
    m.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(m);

    // ---- skirt wall: a ribbon dropping from the rim down below the bed so no
    // see-through gap exists at the water's edge from low angles ----
    const wallBottom = WATER_Y - (b.depth || 2.4) - 0.5;
    const wpos = [];
    const widx = [];
    for (let i = 0; i < rim.length; i++) {
      const r = rim[i];
      wpos.push(r.x, WATER_Y, r.z, r.x, wallBottom, r.z);
    }
    for (let i = 0; i < rim.length - 1; i++) {
      const a = i * 2;
      widx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    wgeo.setIndex(widx);
    wgeo.computeVertexNormals();
    const wallMat = new THREE.MeshLambertMaterial({
      color: COLORS.waterDeep, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
    });
    wallMat.emissive = new THREE.Color(COLORS.waterDeep);
    wallMat.emissiveIntensity = 0.18;
    this._anim.waterMats.push(wallMat);
    const wall = new THREE.Mesh(wgeo, wallMat);
    this.scene.add(wall);

    this._stampWaterBlob(b);
  }

  // Kept for back-compat: route any ellipse request through the organic builder.
  _addEllipseWater(x, z, rx, rz, mat) {
    this._addBlobWater({ x, z, rx, rz, depth: 2.4, seed: x * 0.7 + z * 0.3 }, mat);
  }

  isWater(x, z) {
    if (x < -H || x >= H || z < -H || z >= H) return false;
    const gx = ((x + H) / CELL) | 0;
    const gz = ((z + H) / CELL) | 0;
    return this._water[gz * GRID_N + gx] === 1;
  }

  groundY(x, z) { return terrainHeight(x, z); }

  // ------------------------------------------------------------- roads
  // Draped ribbons that follow the terrain, with a worn double wheel-track.
  _road(x1, z1, x2, z2, w = 5) {
    this._roads.push({ x1, z1, x2, z2, w });
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(len / 6));
    const nx = -dz / len;       // ribbon normal
    const nz = dx / len;
    const cRoad = new THREE.Color(COLORS.road);
    const cEdge = new THREE.Color(COLORS.road).multiplyScalar(0.85);
    const cTrack = new THREE.Color(COLORS.road).multiplyScalar(0.72);

    // 5 verts across: edge, track, center, track, edge
    const ACROSS = [-0.5, -0.27, 0, 0.27, 0.5];
    const COLS = [cEdge, cTrack, cRoad, cTrack, cEdge];
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const pz = z1 + dz * t;
      for (let a = 0; a < ACROSS.length; a++) {
        const ox = nx * ACROSS[a] * w;
        const oz = nz * ACROSS[a] * w;
        pos.push(px + ox, terrainHeight(px + ox, pz + oz) + 0.09, pz + oz);
        col.push(COLS[a].r, COLS[a].g, COLS[a].b);
      }
      if (i > 0) {
        const r0 = (i - 1) * 5;
        const r1 = i * 5;
        for (let a = 0; a < 4; a++) {
          idx.push(r0 + a, r0 + a + 1, r1 + a, r0 + a + 1, r1 + a + 1, r1 + a);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(mesh);
  }

  _distToRoad(x, z) {
    let best = Infinity;
    for (const r of this._roads) {
      const dx = r.x2 - r.x1;
      const dz = r.z2 - r.z1;
      const L2 = dx * dx + dz * dz || 1;
      let t = ((x - r.x1) * dx + (z - r.z1) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (r.x1 + dx * t), z - (r.z1 + dz * t)) - r.w / 2;
      if (d < best) best = d;
    }
    return best;
  }

  _buildRoadNet() {
    const hub = { x: 40, z: -10 };
    const bridgeZ = [-40, 140, -290];
    for (const bz of bridgeZ) {
      const bx = riverX(bz);
      const blen = riverW(bz) + 16;     // span the wider water plus a bank seat each side
      const bankY = Math.max(
        terrainHeight(bx - blen / 2 - 2, bz),
        terrainHeight(bx + blen / 2 + 2, bz), 0.6);
      const bridge = M.createBridge(blen, 6);
      bridge.position.set(bx - blen / 2, bankY - 0.12, bz);
      this.scene.add(bridge);
      this._map.bridges.push({ x: bx, z: bz, len: blen });
      // road meets the deck flush at both banks
      this._roads.push({ x1: bx - blen / 2 - 1, z1: bz, x2: bx + blen / 2 + 1, z2: bz, w: 6 });
    }
    // east
    this._road(hub.x, hub.z, 200, -10);
    this._road(200, -10, 220, -200);
    this._road(200, -10, 330, 60);
    // west via bridge 1
    this._road(hub.x, hub.z, riverX(-40) + 8, -40);
    this._road(riverX(-40) - 8, -40, -200, -40);
    this._road(-200, -40, -200, 250);
    this._road(-200, 170, -255, 170);          // sheep meadow spur
    // south via bridge 2
    this._road(hub.x, hub.z, 60, 100);
    this._road(60, 100, riverX(140) + 8, 140);
    this._road(riverX(140) - 8, 140, -140, 140);
    // north via bridge 3
    this._road(hub.x, hub.z, 34, -70);
    this._road(34, -70, 34, -130);
    this._road(34, -130, riverX(-290) + 8, -290);
    this._road(riverX(-290) - 8, -290, -260, -290);
  }

  // ------------------------------------------------------------- terrain
  _buildGround() {
    const geo = new THREE.PlaneGeometry(2 * H, 2 * H, 160, 160);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const cA = new THREE.Color(COLORS.grassA);
    const cB = new THREE.Color(COLORS.grassB);
    const cC = new THREE.Color(COLORS.grassC);
    const cSand = new THREE.Color(COLORS.sand);
    const cField = new THREE.Color(COLORS.field);
    const cFieldDark = new THREE.Color(COLORS.field).multiplyScalar(0.8);
    const cRock = new THREE.Color(COLORS.rockGray);
    const cSnow = new THREE.Color(COLORS.snow);
    const cBed = new THREE.Color(0x5b4a36);
    const tmp = new THREE.Color();

    const fields = [
      { x0: 120, x1: 214, z0: 56, z1: 144, axis: 'x' },   // corn furrows
      { x0: 26, x1: 78, z0: 232, z1: 274, axis: 'z' },    // pumpkin patch
      { x0: 44, x1: 76, z0: -58, z1: -36, axis: 'x' },    // veg garden
    ];

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const h = terrainHeight(x, z);
      posAttr.setY(i, h);

      const row = Math.floor((z + H) / 8);
      tmp.copy(row % 2 === 0 ? cA : cB);
      const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      if (n - Math.floor(n) > 0.82) tmp.copy(cC);

      // big soft grass patches — lush light-green blotches and worn earthy ones
      const patch = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.7) +
                    0.6 * Math.sin((x + z) * 0.028);
      if (patch > 0.7) tmp.lerp(cC, 0.7);
      else if (patch < -0.95) tmp.lerp(cField, 0.4);

      // tilled fields with visible furrow stripes
      for (const f of fields) {
        if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) {
          const along = f.axis === 'x' ? z : x;
          tmp.copy(Math.floor(along / 4) % 2 === 0 ? cField : cFieldDark);
        }
      }

      // altitude shading: rocky slopes, then snow caps
      if (h > 34) tmp.copy(cSnow);
      else if (h > 16) tmp.lerp(cRock, Math.min(1, (h - 16) / 10));
      else if (h > 5) tmp.multiplyScalar(1 - Math.min(0.18, (h - 5) * 0.025));

      // rock striations + colour variation up the big mountain: alternating
      // warm/cool bands by altitude plus a noise mottle, so the cone reads as
      // layered stone rather than a flat grey wedge.
      const dMtn = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
      if (dMtn < MOUNTAIN.r && h > 12 && h <= 34) {
        const band = Math.sin(h * 0.55) * 0.5 + 0.5;          // horizontal strata
        tmp.lerp(cBed, band * 0.18);                           // warm brown bands
        const mottle = (Math.sin(x * 0.3 + 11) * Math.cos(z * 0.3 - 4));
        tmp.multiplyScalar(1 + mottle * 0.06);
        // WET darker streak where the waterfall runs down the SE face
        const wfTop = { x: -276, z: -280 };
        const wfBase = { x: WFALL_POOL.x, z: WFALL_POOL.z };
        const wdx = wfBase.x - wfTop.x, wdz = wfBase.z - wfTop.z;
        const wl2 = wdx * wdx + wdz * wdz;
        let wt = ((x - wfTop.x) * wdx + (z - wfTop.z) * wdz) / wl2;
        wt = wt < 0 ? 0 : wt > 1 ? 1 : wt;
        const wdist = Math.hypot(x - (wfTop.x + wdx * wt), z - (wfTop.z + wdz * wt));
        // Smoothstep falloff (not a linear hard cut) over a wider radius so the
        // baked wet rock fades gently into the dry stone — no visible boundary.
        const WET_R = 12;
        if (wdist < WET_R && h > WATER_LEVEL) {
          let k = 1 - wdist / WET_R;
          k = k * k * (3 - 2 * k);                              // smoothstep
          tmp.multiplyScalar(1 - k * 0.55);                    // darker = wet rock
        }
      }

      // sandy shores + visible riverbed
      if (h < WATER_LEVEL - 0.1) tmp.copy(cBed);
      else if (!this.isWater(x, z) &&
        (this.isWater(x + 6, z) || this.isWater(x - 6, z) ||
         this.isWater(x, z + 6) || this.isWater(x, z - 6))) {
        tmp.lerp(cSand, 0.6);
      }

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(ground);
  }

  // ------------------------------------------------------- placement utils
  _place(group, x, z, rotY = 0, opts = {}) {
    const y = terrainHeight(x, z);
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    this.scene.add(group);
    if (opts.collider) this.colliders.push({ x, z, r: opts.collider.r, h: y + opts.collider.h });
    this._blockers.push({ x, z, r: opts.block ?? opts.collider?.r ?? 2 });
    if (opts.map) this._map.buildings.push({ x, z, ...opts.map });
    return group;
  }

  _isFree(x, z, r) {
    if (Math.abs(x) > H - 6 || Math.abs(z) > H - 6) return false;
    if (this.isWater(x, z) || this.isWater(x + r, z) || this.isWater(x - r, z) ||
        this.isWater(x, z + r) || this.isWater(x, z - r)) return false;
    if (this._distToRoad(x, z) < r + 1.5) return false;
    for (const b of this._blockers) {
      const rr = b.r + r;
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < rr * rr) return false;
    }
    for (const c of this._clearRects) {
      if (Math.abs(x - c.x) < c.w / 2 + r && Math.abs(z - c.z) < c.d / 2 + r) return false;
    }
    return true;
  }

  _instance(templateGroup, placements) {
    if (placements.length === 0) return;
    templateGroup.updateMatrixWorld(true);
    const meshes = [];
    templateGroup.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const placeM = new THREE.Matrix4();
    const outM = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const pv = new THREE.Vector3();
    for (const m of meshes) {
      const im = new THREE.InstancedMesh(m.geometry, m.material, placements.length);
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        q.setFromAxisAngle(up, p.rotY || 0);
        const s = p.s || 1;
        sc.set(s, s, s);
        pv.set(p.x, p.y !== undefined ? p.y : terrainHeight(p.x, p.z), p.z);
        placeM.compose(pv, q, sc);
        outM.multiplyMatrices(placeM, m.matrixWorld);
        im.setMatrixAt(i, outM);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = ENABLE_SHADOWS && m.castShadow;
      im.receiveShadow = ENABLE_SHADOWS && m.receiveShadow;
      this.scene.add(im);
    }
  }

  // --------------------------------------------------------- farm compound
  _buildFarmCore() {
    this._place(M.createFarmhouse(), 16, -44, Math.PI, {
      collider: { r: 6.5, h: 9 }, map: { w: 11, d: 9, color: '#8a6d52' },
    });
    this._place(M.createBarn(), 72, 12, -Math.PI / 2, {
      collider: { r: 7.5, h: 10.5 }, map: { w: 13, d: 11, color: '#a33327' },
    });
    this._barnSpots = [{ x: 72, z: 12 }];
    this._place(M.createSilo(), 90, 4, 0, {
      collider: { r: 3.2, h: 13 }, map: { w: 6, d: 6, color: '#9aa3ad' },
    });
    const wm = this._place(M.createWindmill(), 102, -38, 0.6, {
      collider: { r: 2.2, h: 12 }, map: { w: 4, d: 4, color: '#b0926a' },
    });
    this._anim.windmillBlades = wm.userData.blades || null;
    // The well sits on the farmhouse lawn, clear of every road and the tractor route.
    this._place(M.createWell(), 54, -22, 0.3, { collider: { r: 1.6, h: 3.4 } });
    this._place(M.createMailbox(), 10, -36, Math.PI / 2, { block: 0.6 });
    this._place(M.createCar(), 2, -54, 0.25, { collider: { r: 2.6, h: 2.6 } });
    this._place(M.createCoop(), 30, 38, Math.PI, {
      collider: { r: 2.6, h: 3.2 }, map: { w: 4, d: 4, color: '#9c5b3c' },
    });
    this._fenceRect(30, 44, 22, 14, [1]);

    // vegetable garden block (x 44..76, z -58..-36) — clear of all roads
    const sunflowers = [];
    const pumpkins = [];
    for (let i = 0; i < 7; i++) sunflowers.push({ x: 46 + i * 4.4, z: -56, rotY: Math.random() * 0.6 });
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 6; i++) {
        pumpkins.push({ x: 48 + i * 4.6, z: -48 + r * 5.5, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.5 });
      }
    }
    this._instance(M.createSunflower(), sunflowers);
    this._instance(M.createPumpkin(), pumpkins);
    this._clearRects.push({ x: 60, z: -47, w: 34, d: 24 });
    this._map.fields.push({ x: 60, z: -47, w: 34, d: 24, color: '#6f5a33' });
  }

  _buildOutposts() {
    this._place(M.createBarn(), 224, -212, 0.2, {
      collider: { r: 7.5, h: 10.5 }, map: { w: 13, d: 11, color: '#a33327' },
    });
    this._barnSpots.push({ x: 224, z: -212 });
    const bales = [];
    for (let i = 0; i < 16; i++) {
      const x = 190 + Math.random() * 90;
      const z = -260 + Math.random() * 70;
      if (this._isFree(x, z, 2)) bales.push({ x, z, rotY: Math.random() * Math.PI, s: 0.85 + Math.random() * 0.4 });
    }
    this._instance(M.createHayBale(), bales);
    for (const b of bales) this._blockers.push({ x: b.x, z: b.z, r: 1.6 });
  }

  // --------------------------------------------------------------- fields
  _buildFields() {
    const corn = [];
    for (let x = 124; x <= 210; x += 4.2) {
      for (let z = 60; z <= 140; z += 3.4) {
        corn.push({ x: x + (Math.random() - 0.5) * 1.2, z: z + (Math.random() - 0.5) * 1.2, rotY: Math.random() * Math.PI, s: 0.85 + Math.random() * 0.35 });
      }
    }
    this._instance(M.createCornStalk(), corn);
    this._clearRects.push({ x: 167, z: 100, w: 94, d: 88 });
    this._map.fields.push({ x: 167, z: 100, w: 94, d: 88, color: '#7a6434' });
    for (const [sx, sz] of [[140, 80], [195, 122], [168, 100]]) {
      this._place(M.createScarecrow(), sx, sz, Math.random() * Math.PI * 2, { collider: { r: 0.6, h: 2.6 } });
    }

    const patch = [];
    for (let i = 0; i < 34; i++) {
      patch.push({ x: 30 + Math.random() * 44, z: 236 + Math.random() * 34, rotY: Math.random() * Math.PI, s: 0.7 + Math.random() * 0.7 });
    }
    this._instance(M.createPumpkin(), patch);
    this._clearRects.push({ x: 52, z: 253, w: 50, d: 42 });
    this._map.fields.push({ x: 52, z: 253, w: 50, d: 42, color: '#6f5a33' });

    const orchard = [];
    for (let gx = 0; gx < 6; gx++) {
      for (let gz = 0; gz < 5; gz++) {
        const x = -8 + gx * 15 + (Math.random() - 0.5) * 3;
        const z = 146 + gz * 15 + (Math.random() - 0.5) * 3;
        if (!this.isWater(x, z) && this._distToRoad(x, z) > 4) {
          orchard.push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.25 });
          this.colliders.push({ x, z, r: 1.4, h: terrainHeight(x, z) + 6 });
          this._blockers.push({ x, z, r: 1.8 });
        }
      }
    }
    this._instance(M.createTree(0), orchard);
    this._map.fields.push({ x: 30, z: 176, w: 95, d: 72, color: '#2f5d36' });
  }

  // -------------------------------------------------------------- pastures
  // A closed rectangular fence with ONE gate (default top edge). Each side is
  // divided into whole sections of an exact per-side length (len / round(len/4))
  // so corners always meet — no end-gaps, no holes. Sections of equal length
  // are instanced together; gate sections are skipped and not made solid.
  _fenceRect(cx, cz, w, d, gateSides = [0]) {
    const SEC = 4;
    const runs = [
      { x: cx - w / 2, z: cz - d / 2, len: w, rotY: 0 },             // top  (+x)
      { x: cx + w / 2, z: cz - d / 2, len: d, rotY: -Math.PI / 2 },  // right(+z)
      { x: cx - w / 2, z: cz + d / 2, len: w, rotY: 0 },             // bottom(+x)
      { x: cx - w / 2, z: cz - d / 2, len: d, rotY: -Math.PI / 2 },  // left (+z)
    ];
    const byLen = new Map();   // segLen(2dp) -> placements[]
    runs.forEach((run, side) => {
      const nSeg = Math.max(1, Math.round(run.len / SEC));
      const segLen = run.len / nSeg;
      const key = segLen.toFixed(2);
      if (!byLen.has(key)) byLen.set(key, []);
      const list = byLen.get(key);
      const gate = gateSides.includes(side) ? Math.floor(nSeg / 2) : -1;
      const ux = Math.cos(run.rotY);
      const uz = -Math.sin(run.rotY);
      for (let i = 0; i < nSeg; i++) {
        const sx = run.x + ux * (i * segLen);
        const sz = run.z + uz * (i * segLen);
        if (i === gate) continue;            // leave the gate open
        list.push({ x: sx, z: sz, rotY: run.rotY });
        this.fences.push({ x1: sx, z1: sz, x2: sx + ux * segLen, z2: sz + uz * segLen });
      }
    });
    for (const [key, placements] of byLen) {
      this._instance(M.createFenceSection(Number(key)), placements);
    }
    this._map.fenceRuns.push({ x: cx, z: cz, w, d });
  }

  /** True if moving (x0,z0)→(x1,z1) crosses a solid fence segment. */
  crossesFence(x0, z0, x1, z1) {
    const f = this.fences;
    for (let i = 0; i < f.length; i++) {
      const s = f[i];
      const d1x = x1 - x0, d1z = z1 - z0;
      const d2x = s.x2 - s.x1, d2z = s.z2 - s.z1;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.x1 - x0) * d2z - (s.z1 - z0) * d2x) / den;
      const u = ((s.x1 - x0) * d1z - (s.z1 - z0) * d1x) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
    return false;
  }

  _buildPastures() {
    const pastures = [
      { x: -190, z: -80, w: 64, d: 46, count: 9 },
      { x: 160, z: -70, w: 70, d: 50, count: 10 },
      { x: -120, z: 282, w: 60, d: 44, count: 8 },
      { x: 268, z: 118, w: 60, d: 50, count: 9 },
    ];
    for (const p of pastures) {
      this._fenceRect(p.x, p.z, p.w, p.d);
      this._clearRects.push({ x: p.x, z: p.z, w: p.w, d: p.d });
      this.cowSpawnAreas.push({ x: p.x, z: p.z, r: Math.min(p.w, p.d) / 2 - 4, count: p.count });
    }
    const fenced = pastures.reduce((s, p) => s + p.count, 0);
    const front = Math.min(8, CFG.COW_COUNT - fenced);
    this.cowSpawnAreas.push({ x: -28, z: 78, r: 22, count: front });
    this._clearRects.push({ x: -28, z: 78, w: 42, d: 42 });
    this.cowSpawnAreas.push({ x: -20, z: -200, r: 30, count: CFG.COW_COUNT - fenced - front });
    this._clearRects.push({ x: -20, z: -200, w: 56, d: 56 });

    // SHEEP meadow — a clear, open, fenced pasture plus surrounding flocks so
    // sheep are plentiful and visible. cows.js spawns `count` sheep per area, so
    // several areas give a full meadow well beyond the base CFG.SHEEP_COUNT.
    const sheepBase = CFG.SHEEP_COUNT;          // 10
    // main meadow with its own fence ring (gate on top) so it reads as a paddock
    this._fenceRect(-255, 170, 56, 46, [0]);
    this.sheepSpawnAreas.push({ x: -255, z: 170, r: 22, count: sheepBase + 6 });
    this._clearRects.push({ x: -255, z: 170, w: 60, d: 50 });
    // satellite flocks grazing the open grass around the meadow
    this.sheepSpawnAreas.push({ x: -210, z: 130, r: 16, count: 6 });
    this._clearRects.push({ x: -210, z: 130, w: 34, d: 34 });
    this.sheepSpawnAreas.push({ x: -290, z: 210, r: 16, count: 5 });
    this._clearRects.push({ x: -290, z: 210, w: 34, d: 34 });
    this.sheepSpawnAreas.push({ x: -200, z: 200, r: 14, count: 5 });
    this._clearRects.push({ x: -200, z: 200, w: 30, d: 30 });
  }

  // ----------------------------------------------------------- forest ring
  _buildForestRing() {
    const types = [[], [], []];
    const inner = H - 70;
    const outer = H - 8;
    const N = 760;
    for (let i = 0; i < N; i++) {
      const side = i % 4;
      let x, z;
      const t = Math.random() * 2 - 1;
      const depth = inner + Math.random() * (outer - inner);
      if (side === 0) { x = t * outer; z = -depth; }
      else if (side === 1) { x = t * outer; z = depth; }
      else if (side === 2) { x = -depth; z = t * outer; }
      else { x = depth; z = t * outer; }
      if (Math.abs(x - riverX(z)) < riverW(z) / 2 + 7) continue;
      const h = terrainHeight(x, z);
      if (h > 30) continue;       // treeline — snow caps stay bare
      const type = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 0 : 2;
      types[type].push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.5 });
      if (depth < inner + 14) this.colliders.push({ x, z, r: 1.5, h: h + (type === 0 ? 6 : 9) });
    }
    this._instance(M.createTree(0), types[0]);
    this._instance(M.createTree(1), types[1]);
    this._instance(M.createTree(2), types[2]);
    this._forestInner = inner;
  }

  // -------------------------------------------------------- deep dense forest
  // A lush forest filling the SE corner quadrant — far from the farm core and
  // every pasture. Tons of instanced trees (oak/pine/birch mix), an understory
  // of bushes + rocks, scattered fallen logs, and two open clearings. Trunk
  // colliders ring the forest edge so a low pass clips them; the dense interior
  // stays collider-light to keep things cheap. Everything is instanced.
  _buildForest() {
    // forest footprint (SE corner)
    const FX = 250, FZ = 250;       // center
    const FR = 130;                  // radius of the forest blob
    // two clearings to break up the canopy
    const clearings = [
      { x: 225, z: 215, r: 22 },
      { x: 300, z: 290, r: 26 },
    ];
    this._forestArea = { x: FX, z: FZ, r: FR };
    this._map.fields.push({ x: FX, z: FZ, w: FR * 1.6, d: FR * 1.6, color: '#1f4527' });

    const inClearing = (x, z) => clearings.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r);
    const inForest = (x, z) => {
      const d = Math.hypot(x - FX, z - FZ);
      // soft irregular edge so it isn't a perfect circle
      const edge = FR * (0.85 + 0.15 * Math.sin(Math.atan2(z - FZ, x - FX) * 3));
      return d < edge;
    };
    const nearEdge = (x, z) => Math.hypot(x - FX, z - FZ) > FR * 0.7;

    const trees = [[], [], []];   // oak / pine / birch
    const bushesA = [], bushesB = [];
    const rocks = [[], [], []];
    const logs = [];

    // dense tree fill — jittered grid for a packed-but-natural look
    const STEP = 7.5;
    for (let x = FX - FR; x <= FX + FR; x += STEP) {
      for (let z = FZ - FR; z <= FZ + FR; z += STEP) {
        const jx = x + (Math.random() - 0.5) * STEP * 0.9;
        const jz = z + (Math.random() - 0.5) * STEP * 0.9;
        if (!inForest(jx, jz)) continue;
        if (inClearing(jx, jz)) continue;
        if (!this._isFree(jx, jz, 1.6)) continue;       // respects water/roads/props/pastures
        if (terrainHeight(jx, jz) > 30) continue;        // treeline
        // pine-dominant deep forest with oak + birch mixed in
        const roll = Math.random();
        const type = roll < 0.55 ? 1 : roll < 0.82 ? 0 : 2;
        trees[type].push({ x: jx, z: jz, rotY: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.6 });
        this._blockers.push({ x: jx, z: jz, r: 1.6 });
        // collider only near the forest edge (cheap interior)
        if (nearEdge(jx, jz)) {
          this.colliders.push({ x: jx, z: jz, r: 1.4, h: terrainHeight(jx, jz) + (type === 0 ? 6 : 9) });
        }
        // understory: a bush tucked beside many trees
        if (Math.random() < 0.4) {
          const bx = jx + (Math.random() - 0.5) * 5;
          const bz = jz + (Math.random() - 0.5) * 5;
          (Math.random() < 0.5 ? bushesA : bushesB).push({ x: bx, z: bz, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.6 });
        }
      }
    }

    // mossy rocks + a few standalone bushes scattered through the floor
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * FR;
      const x = FX + Math.cos(a) * rr;
      const z = FZ + Math.sin(a) * rr;
      if (!inForest(x, z) || inClearing(x, z)) continue;
      if (!this._isFree(x, z, 1.2)) continue;
      if (Math.random() < 0.55) {
        rocks[(Math.random() * 3) | 0].push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.6 + Math.random() * 1.1 });
      } else {
        (Math.random() < 0.5 ? bushesA : bushesB).push({ x, z, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.6 });
      }
    }

    // fallen logs lying on the forest floor (reuse the river-log model, laid flat)
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * FR * 0.92;
      const x = FX + Math.cos(a) * rr;
      const z = FZ + Math.sin(a) * rr;
      if (!inForest(x, z) || inClearing(x, z)) continue;
      if (!this._isFree(x, z, 2)) continue;
      logs.push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.9 + Math.random() * 0.7 });
      this._blockers.push({ x, z, r: 1.6 });
    }

    this._instance(M.createTree(0), trees[0]);
    this._instance(M.createTree(1), trees[1]);
    this._instance(M.createTree(2), trees[2]);
    this._instance(M.createBush(0), bushesA);
    this._instance(M.createBush(1), bushesB);
    this._instance(M.createRock(0), rocks[0]);
    this._instance(M.createRock(1), rocks[1]);
    this._instance(M.createRock(2), rocks[2]);
    this._instance(M.createLog(), logs);

    this._forestTreeCount = trees[0].length + trees[1].length + trees[2].length;
  }

  // ---------------------------------------------------------------- scatter
  _buildScatter() {
    const lone = [[], [], []];
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() * 2 - 1) * (H - 90);
      const z = (Math.random() * 2 - 1) * (H - 90);
      if (!this._isFree(x, z, 3)) continue;
      const type = (Math.random() * 3) | 0;
      lone[type].push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.85 + Math.random() * 0.45 });
      this.colliders.push({ x, z, r: 1.4, h: terrainHeight(x, z) + (type === 0 ? 6 : type === 1 ? 9 : 8) });
      this._blockers.push({ x, z, r: 2 });
      if (Math.random() < 0.5) {
        const bx = x + (Math.random() - 0.5) * 8;
        const bz = z + (Math.random() - 0.5) * 8;
        if (this._isFree(bx, bz, 1)) this._bushList.push({ x: bx, z: bz, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.5 });
      }
    }
    this._instance(M.createTree(0), lone[0]);
    this._instance(M.createTree(1), lone[1]);
    this._instance(M.createTree(2), lone[2]);

    const bushesA = this._bushList.filter((_, i) => i % 2 === 0);
    const bushesB = this._bushList.filter((_, i) => i % 2 === 1);
    for (let i = 0; i < 70; i++) {
      const x = (Math.random() * 2 - 1) * (H - 60);
      const z = (Math.random() * 2 - 1) * (H - 60);
      if (!this._isFree(x, z, 1.2)) continue;
      (i % 2 ? bushesA : bushesB).push({ x, z, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.6 });
    }
    this._instance(M.createBush(0), bushesA);
    this._instance(M.createBush(1), bushesB);

    const rocks = [[], [], []];
    for (let i = 0; i < 55; i++) {
      const nearWater = i < 30;
      let x, z;
      if (nearWater) {
        const p = this._riverPts[(Math.random() * this._riverPts.length) | 0];
        x = p.x + (Math.random() < 0.5 ? -1 : 1) * (p.w / 2 + 3 + Math.random() * 6);
        z = p.z + (Math.random() - 0.5) * 8;
      } else {
        x = (Math.random() * 2 - 1) * (H - 60);
        z = (Math.random() * 2 - 1) * (H - 60);
      }
      if (!this._isFree(x, z, 1.2)) continue;
      rocks[(Math.random() * 3) | 0].push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.7 + Math.random() * 0.9 });
    }
    this._instance(M.createRock(0), rocks[0]);
    this._instance(M.createRock(1), rocks[1]);
    this._instance(M.createRock(2), rocks[2]);

    const cattails = [];
    const lilyMat = M.mat(0x3e8e4e);
    for (const p of [...this._ponds, { x: this._map.lake.x, z: this._map.lake.z, r: this._map.lake.rx }]) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const rr = p.r * (0.95 + Math.random() * 0.25);
        const x = p.x + Math.cos(a) * rr;
        const z = p.z + Math.sin(a) * rr * 0.82;
        if (!this.isWater(x, z)) cattails.push({ x, z, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.5 });
      }
      for (let i = 0; i < 5; i++) {
        const lily = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 7), lilyMat);
        lily.position.set(p.x + (Math.random() - 0.5) * p.r, WATER_Y + 0.06, p.z + (Math.random() - 0.5) * p.r * 0.7);
        this.scene.add(lily);
        this._anim.lilies.push({ mesh: lily, phase: Math.random() * 6 });
      }
    }
    this._instance(M.createCattail(), cattails);
  }

  // Scattered grass tufts — loose fill across open grass plus denser clumps,
  // skipping water, roads, fields, buildings and the rocky high ground.
  _buildGrass() {
    const buckets = GRASS_PALETTE.map(() => []);   // one placement list per colour
    const tryAdd = (x, z) => {
      if (Math.abs(x) > H - 20 || Math.abs(z) > H - 20) return;
      if (this.isWater(x, z)) return;
      if (terrainHeight(x, z) > 15) return;          // bare rock/snow up high
      if (this._distToRoad(x, z) < 3) return;
      for (const c of this._clearRects) {
        if (Math.abs(x - c.x) < c.w / 2 && Math.abs(z - c.z) < c.d / 2) return;
      }
      for (const b of this._blockers) {
        if ((x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + 1) ** 2) return;
      }
      buckets[grassRegion(x, z)].push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.7 + Math.random() * 0.9 });
    };
    // loose fill
    for (let i = 0; i < 1400; i++) {
      tryAdd((Math.random() * 2 - 1) * (H - 20), (Math.random() * 2 - 1) * (H - 20));
    }
    // denser clumps
    for (let p = 0; p < 64; p++) {
      const cx = (Math.random() * 2 - 1) * (H - 60);
      const cz = (Math.random() * 2 - 1) * (H - 60);
      const n = 6 + ((Math.random() * 8) | 0);
      for (let i = 0; i < n; i++) {
        tryAdd(cx + (Math.random() - 0.5) * 12, cz + (Math.random() - 0.5) * 12);
      }
    }
    // one instanced batch per colour so different spots grow different grass
    for (let b = 0; b < buckets.length; b++) {
      if (buckets[b].length) this._instance(makeGrassTuft(_grassMats[b]), buckets[b]);
    }
  }

  // Clothe the giant mountain: pines + a few oaks on the lower slopes, boulders
  // on the mid slopes, bare rock/snow up top (from the ground shader). Steep
  // colliders near the base so a low pass clips the rock.
  _buildMountainDecor() {
    const pines = [];
    const oaks = [];
    const rocks = [];
    for (let i = 0; i < 240; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 18 + Math.random() * (MOUNTAIN.r - 24);
      const x = MOUNTAIN.x + Math.cos(a) * rr;
      const z = MOUNTAIN.z + Math.sin(a) * rr;
      if (Math.abs(x) > H - 6 || Math.abs(z) > H - 6) continue;
      if (this.isWater(x, z)) continue;
      const h = terrainHeight(x, z);
      if (h < 4) continue;
      if (h < 30) {
        (Math.random() < 0.78 ? pines : oaks).push(
          { x, z, rotY: Math.random() * Math.PI * 2, s: 0.7 + Math.random() * 0.55 });
        if (rr < 40) this.colliders.push({ x, z, r: 1.5, h: h + 8 });
      } else if (h < 64) {
        rocks.push({ x, z, rotY: Math.random() * Math.PI * 2, s: 1.3 + Math.random() * 1.8 });
      }
    }
    this._instance(M.createTree(1), pines);
    this._instance(M.createTree(0), oaks);
    this._instance(M.createRock(0), rocks);

    // Extra surface detail: craggy rock OUTCROP slabs studded up the cone so the
    // face reads as layered, broken stone (striations) rather than a smooth wedge.
    const outcrops = [];
    const stoneMat = M.mat(COLORS.rockGray, true);
    const dkStoneMat = M.mat(0x70777c, true);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 22 + Math.random() * (MOUNTAIN.r - 30);
      const x = MOUNTAIN.x + Math.cos(a) * rr;
      const z = MOUNTAIN.z + Math.sin(a) * rr;
      if (Math.abs(x) > H - 4 || Math.abs(z) > H - 4) continue;
      const h = terrainHeight(x, z);
      if (h < 14 || h > 70) continue;
      outcrops.push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.9 + Math.random() * 1.6 });
    }
    // a simple angular slab template (flat-ish wedge) for striation crags
    const slab = new THREE.Group();
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.3), stoneMat);
    s1.rotation.z = 0.3; slab.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.0), dkStoneMat);
    s2.position.set(0.6, 0.7, 0.2); s2.rotation.z = -0.25; slab.add(s2);
    this._instance(slab, outcrops);
  }

  // More life and craft along the water: a working water mill beside the dam,
  // docks on the lake and a pond, drifting logs in the river, reed clusters,
  // and a railed dam crest with a spillway sheet on the downstream face.
  _buildRiverDetail() {
    const dam = this._map.dam;

    // water mill on the bank just beside the dam, wheel over the spillway
    const millX = dam.x + dam.len / 2 + 3;
    const millZ = dam.z + 2;
    const mill = M.createWaterMill();
    mill.position.set(millX, terrainHeight(millX, millZ), millZ);
    mill.rotation.y = -Math.PI / 2;
    this.scene.add(mill);
    this._blockers.push({ x: millX, z: millZ, r: 3 });
    this.colliders.push({ x: millX, z: millZ, r: 2.4, h: terrainHeight(millX, millZ) + 4 });
    this._anim.watermillWheel = mill.userData.wheel || null;
    this._map.buildings.push({ x: millX, z: millZ, w: 4, d: 4, color: '#9c7a4d' });

    // dam railing + downstream spillway sheet
    this._buildDamDetail(dam);

    // docks reaching into the lake and the SE pond
    const lake = this._map.lake;
    this._placeDock(lake.x + lake.rx * 0.5, lake.z + lake.rz * 0.4, Math.atan2(-lake.rx, -lake.rz));
    if (this._ponds[0]) this._placeDock(this._ponds[0].x - this._ponds[0].r * 0.6, this._ponds[0].z, Math.PI / 2);

    // drifting + bobbing logs in the river
    this._anim.logs = [];
    for (let i = 0; i < 5; i++) {
      const z = -260 + i * 110 + (Math.random() - 0.5) * 40;
      const log = M.createLog();
      log.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(log);
      const e = { group: log, z, speed: 3 + Math.random() * 2.5, phase: Math.random() * 6 };
      this._placeLog(e, 0);
      this._anim.logs.push(e);
    }

    // reed clusters hugging the banks
    const reeds = [];
    for (let z = -H + 60; z < H - 60; z += 26) {
      for (const side of [-1, 1]) {
        const x = riverX(z) + side * (riverW(z) / 2 + 1.5 + Math.random() * 2);
        if (!this.isWater(x, z) && terrainHeight(x, z) < 2) {
          reeds.push({ x, z, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.5 });
        }
      }
    }
    this._instance(M.createCattail(), reeds);
  }

  _placeDock(x, z, rotY) {
    const dock = M.createDock();
    dock.position.set(x, WATER_Y, z);
    dock.rotation.y = rotY;
    this.scene.add(dock);
    this._blockers.push({ x, z, r: 3 });
  }

  _placeLog(e, dt) {
    e.z += e.speed * dt;
    if (e.z > H - 40) e.z = -H + 40;
    const x = riverX(e.z);
    e.group.position.set(x, WATER_Y, e.z);
  }

  _buildDamDetail(dam) {
    const y = this.groundY(dam.x, dam.z);   // riverbed under the dam
    const crestY = y + 9;
    const railMat = M.mat(COLORS.woodDark);
    const n = Math.floor(dam.len / 3);
    for (let i = 0; i <= n; i++) {
      const x = dam.x - dam.len / 2 + i * 3;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), railMat);
      post.position.set(x, crestY + 0.6, dam.z + 4.2);
      this.scene.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(dam.len, 0.16, 0.16), railMat);
    rail.position.set(dam.x, crestY + 1.1, dam.z + 4.2);
    this.scene.add(rail);

    // ---- DAM SPILLWAY: reservoir water genuinely POURING over the downstream
    // face — rebuilt to match the main mountain waterfall. The water is modelled
    // as a CURVED, voluminous nappe (a tessellated curved strip) that arcs up and
    // over the crest lip and curves down the face to the river: it is NOT a flat
    // vertical panel. Layered translucent sheets scroll a flow texture along the
    // fall direction and ripple gently per frame; heavy foam at the crest lip,
    // churning whitewater + mist/spray at the base, falling droplets down the
    // face, and spreading ripple rings on the river just below.
    // The crest cap sits at z = dam.z, depth 8.4 → its downstream lip is at
    // dam.z + 4.2; water leaves there, arcs forward and plunges to WATER_Y.
    const crestLipZ = dam.z + 4.2;          // downstream edge of the crest cap
    const lipY = crestY + 0.55;             // a touch above the cap so it tips over
    const fallBot = WATER_Y + 0.3;           // meet the river surface
    const plungeZ = crestLipZ + 4.4;         // where the nappe lands on the river
    const faceZ = crestLipZ;                 // anchor for foam/churn placement
    const fallH = lipY - fallBot;
    const spillW = dam.len - 4;
    const foamTex = this._foamTex || makeFoamTexture();

    // Nappe profile: as t goes 0→1 the sheet rises slightly over the lip, then
    // accelerates downward (water falls faster with depth) while arcing FORWARD
    // (+z) like a projectile, finally flattening into the plunge. Returns the
    // {y,z} centreline of the curved sheet at parameter t.
    const nappeProfile = (t) => {
      // vertical: gentle over the lip (t small) then plunging — eased power curve.
      const drop = Math.pow(t, 1.65);
      let y = lipY + 0.35 * Math.sin(t * Math.PI * 0.6)   // tiny bulge up over the lip
              - (lipY - fallBot) * drop;
      // forward arc: leaves the lip, bulges out, settles at the plunge point.
      const fwd = crestLipZ + (plungeZ - crestLipZ) * (0.35 * t + 0.65 * drop);
      return { y, z: fwd };
    };

    // Build ONE curved sheet: a tessellated strip following the nappe profile,
    // tapering slightly toward the base, normals computed so it catches light.
    // `bulge` pushes the sheet's own surface a little proud of the centreline
    // (toward +z) to give the falling water volume rather than a paper-thin plane.
    const buildNappe = (width, opacity, seed, uvScale, bulge, glow) => {
      const STEPS = 22, COLS = 8;
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const p = nappeProfile(t);
        const w = width * (1 - 0.18 * t);          // narrows a touch as it falls
        for (let c = 0; c <= COLS; c++) {
          const u = c / COLS;
          const x = dam.x + (u - 0.5) * w;
          // round the cross-section forward so the sheet reads as voluminous,
          // not flat: max bulge at the centre column, tapering to the edges.
          const edge = 1 - (2 * u - 1) * (2 * u - 1);
          pos.push(x, p.y, p.z + bulge * edge);
          uv.push(u, t * uvScale);
        }
        if (i > 0) {
          const r0 = (i - 1) * (COLS + 1), r1 = i * (COLS + 1);
          for (let c = 0; c < COLS; c++) {
            idx.push(r0 + c, r0 + c + 1, r1 + c, r0 + c + 1, r1 + c + 1, r1 + c);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const tex = makeFallTexture(seed);
      const mat = new THREE.MeshLambertMaterial({
        color: 0xeaf6ff, transparent: true, opacity, side: THREE.DoubleSide,
        map: tex, depthWrite: false,
      });
      mat.emissive = new THREE.Color(0xcfe6ff);
      mat.emissiveIntensity = glow;
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);
      // store base positions + grid dims so update() can ripple the surface.
      return {
        tex, geo,
        base: Float32Array.from(pos),
        steps: STEPS, cols: COLS, bulge,
      };
    };

    // Layered nappe sheets: a broad bright back sheet, a fuller main sheet, and
    // a thin fast foreground ribbon — each scrolls at its own speed so the water
    // visibly rushes; the back sheet is brightest (lit through the falling water).
    this._spillSheets = [];
    this._spillNappes = [];
    const reg = (n, speed, rip) => {
      this._spillSheets.push({ tex: n.tex, speed });
      this._spillNappes.push({ ...n, speed: rip });
    };
    reg(buildNappe(spillW, 0.62, 2, 5, 0.55, 0.55), 1.9, 6.0);
    reg(buildNappe(spillW * 0.82, 0.85, 9, 6, 0.9, 0.5), 2.6, 7.0);
    reg(buildNappe(spillW * 0.4, 0.8, 15, 7, 1.25, 0.45), 3.4, 8.5);
    // back-compat handle for any existing update() reference
    this._anim.spillTex = this._spillSheets[1].tex;

    // heavy FOAM at the crest lip — the white turbulence where the reservoir
    // water tips over the edge. A dense row of overlapping foam puffs sitting on
    // the lip, bobbing + pulsing each frame.
    this._spillCrestFoam = [];
    for (let i = 0; i < 12; i++) {
      const x = dam.x + ((i / 11) - 0.5) * (spillW + 2);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: foamTex, transparent: true, opacity: 0.95, depthWrite: false,
      }));
      const baseY = lipY + 0.15;
      spr.position.set(x, baseY, crestLipZ + 0.1);
      const sc = 2.8 + Math.random() * 1.6;
      spr.scale.set(sc, sc * 0.7, 1);
      this.scene.add(spr);
      this._spillCrestFoam.push({ spr, base: baseY, phase: Math.random() * 6, sc });
    }

    // Falling DROPLET particles streaming down the curved face — fine points
    // that ride the nappe profile from lip to plunge and recycle, so the spill
    // visibly pours and moves even up close.
    {
      const ND = 80;
      const dp = new Float32Array(ND * 3);
      this._spillDropT = new Float32Array(ND);     // progress 0→1 down the face
      this._spillDropU = new Float32Array(ND);     // lateral position across width
      this._spillDropSpeed = new Float32Array(ND);
      for (let i = 0; i < ND; i++) {
        const t = Math.random();
        const u = Math.random();
        this._spillDropT[i] = t;
        this._spillDropU[i] = u;
        this._spillDropSpeed[i] = 0.5 + Math.random() * 0.8;
        const p = nappeProfile(t);
        dp[i * 3] = dam.x + (u - 0.5) * spillW * (1 - 0.18 * t);
        dp[i * 3 + 1] = p.y;
        dp[i * 3 + 2] = p.z + 0.6;
      }
      const dgeo = new THREE.BufferGeometry();
      dgeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      const dmat = new THREE.PointsMaterial({
        color: 0xffffff, size: 1.7, sizeAttenuation: true, transparent: true,
        opacity: 0.9, depthWrite: false, map: foamTex,
      });
      this._spillDrops = new THREE.Points(dgeo, dmat);
      this.scene.add(this._spillDrops);
      // remember the profile + width so update() can advance the droplets along
      // the SAME curve the sheets follow.
      this._spillDropProfile = nappeProfile;
      this._spillDropW = spillW;
      this._spillDropX = dam.x;
    }

    // churning whitewater puffs where the curved nappe hits the river (heavy at
    // the plunge line). These pulse + bob each frame for a roiling whitewater read.
    this._spillChurn = [];
    for (let i = 0; i < 16; i++) {
      const x = dam.x + (Math.random() - 0.5) * spillW * 1.15;
      const z = plungeZ - 1.5 + Math.random() * 3.5;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: foamTex, transparent: true, opacity: 0.75, depthWrite: false,
      }));
      spr.position.set(x, WATER_Y + 0.5, z);
      const sc = 2.4 + Math.random() * 2.4;
      spr.scale.set(sc, sc * 0.7, 1);
      this.scene.add(spr);
      this._spillChurn.push({ spr, phase: Math.random() * 6, sc });
    }

    // mist/spray cloud billowing above the plunge line where the water lands.
    this._spillMist = [];
    for (let layer = 0; layer < 2; layer++) {
      const mist = new THREE.Mesh(
        new THREE.CylinderGeometry(spillW * 0.5 - layer, spillW * 0.32, 6 + layer * 2, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xeaf6ff, transparent: true, opacity: 0.12 - layer * 0.04,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
      mist.position.set(dam.x, WATER_Y + 3 + layer * 1.2, plungeZ);
      this.scene.add(mist);
      this._spillMist.push(mist);
    }

    // ripple rings spreading out on the river just below the plunge line.
    this._spillRipples = [];
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xeaf6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.3, 22), rMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(dam.x, WATER_Y + 0.06, plungeZ + 0.5);
      this.scene.add(ring);
      this._spillRipples.push({ mesh: ring, t: i / 4 });
    }
  }

  // ---------------------------------------------------------------- tractor
  _buildTractor() {
    const tractor = M.createTractor();
    this.scene.add(tractor);
    // Out-and-back patrol strictly along road centerlines — props are placed
    // clear of roads, so the tractor can never clip anything.
    const path = [
      { x: 40, z: -10 }, { x: 200, z: -10 }, { x: 40, z: -10 },
      { x: 60, z: 100 }, { x: 40, z: -10 }, { x: 34, z: -70 },
    ];
    this._anim.tractor = { group: tractor, path, seg: 0, t: 0, speed: 4.5 };
    // Live tractor position, refreshed every frame in update(). Exposed so
    // main.js can drive a positional engine sound that tracks the patrol.
    const start = path[0];
    tractor.position.set(start.x, terrainHeight(start.x, start.z) + 0.08, start.z);
    this.tractorPos = { x: start.x, y: terrainHeight(start.x, start.z) + 0.08, z: start.z };
  }

  // ----------------------------------------------------------------- stable
  // A horse stable on open, dry, in-bounds ground just SW of the corn field and
  // west of the east pasture — clear of every road, building, pasture and the
  // veg garden (verified flat ~y=1). One stable building (collider + minimap +
  // blocker), a fenced paddock beside it with a gate facing the stable, and a
  // few horses standing/grazing on the terrain inside. Horses are static decor
  // groups; `world.horsePos` exposes a representative one so main.js can play a
  // proximity "disturbed" whinny. GUARDED on M.createStable / M.createHorse so
  // the build never throws while those models are still being added.
  _buildStable() {
    // Paddock occupies x[86,118], z[-76,-48]; the stable sits just south of it.
    const padCx = 102, padCz = -62, padW = 32, padD = 28;
    const stableX = 102, stableZ = -82, stableRotY = 0;   // door faces +z (the paddock)

    if (M.createStable && this._isFree(stableX, stableZ, 8)) {
      // Place the stable building: collider so the UFO can't fly through it, a
      // blocker so scatter/grass/props avoid it, and a minimap footprint.
      this._place(M.createStable(), stableX, stableZ, stableRotY, {
        collider: { r: 7, h: 9 },
        map: { w: 14, d: 10, color: '#6b4f3a' },
      });
    } else if (!M.createStable) {
      return;   // model not yet available — skip the whole stable area cleanly
    }

    // Fenced paddock beside the stable. Gate on the BOTTOM (south) edge so it
    // opens toward the stable door. Reuses the shared fence helper (registers
    // solid fence segments for crossesFence + draws a minimap fence run).
    this._fenceRect(padCx, padCz, padW, padD, [2]);
    this._clearRects.push({ x: padCx, z: padCz, w: padW, d: padD });

    // Scatter a few horses (3–5) grazing/standing inside the paddock, kept off
    // the fence lines and spaced apart. Static decor — no AI.
    if (M.createHorse) {
      const count = 4;
      const inset = 4.5;                       // keep horses off the rails
      const placed = [];
      let firstX = padCx, firstZ = padCz;      // fallback paddock centre
      let attempt = 0;
      while (placed.length < count && attempt < 80) {
        attempt++;
        const x = padCx + (Math.random() * 2 - 1) * (padW / 2 - inset);
        const z = padCz + (Math.random() * 2 - 1) * (padD / 2 - inset);
        let ok = true;
        for (const p of placed) {
          if ((x - p.x) ** 2 + (z - p.z) ** 2 < 7 * 7) { ok = false; break; }
        }
        if (!ok) continue;
        const horse = M.createHorse();
        horse.position.set(x, terrainHeight(x, z), z);
        horse.rotation.y = Math.random() * Math.PI * 2;   // facing random ways
        this.scene.add(horse);
        placed.push({ x, z });
        if (placed.length === 1) { firstX = x; firstZ = z; }
      }
      // Representative horse (the paddock centre, anchored on the first horse)
      // for main.js proximity audio.
      this.horsePos = { x: firstX, y: terrainHeight(firstX, firstZ), z: firstZ };
    } else {
      // Stable exists but horse model not ready: expose the paddock centre so
      // consumers always have a valid horsePos to read.
      this.horsePos = { x: padCx, y: terrainHeight(padCx, padCz), z: padCz };
    }

    // Remember the stable for the minimap (drawn explicitly as a distinct icon
    // in addition to its building footprint).
    this._map.stable = { x: stableX, z: stableZ, w: 14, d: 10, padCx, padCz, padW, padD };
  }

  // ---------------------------------------------------------------- wildlife
  _buildWildlife() {
    // Owls perched on pasture fence corners — they flee when the UFO closes in.
    const owlSpots = this._map.fenceRuns.flatMap((f) => [
      { x: f.x - f.w / 2, z: f.z - f.d / 2 },
      { x: f.x + f.w / 2, z: f.z + f.d / 2 },
    ]);
    for (let i = 0; i < Math.min(6, owlSpots.length); i++) {
      const s = owlSpots[(Math.random() * owlSpots.length) | 0];
      const owl = M.createOwl();
      const y = terrainHeight(s.x, s.z) + 1.15;     // on the post cap
      owl.position.set(s.x, y, s.z);
      owl.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(owl);
      this._anim.owls.push({ group: owl, home: { x: s.x, y, z: s.z }, state: 'perch', t: 0, vx: 0, vz: 0 });
    }

    // Bats circling the barns at night.
    for (const b of this._barnSpots) {
      for (let i = 0; i < 3; i++) {
        const bat = M.createBat();
        this.scene.add(bat);
        this._anim.bats.push({
          group: bat, cx: b.x, cz: b.z,
          r: 7 + Math.random() * 6, h: 11 + Math.random() * 4,
          a: Math.random() * Math.PI * 2, speed: 1.2 + Math.random() * 0.8,
        });
      }
    }

  }

  // ----------------------------------------------------------------- spawns
  _defineSpawns() {
    this.chickenSpawnAreas = [
      { x: 30, z: 44, r: 9, count: Math.ceil(CFG.CHICKEN_COUNT * 0.6) },
      { x: 18, z: -20, r: 10, count: Math.floor(CFG.CHICKEN_COUNT * 0.4) },
    ];
    this.farmerSpawns = [
      { x: 58, z: 0, patrolRadius: 42 },
      { x: 167, z: 52, patrolRadius: 38 },
      { x: 224, z: -190, patrolRadius: 40 },
      { x: -150, z: 230, patrolRadius: 45 },
    ];
    this._goldenSpots = [
      { x: 30, z: 176 },
      { x: 52, z: 253 },
      { x: this._map.lake.x + this._map.lake.rx + 12, z: this._map.lake.z },
      { x: 210, z: 152 },
      { x: -20, z: -200 },
      { x: 244, z: -240 },
      { x: -190, z: -80 },
    ];
  }

  // A fresh open spawn each round: dry, low ground, clear of props, water,
  // the mountain and farmer patrols.
  randomSpawn() {
    for (let i = 0; i < 80; i++) {
      const x = (Math.random() * 2 - 1) * 260;
      const z = (Math.random() * 2 - 1) * 260;
      if (this.isWater(x, z)) continue;
      if (terrainHeight(x, z) > 16) continue;          // not up the mountain
      let ok = true;
      for (const b of this._blockers) {
        if ((x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + 5) ** 2) { ok = false; break; }
      }
      if (!ok) continue;
      for (const f of this.farmerSpawns) {
        if ((x - f.x) ** 2 + (z - f.z) ** 2 < 32 * 32) { ok = false; break; }
      }
      if (!ok) continue;
      return { x, z };
    }
    return { x: 0, z: 40 };
  }

  goldenCowSpot() {
    for (let tries = 0; tries < 12; tries++) {
      const s = this._goldenSpots[(Math.random() * this._goldenSpots.length) | 0];
      const x = s.x + (Math.random() - 0.5) * 14;
      const z = s.z + (Math.random() - 0.5) * 14;
      if (!this.isWater(x, z)) return { x, z };
    }
    return { x: 0, z: -120 };
  }

  // ---------------------------------------------------------------- minimap
  drawMinimap(ctx, sizePx) {
    const k = sizePx / (2 * H);
    const px = (x) => (x + H) * k;
    const py = (z) => (z + H) * k;

    ctx.fillStyle = '#16301c';
    ctx.fillRect(0, 0, sizePx, sizePx);

    // mountain rim then forest band
    ctx.fillStyle = '#43494f';
    const mband = (H - 330) * k;
    ctx.fillRect(0, 0, sizePx, mband);
    ctx.fillRect(0, sizePx - mband, sizePx, mband);
    ctx.fillRect(0, 0, mband, sizePx);
    ctx.fillRect(sizePx - mband, 0, mband, sizePx);
    ctx.fillStyle = '#0e2113';
    const band = (H - this._forestInner) * k;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, sizePx, band);
    ctx.fillRect(0, sizePx - band, sizePx, band);
    ctx.fillRect(0, 0, band, sizePx);
    ctx.fillRect(sizePx - band, 0, band, sizePx);
    ctx.globalAlpha = 1;

    // the dense SE forest patch
    if (this._forestArea) {
      const f = this._forestArea;
      ctx.fillStyle = '#13361d';
      ctx.beginPath();
      ctx.arc(px(f.x), py(f.z), f.r * 0.95 * k, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#8a7445';
    ctx.lineWidth = Math.max(1, 4 * k);
    for (const r of this._roads) {
      ctx.beginPath();
      ctx.moveTo(px(r.x1), py(r.z1));
      ctx.lineTo(px(r.x2), py(r.z2));
      ctx.stroke();
    }

    ctx.strokeStyle = '#3f7fd6';
    ctx.lineWidth = Math.max(2, 13 * k);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this._riverPts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))));
    ctx.stroke();

    // Lake + ponds drawn as their ORGANIC blob outlines (same blobRadius the
    // basins are carved/filled with) so the minimap matches the real shapes.
    ctx.fillStyle = '#3f7fd6';
    const drawBlob = (b) => {
      const seed = b.seed !== undefined ? b.seed : b.x * 0.7 + b.z * 0.3;
      const rx = b.rx !== undefined ? b.rx : b.r;
      const rz = b.rz !== undefined ? b.rz : (b.r * 0.82);
      ctx.beginPath();
      const SEG = 28;
      for (let i = 0; i <= SEG; i++) {
        const ang = (i / SEG) * Math.PI * 2;
        const rmul = blobRadius(seed, ang);
        const x = px(b.x + Math.cos(ang) * rx * rmul);
        const y = py(b.z + Math.sin(ang) * rz * rmul);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };
    drawBlob(this._map.lake);
    for (const p of this._map.ponds) drawBlob(p);

    const dam = this._map.dam;
    ctx.fillStyle = '#9e9e9e';
    ctx.fillRect(px(dam.x - dam.len / 2), py(dam.z - 4), dam.len * k, 8 * k);

    ctx.fillStyle = '#8d6e63';
    for (const b of this._map.bridges) {
      ctx.fillRect(px(b.x - b.len / 2), py(b.z - 3), b.len * k, 6 * k);
    }

    for (const b of this._map.buildings) {
      ctx.fillStyle = b.color || '#8a6d52';
      ctx.fillRect(px(b.x - b.w / 2), py(b.z - b.d / 2), Math.max(2, b.w * k), Math.max(2, b.d * k));
    }

    // Stable + horse paddock: a dashed paddock outline plus a distinct stable
    // marker so the horse area reads clearly on the minimap.
    const st = this._map.stable;
    if (st) {
      ctx.strokeStyle = '#8a6d52';
      ctx.lineWidth = Math.max(1, 1.5 * k);
      ctx.strokeRect(px(st.padCx - st.padW / 2), py(st.padCz - st.padD / 2),
        st.padW * k, st.padD * k);
      ctx.fillStyle = '#6b4f3a';
      ctx.fillRect(px(st.x - st.w / 2), py(st.z - st.d / 2),
        Math.max(2, st.w * k), Math.max(2, st.d * k));
    }
  }

  // ------------------------------------------------------------------ anim
  update(dt, elapsed, cycle, ufoPos) {
    const a = this._anim;
    if (a.windmillBlades) a.windmillBlades.rotation.z += dt * 1.4;

    // Water glows brighter at night so the river always reads as water, not a
    // dark gully, while staying natural in daylight.
    const nightBoost = cycle ? cycle.nightGlow : 0;
    for (const m of a.waterMats) {
      m.emissiveIntensity = 0.3 + nightBoost * 0.5 + Math.sin(elapsed * 1.3) * 0.07;
    }
    if (this._flowTex) {
      this._flowTex.offset.y = (this._flowTex.offset.y - dt * 0.35) % 1;
      this._flowTex.offset.x = Math.sin(elapsed * 0.6) * 0.04;
    }
    // waterfall: layered sheets scroll at their own speeds; foam crest bobs;
    // churn pulses; mist billows; ripples spread; droplets fling up and reset.
    if (this._wfallTexes) {
      for (const s of this._wfallTexes) s.tex.offset.y = (s.tex.offset.y - dt * s.speed) % 1;
    } else if (this._wfallTex) {
      this._wfallTex.offset.y = (this._wfallTex.offset.y - dt * 2.4) % 1;
    }
    // dam spillway: the curved nappe scrolls its flow texture along the fall
    // direction AND its surface ripples per frame; crest foam bobs, droplets
    // pour down the face, churn pulses at the plunge, mist billows, ripples
    // spread — mirrors the main waterfall.
    if (this._spillSheets) {
      for (const s of this._spillSheets) s.tex.offset.y = (s.tex.offset.y - dt * s.speed) % 1;
    } else if (this._anim.spillTex) {
      this._anim.spillTex.offset.y = (this._anim.spillTex.offset.y - dt * 2.1) % 1;
    }
    // gentle surface ripple on each curved nappe sheet — nudge each vertex's z
    // off its stored base by a travelling wave so the falling water shimmers and
    // never reads as a static panel. Cheap: a sin per vertex on a small grid.
    if (this._spillNappes) {
      for (const n of this._spillNappes) {
        const arr = n.geo.attributes.position.array;
        const base = n.base;
        const cols = n.cols + 1;
        const amp = 0.18 + n.bulge * 0.12;
        for (let i = 0; i <= n.steps; i++) {
          const t = i / n.steps;
          for (let c = 0; c < cols; c++) {
            const vi = (i * cols + c) * 3;
            const w = Math.sin(elapsed * n.speed + t * 9 + c * 0.7) * amp * (0.3 + t);
            arr[vi + 2] = base[vi + 2] + w;             // ripple along the fall (z)
            arr[vi + 1] = base[vi + 1] + w * 0.25;      // tiny vertical jitter
          }
        }
        n.geo.attributes.position.needsUpdate = true;
      }
    }
    // falling droplets ride the nappe profile from lip to plunge, then recycle.
    if (this._spillDrops && this._spillDropProfile) {
      const arr = this._spillDrops.geometry.attributes.position.array;
      const prof = this._spillDropProfile;
      for (let i = 0, j = 0; j < this._spillDropT.length; i += 3, j++) {
        let t = this._spillDropT[j] + dt * this._spillDropSpeed[j];
        if (t >= 1) { t -= 1; this._spillDropU[j] = Math.random(); }
        this._spillDropT[j] = t;
        const p = prof(t);
        const u = this._spillDropU[j];
        arr[i] = this._spillDropX + (u - 0.5) * this._spillDropW * (1 - 0.18 * t)
                 + Math.sin(elapsed * 5 + j) * 0.25;
        arr[i + 1] = p.y;
        arr[i + 2] = p.z + 0.6 + Math.sin(elapsed * 4 + j) * 0.15;
      }
      this._spillDrops.geometry.attributes.position.needsUpdate = true;
    }
    if (this._spillCrestFoam) {
      for (const f of this._spillCrestFoam) {
        f.spr.position.y = f.base + Math.sin(elapsed * 4 + f.phase) * 0.22;
        const p = 0.85 + Math.sin(elapsed * 4.5 + f.phase) * 0.18;
        f.spr.scale.set(f.sc * p, f.sc * 0.7 * p, 1);
        f.spr.material.opacity = 0.7 + Math.abs(Math.sin(elapsed * 3 + f.phase)) * 0.3;
      }
    }
    if (this._spillChurn) {
      for (const c of this._spillChurn) {
        const p = 0.85 + Math.sin(elapsed * 3.5 + c.phase) * 0.25;
        c.spr.scale.set(c.sc * p, c.sc * 0.7 * p, 1);
        c.spr.position.y = WATER_Y + 0.5 + Math.abs(Math.sin(elapsed * 4 + c.phase)) * 0.4;
      }
    }
    if (this._spillMist) {
      for (let i = 0; i < this._spillMist.length; i++) {
        const m = this._spillMist[i];
        m.rotation.y += dt * (0.15 + i * 0.1);
        m.material.opacity = (0.12 - i * 0.03) + Math.sin(elapsed * 0.8 + i) * 0.03;
      }
    }
    if (this._spillRipples) {
      for (const rp of this._spillRipples) {
        rp.t = (rp.t + dt * 0.4) % 1;
        const s = 1 + rp.t * 6;
        rp.mesh.scale.set(s, s, 1);
        rp.mesh.material.opacity = 0.5 * (1 - rp.t);
      }
    }
    if (this._crestFoam) {
      for (const f of this._crestFoam) {
        f.spr.position.y = f.base + Math.sin(elapsed * 4 + f.phase) * 0.25;
        f.spr.material.opacity = 0.7 + Math.abs(Math.sin(elapsed * 3 + f.phase)) * 0.3;
      }
    }
    if (this._churn) {
      for (const c of this._churn) {
        const p = 0.85 + Math.sin(elapsed * 3.5 + c.phase) * 0.25;
        c.spr.scale.set(c.sc * p, c.sc * 0.7 * p, 1);
        c.spr.position.y = WATER_Y + 0.5 + Math.abs(Math.sin(elapsed * 4 + c.phase)) * 0.4;
      }
    }
    if (this._mistMeshes) {
      for (let i = 0; i < this._mistMeshes.length; i++) {
        const m = this._mistMeshes[i];
        m.rotation.y += dt * (0.15 + i * 0.1);
        m.material.opacity = (0.12 - i * 0.03) + Math.sin(elapsed * 0.8 + i) * 0.03;
      }
    }
    if (this._ripples) {
      for (const rp of this._ripples) {
        rp.t = (rp.t + dt * 0.4) % 1;
        const s = 1 + rp.t * (WFALL_POOL.rx * 0.8);
        rp.mesh.scale.set(s, s, 1);
        rp.mesh.material.opacity = 0.5 * (1 - rp.t);
      }
    }
    if (this._splash) {
      const arr = this._splash.geometry.attributes.position.array;
      const base = this._splashBase;
      const vel = this._splashVel;
      for (let j = 0, i = 1; i < arr.length; i += 3, j++) {
        const v = vel ? vel[j] : 2;
        arr[i] = base[i] + (Math.abs(Math.sin(elapsed * (1.5 + v) + i)) ** 2) * 2.6;
      }
      this._splash.geometry.attributes.position.needsUpdate = true;
    }
    if (this._anim.watermillWheel) this._anim.watermillWheel.rotation.x += dt * 1.1;
    if (this._anim.logs) {
      for (const e of this._anim.logs) {
        this._placeLog(e, dt);
        e.group.position.y = WATER_Y + Math.sin(elapsed * 1.4 + e.phase) * 0.13; // bob
        e.group.rotation.z = Math.sin(elapsed * 0.9 + e.phase) * 0.06;
      }
    }
    for (const l of a.lilies) {
      l.mesh.position.y = WATER_Y + 0.06 + Math.sin(elapsed * 1.6 + l.phase) * 0.05;
    }

    // tractor — advance along the patrol, then ALWAYS re-derive the current
    // position (even on the frame a segment wraps) so the live `tractorPos`
    // handed to main.js for positional engine sound never stalls or jumps.
    const tr = a.tractor;
    if (tr) {
      let p0 = tr.path[tr.seg];
      let p1 = tr.path[(tr.seg + 1) % tr.path.length];
      const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      tr.t += (tr.speed * dt) / segLen;
      if (tr.t >= 1) {
        tr.t -= 1;
        tr.seg = (tr.seg + 1) % tr.path.length;
        p0 = tr.path[tr.seg];
        p1 = tr.path[(tr.seg + 1) % tr.path.length];
      }
      const x = p0.x + (p1.x - p0.x) * tr.t;
      const z = p0.z + (p1.z - p0.z) * tr.t;
      const y = terrainHeight(x, z) + 0.08;
      tr.group.position.set(x, y, z);
      const target = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      let diff = target - tr.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      tr.group.rotation.y += diff * Math.min(1, dt * 4);
      const wheels = tr.group.userData.wheels;
      if (wheels) for (const w of wheels) w.rotation.x += dt * 3;
      // live position for main.js positional engine sound
      this.tractorPos.x = x;
      this.tractorPos.y = y;
      this.tractorPos.z = z;
    }

    // owls: perch → flee when the UFO is near → glide home later
    for (const o of a.owls) {
      if (o.state === 'perch') {
        o.group.position.y = o.home.y + Math.sin(elapsed * 2 + o.home.x) * 0.04;
        if (ufoPos) {
          const d2 = (ufoPos.x - o.home.x) ** 2 + (ufoPos.z - o.home.z) ** 2;
          if (d2 < 14 * 14) {
            o.state = 'flee';
            o.t = 0;
            const ang = Math.atan2(o.home.x - ufoPos.x, o.home.z - ufoPos.z);
            o.vx = Math.sin(ang) * 14;
            o.vz = Math.cos(ang) * 14;
            o.group.rotation.y = ang;
          }
        }
      } else if (o.state === 'flee') {
        o.t += dt;
        o.group.position.x += o.vx * dt;
        o.group.position.z += o.vz * dt;
        o.group.position.y += dt * 6 * Math.max(0, 1.5 - o.t);
        const w = o.group.userData.wings;
        if (w) {
          const flap = Math.sin(o.t * 18) * 0.8;
          w[0].rotation.z = flap;
          w[1].rotation.z = -flap;
        }
        if (o.t > 4) { o.state = 'away'; o.t = 0; o.group.visible = false; }
      } else { // away → return after a rest
        o.t += dt;
        if (o.t > 22) {
          o.state = 'perch';
          o.group.visible = true;
          o.group.position.set(o.home.x, o.home.y, o.home.z);
          const w = o.group.userData.wings;
          if (w) { w[0].rotation.z = 0; w[1].rotation.z = 0; }
        }
      }
    }

    // bats: circle the barns, night creatures
    const batsOut = !cycle || cycle.nightGlow > 0.3;
    for (const b of a.bats) {
      b.group.visible = batsOut;
      if (!batsOut) continue;
      b.a += dt * b.speed;
      const x = b.cx + Math.cos(b.a) * b.r;
      const z = b.cz + Math.sin(b.a) * b.r;
      b.group.position.set(x, terrainHeight(b.cx, b.cz) + b.h + Math.sin(b.a * 3) * 1.2, z);
      b.group.rotation.y = -b.a;
      const w = b.group.userData.wings;
      if (w) {
        const flap = Math.sin(elapsed * 14 + b.r) * 0.9;
        w[0].rotation.z = flap;
        w[1].rotation.z = -flap;
      }
    }

  }
}
