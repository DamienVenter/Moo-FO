// MOO-FO — js/world.js
// Builds the entire 800×800 night farm: terrain, river + dam + ponds, roads,
// farm compound, fields, orchard, pastures, forest ring, decor (instanced),
// plus colliders, water lookup, spawn areas and the minimap painter.

import * as THREE from 'three';
import { CFG, COLORS, ENABLE_SHADOWS } from './config.js';
import * as M from './models.js';

const H = CFG.MAP_HALF;            // 400
const CELL = 4;                    // water-grid cell size
const GRID_N = (H * 2) / CELL;     // 200

// River centerline (x as a function of z). Stays in the west half.
function riverX(z) {
  return -120 + 60 * Math.sin(z * 0.005 + 0.5) + 30 * Math.sin(z * 0.0021 - 0.4);
}
function riverW(z) {
  return 12 + 3 * Math.sin(z * 0.011 + 2.0);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.cowSpawnAreas = [];
    this.chickenSpawnAreas = [];
    this.farmerSpawns = [];

    // --- internals ---
    this._water = new Uint8Array(GRID_N * GRID_N);
    this._roads = [];        // {x1,z1,x2,z2,w}
    this._blockers = [];     // {x,z,r} placement occupancy (includes buildings)
    this._clearRects = [];   // {x,z,w,d} keep decor out (pasture interiors, fields)
    this._map = {            // recorded shapes for the minimap
      ponds: [], lake: null, buildings: [], fields: [], bridges: [], fenceRuns: [], dam: null,
    };
    this._anim = { windmillBlades: null, tractor: null, waterMats: [], lilies: [] };
    this._goldenSpots = [];

    this._buildWater();      // fills grid + meshes (must run before placement)
    this._buildRoads();
    this._buildGround();
    this._buildFarmCore();
    this._buildOutposts();
    this._buildFields();
    this._buildPastures();
    this._buildForestRing();
    this._buildScatter();
    this._buildTractor();
    this._defineSpawns();
  }

  // ------------------------------------------------------------- water
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
    const waterMat = new THREE.MeshLambertMaterial({ color: COLORS.water });
    waterMat.emissive = new THREE.Color(COLORS.waterDeep);
    waterMat.emissiveIntensity = 0.25;
    this._anim.waterMats.push(waterMat);

    // River ribbon (triangle strip along sampled centerline).
    const pts = [];
    for (let z = -H; z <= H; z += 8) pts.push({ x: riverX(z), z, w: riverW(z) });
    const pos = [];
    const idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      pos.push(p.x - p.w / 2, 0.06, p.z, p.x + p.w / 2, 0.06, p.z);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      this._stampWaterCircle(p.x, p.z, p.w / 2 + 1, 5);
    }
    const riverGeo = new THREE.BufferGeometry();
    riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    riverGeo.setIndex(idx);
    riverGeo.computeVertexNormals();
    const river = new THREE.Mesh(riverGeo, waterMat);
    river.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(river);
    this._riverPts = pts;

    // Dam + reservoir lake upstream of it.
    const damZ = -150;
    const lake = { x: riverX(-195), z: -198, rx: 46, rz: 40 };
    this._map.lake = lake;
    this._addEllipseWater(lake.x, lake.z, lake.rx, lake.rz, waterMat);

    const damLen = riverW(damZ) + 26;
    const dam = new THREE.Mesh(
      new THREE.BoxGeometry(damLen, 6, 7),
      M.mat(COLORS.stone)
    );
    dam.position.set(riverX(damZ), 3, damZ);
    this.scene.add(dam);
    // crest walkway + blocks for chunky look
    const crest = new THREE.Mesh(new THREE.BoxGeometry(damLen + 2, 1.2, 8.4), M.mat(0xb5b5b5));
    crest.position.set(riverX(damZ), 6.2, damZ);
    this.scene.add(crest);
    this._map.dam = { x: riverX(damZ), z: damZ, len: damLen };
    for (let s = -1; s <= 1; s += 2) {
      this.colliders.push({ x: riverX(damZ) + s * damLen * 0.3, z: damZ, r: damLen * 0.22, h: 7 });
    }
    this._blockers.push({ x: riverX(damZ), z: damZ, r: damLen / 2 + 2 });

    // Two ponds.
    const ponds = [{ x: 210, z: 185, r: 23 }, { x: -305, z: 70, r: 17 }];
    for (const p of ponds) {
      this._addEllipseWater(p.x, p.z, p.r, p.r * 0.82, waterMat);
      this._map.ponds.push(p);
    }
    this._ponds = ponds;
  }

  _addEllipseWater(x, z, rx, rz, mat) {
    const geo = new THREE.CircleGeometry(1, 26);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(rx, 1, rz);
    m.position.set(x, 0.06, z);
    m.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(m);
    this._stampWaterCircle(x, z, rx, rz);
  }

  isWater(x, z) {
    if (x < -H || x >= H || z < -H || z >= H) return false;
    const gx = ((x + H) / CELL) | 0;
    const gz = ((z + H) / CELL) | 0;
    return this._water[gz * GRID_N + gx] === 1;
  }

  // ------------------------------------------------------------- roads
  _road(x1, z1, x2, z2, w = 5) {
    this._roads.push({ x1, z1, x2, z2, w });
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const geo = new THREE.PlaneGeometry(len + w * 0.6, w);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, M.mat(COLORS.road));
    m.position.set((x1 + x2) / 2, 0.035, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    m.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(m);
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

  _buildRoads() {
    const hub = { x: 40, z: -10 };
    // bridges across the river
    const bridgeZ = [-40, 140, -290];
    this._bridgeAt = [];
    for (const bz of bridgeZ) {
      const bx = riverX(bz);
      const blen = riverW(bz) + 8;
      const bridge = M.createBridge(blen, 5);
      bridge.position.set(bx - blen / 2, 0, bz);
      this.scene.add(bridge);
      this._map.bridges.push({ x: bx, z: bz, len: blen });
      this._bridgeAt.push({ x: bx, z: bz });
      // clear road-strip across the bridge so decor stays away
      this._roads.push({ x1: bx - blen / 2 - 2, z1: bz, x2: bx + blen / 2 + 2, z2: bz, w: 6 });
    }
    // main road net (hub → bridges and outposts)
    this._road(hub.x, hub.z, riverX(-40) + 8, -40);          // west to bridge 1
    this._road(riverX(-40) - 8, -40, -200, -40);             // beyond bridge 1
    this._road(-200, -40, -200, 250);                        // west spur south
    this._road(hub.x, hub.z, 60, 100);                       // south toward corn
    this._road(60, 100, riverX(140) + 8, 140);               // to bridge 2
    this._road(riverX(140) - 8, 140, -140, 140);             // west from bridge 2
    this._road(hub.x, hub.z, 200, -10);                      // east avenue
    this._road(200, -10, 220, -200);                         // NE to second barn
    this._road(hub.x, hub.z, 40, -120);                      // north lane
    this._road(40, -120, riverX(-290) + 8, -290);            // to bridge 3 (dam overlook)
    this._road(riverX(-290) - 8, -290, -260, -290);          // far west
    this._road(200, -10, 330, 60);                           // east field track
  }

  // ------------------------------------------------------------- terrain
  _buildGround() {
    const geo = new THREE.PlaneGeometry(2 * H, 2 * H, 100, 100);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const cA = new THREE.Color(COLORS.grassA);
    const cB = new THREE.Color(COLORS.grassB);
    const cC = new THREE.Color(COLORS.grassC);
    const cSand = new THREE.Color(COLORS.sand);
    const cField = new THREE.Color(COLORS.field);
    const tmp = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      // Crossy-style alternating rows with occasional bright patches
      const row = Math.floor((z + H) / 8);
      tmp.copy(row % 2 === 0 ? cA : cB);
      const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      if (n - Math.floor(n) > 0.82) tmp.copy(cC);
      // tilled-earth tint inside crop fields
      if ((x > 120 && x < 214 && z > 56 && z < 144) ||      // corn field
          (x > 26 && x < 78 && z > 232 && z < 274) ||       // pumpkin patch
          (x > 36 && x < 68 && z > -56 && z < -34)) {       // veg garden
        tmp.lerp(cField, 0.55);
      }
      // sandy shores near any water
      if (!this.isWater(x, z) &&
          (this.isWater(x + 6, z) || this.isWater(x - 6, z) ||
           this.isWater(x, z + 6) || this.isWater(x, z - 6))) {
        tmp.lerp(cSand, 0.6);
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = ENABLE_SHADOWS;
    this.scene.add(ground);
  }

  // ------------------------------------------------------- placement utils
  _place(group, x, z, rotY = 0, opts = {}) {
    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    this.scene.add(group);
    if (opts.collider) this.colliders.push({ x, z, r: opts.collider.r, h: opts.collider.h });
    this._blockers.push({ x, z, r: opts.block ?? opts.collider?.r ?? 2 });
    if (opts.map) this._map.buildings.push({ x, z, ...opts.map });
    return group;
  }

  _isFree(x, z, r) {
    if (Math.abs(x) > H - 6 || Math.abs(z) > H - 6) return false;
    if (this.isWater(x, z) || this.isWater(x + r, z) || this.isWater(x - r, z) ||
        this.isWater(x, z + r) || this.isWater(x, z - r)) return false;
    if (this._distToRoad(x, z) < r + 1) return false;
    for (const b of this._blockers) {
      const rr = b.r + r;
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < rr * rr) return false;
    }
    for (const c of this._clearRects) {
      if (Math.abs(x - c.x) < c.w / 2 + r && Math.abs(z - c.z) < c.d / 2 + r) return false;
    }
    return true;
  }

  // Instancing helper: bake one factory group into InstancedMeshes.
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
        pv.set(p.x, p.y || 0, p.z);
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
    this._place(M.createSilo(), 90, 4, 0, {
      collider: { r: 3.2, h: 13 }, map: { w: 6, d: 6, color: '#9aa3ad' },
    });
    this._place(M.createWindmill(), 102, -38, 0.6, {
      collider: { r: 2.2, h: 12 }, map: { w: 4, d: 4, color: '#b0926a' },
    });
    const wm = this.scene.children[this.scene.children.length - 1];
    this._anim.windmillBlades = wm.userData.blades || null;
    this._place(M.createWell(), 38, -16, 0.3, { collider: { r: 1.6, h: 3.4 } });
    this._place(M.createMailbox(), 8, -34, Math.PI / 2, { block: 0.6 });
    this._place(M.createCar(), 2, -52, 0.25, { collider: { r: 2.6, h: 2.6 } });
    this._place(M.createCoop(), 30, 38, Math.PI, {
      collider: { r: 2.6, h: 3.2 }, map: { w: 4, d: 4, color: '#9c5b3c' },
    });
    // chicken run fence
    this._fenceRect(30, 44, 22, 14, [1]);
    // lantern-lit path
    const lanternSpots = [[24, -28], [44, -2], [58, 4], [10, -22], [52, -32], [88, -22]];
    for (const [lx, lz] of lanternSpots) {
      this._place(M.createLanternPost(), lx, lz, 0, { collider: { r: 0.5, h: 3.4 } });
    }
    // vegetable garden: sunflower border + pumpkin rows
    const sunflowers = [];
    const pumpkins = [];
    for (let i = 0; i < 7; i++) sunflowers.push({ x: 38 + i * 4.4, z: -56, rotY: Math.random() * 0.6 });
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 6; i++) {
        pumpkins.push({ x: 40 + i * 4.6, z: -44 + r * 5.5, rotY: Math.random() * Math.PI, s: 0.8 + Math.random() * 0.5 });
      }
    }
    this._instance(M.createSunflower(), sunflowers);
    this._instance(M.createPumpkin(), pumpkins);
    this._clearRects.push({ x: 52, z: -48, w: 36, d: 22 });
    this._map.fields.push({ x: 52, z: -48, w: 36, d: 22, color: '#6f5a33' });
  }

  _buildOutposts() {
    this._place(M.createBarn(), 224, -212, 0.2, {
      collider: { r: 7.5, h: 10.5 }, map: { w: 13, d: 11, color: '#a33327' },
    });
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
    // Corn field with scarecrows
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

    // Pumpkin patch
    const patch = [];
    for (let i = 0; i < 34; i++) {
      patch.push({ x: 30 + Math.random() * 44, z: 236 + Math.random() * 34, rotY: Math.random() * Math.PI, s: 0.7 + Math.random() * 0.7 });
    }
    this._instance(M.createPumpkin(), patch);
    this._clearRects.push({ x: 52, z: 253, w: 50, d: 42 });
    this._map.fields.push({ x: 52, z: 253, w: 50, d: 42, color: '#6f5a33' });

    // Apple orchard (grid of oaks)
    const orchard = [];
    for (let gx = 0; gx < 6; gx++) {
      for (let gz = 0; gz < 5; gz++) {
        const x = -8 + gx * 15 + (Math.random() - 0.5) * 3;
        const z = 146 + gz * 15 + (Math.random() - 0.5) * 3;
        if (!this.isWater(x, z)) {
          orchard.push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.25 });
          this.colliders.push({ x, z, r: 1.4, h: 6 });
          this._blockers.push({ x, z, r: 1.8 });
        }
      }
    }
    this._instance(M.createTree(0), orchard);
    this._map.fields.push({ x: 30, z: 176, w: 95, d: 72, color: '#2f5d36' });
  }

  // -------------------------------------------------------------- pastures
  _fenceRect(cx, cz, w, d, gateSides = [0, 2]) {
    const SEC = 4;
    const runs = [
      { x: cx - w / 2, z: cz - d / 2, len: w, rotY: 0 },               // north (side 0)
      { x: cx + w / 2, z: cz - d / 2, len: d, rotY: -Math.PI / 2 },    // east  (side 1)
      { x: cx - w / 2, z: cz + d / 2, len: w, rotY: 0 },               // south (side 2)
      { x: cx - w / 2, z: cz - d / 2, len: d, rotY: -Math.PI / 2 },    // west  (side 3)
    ];
    const placements = [];
    runs.forEach((run, side) => {
      const n = Math.floor(run.len / SEC);
      const gate = gateSides.includes(side) ? Math.floor(n / 2) : -1;
      for (let i = 0; i < n; i++) {
        if (i === gate) continue;
        const along = i * SEC;
        placements.push({
          x: run.x + Math.cos(run.rotY) * along,
          z: run.z - Math.sin(run.rotY) * along,
          rotY: run.rotY,
        });
      }
    });
    this._instance(M.createFenceSection(SEC), placements);
    this._map.fenceRuns.push({ x: cx, z: cz, w, d });
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
    // open meadow herds (no fence) — one right by the player spawn for instant action
    const fenced = pastures.reduce((s, p) => s + p.count, 0);
    const front = Math.min(8, CFG.COW_COUNT - fenced);
    this.cowSpawnAreas.push({ x: -28, z: 78, r: 22, count: front });
    this._clearRects.push({ x: -28, z: 78, w: 42, d: 42 });
    this.cowSpawnAreas.push({ x: -20, z: -200, r: 30, count: CFG.COW_COUNT - fenced - front });
    this._clearRects.push({ x: -20, z: -200, w: 56, d: 56 });
  }

  // ----------------------------------------------------------- forest ring
  _buildForestRing() {
    const types = [[], [], []];
    const inner = H - 70;   // 330
    const outer = H - 8;    // 392
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
      // keep the river mouth clear
      if (Math.abs(x - riverX(z)) < riverW(z) / 2 + 7) continue;
      const type = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 0 : 2;
      types[type].push({ x, z, rotY: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.5 });
      if (depth < inner + 14) this.colliders.push({ x, z, r: 1.5, h: type === 0 ? 6 : 9 });
    }
    this._instance(M.createTree(0), types[0]);
    this._instance(M.createTree(1), types[1]);
    this._instance(M.createTree(2), types[2]);
    this._forestInner = inner;
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
      this.colliders.push({ x, z, r: 1.4, h: type === 0 ? 6 : type === 1 ? 9 : 8 });
      this._blockers.push({ x, z, r: 2 });
      // bushes huddle near trees
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
      // rocks favour the water's edge
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

    // cattails + lily pads at ponds and the lake shore
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
        lily.position.set(p.x + (Math.random() - 0.5) * p.r, 0.12, p.z + (Math.random() - 0.5) * p.r * 0.7);
        this.scene.add(lily);
        this._anim.lilies.push({ mesh: lily, phase: Math.random() * 6 });
      }
    }
    this._instance(M.createCattail(), cattails);
  }
  _bushList = [];

  // ---------------------------------------------------------------- tractor
  _buildTractor() {
    const tractor = M.createTractor();
    this.scene.add(tractor);
    // circuit around the farm hub roads
    const path = [
      { x: 40, z: -10 }, { x: 60, z: 100 }, { x: 90, z: 60 }, { x: 200, z: -10 },
      { x: 110, z: -16 }, { x: 40, z: -120 }, { x: 20, z: -60 },
    ];
    this._anim.tractor = { group: tractor, path, seg: 0, t: 0, speed: 4.5 };
  }

  // ----------------------------------------------------------------- spawns
  _defineSpawns() {
    this.chickenSpawnAreas = [
      { x: 30, z: 44, r: 9, count: Math.ceil(CFG.CHICKEN_COUNT * 0.6) },
      { x: 18, z: -20, r: 10, count: Math.floor(CFG.CHICKEN_COUNT * 0.4) },
    ];
    this.farmerSpawns = [
      { x: 58, z: 0, patrolRadius: 42 },        // farm core
      { x: 167, z: 52, patrolRadius: 38 },      // corn field edge
      { x: 224, z: -190, patrolRadius: 40 },    // second barn
      { x: -150, z: 230, patrolRadius: 45 },    // SW pastures
    ];
    this._goldenSpots = [
      { x: 30, z: 176 },                          // orchard
      { x: 52, z: 253 },                          // pumpkin patch
      { x: this._map.lake.x + this._map.lake.rx + 12, z: this._map.lake.z },
      { x: 210, z: 152 },                         // pond shore
      { x: -20, z: -200 },                        // open meadow
      { x: 244, z: -240 },                        // hay field
      { x: -190, z: -80 },                        // west pasture
    ];
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

    // forest ring
    ctx.fillStyle = '#0e2113';
    const band = (H - this._forestInner) * k;
    ctx.fillRect(0, 0, sizePx, band);
    ctx.fillRect(0, sizePx - band, sizePx, band);
    ctx.fillRect(0, 0, band, sizePx);
    ctx.fillRect(sizePx - band, 0, band, sizePx);

    // fields
    for (const f of this._map.fields) {
      ctx.fillStyle = f.color;
      ctx.fillRect(px(f.x - f.w / 2), py(f.z - f.d / 2), f.w * k, f.d * k);
    }

    // roads
    ctx.strokeStyle = '#8a7445';
    ctx.lineWidth = Math.max(1, 4 * k);
    for (const r of this._roads) {
      ctx.beginPath();
      ctx.moveTo(px(r.x1), py(r.z1));
      ctx.lineTo(px(r.x2), py(r.z2));
      ctx.stroke();
    }

    // river
    ctx.strokeStyle = '#3f7fd6';
    ctx.lineWidth = Math.max(2, 13 * k);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this._riverPts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))));
    ctx.stroke();

    // lake + ponds
    ctx.fillStyle = '#3f7fd6';
    const lk = this._map.lake;
    ctx.beginPath();
    ctx.ellipse(px(lk.x), py(lk.z), lk.rx * k, lk.rz * k, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const p of this._map.ponds) {
      ctx.beginPath();
      ctx.ellipse(px(p.x), py(p.z), p.r * k, p.r * 0.82 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // dam
    const dam = this._map.dam;
    ctx.fillStyle = '#9e9e9e';
    ctx.fillRect(px(dam.x - dam.len / 2), py(dam.z - 4), dam.len * k, 8 * k);

    // bridges
    ctx.fillStyle = '#8d6e63';
    for (const b of this._map.bridges) {
      ctx.fillRect(px(b.x - b.len / 2), py(b.z - 3), b.len * k, 6 * k);
    }

    // fences
    ctx.strokeStyle = 'rgba(230, 220, 180, 0.5)';
    ctx.lineWidth = 1;
    for (const f of this._map.fenceRuns) {
      ctx.strokeRect(px(f.x - f.w / 2), py(f.z - f.d / 2), f.w * k, f.d * k);
    }

    // buildings
    for (const b of this._map.buildings) {
      ctx.fillStyle = b.color || '#8a6d52';
      ctx.fillRect(px(b.x - b.w / 2), py(b.z - b.d / 2), Math.max(2, b.w * k), Math.max(2, b.d * k));
    }
  }

  // ------------------------------------------------------------------ anim
  update(dt, elapsed) {
    const a = this._anim;
    if (a.windmillBlades) a.windmillBlades.rotation.z += dt * 1.4;

    for (const m of a.waterMats) {
      m.emissiveIntensity = 0.22 + Math.sin(elapsed * 1.3) * 0.08;
    }
    for (const l of a.lilies) {
      l.mesh.position.y = 0.12 + Math.sin(elapsed * 1.6 + l.phase) * 0.05;
    }

    const tr = a.tractor;
    if (tr) {
      const p0 = tr.path[tr.seg];
      const p1 = tr.path[(tr.seg + 1) % tr.path.length];
      const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      tr.t += (tr.speed * dt) / segLen;
      if (tr.t >= 1) {
        tr.t = 0;
        tr.seg = (tr.seg + 1) % tr.path.length;
      } else {
        tr.group.position.set(p0.x + (p1.x - p0.x) * tr.t, 0, p0.z + (p1.z - p0.z) * tr.t);
        const target = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        let diff = target - tr.group.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        tr.group.rotation.y += diff * Math.min(1, dt * 4);
        const wheels = tr.group.userData.wheels;
        if (wheels) for (const w of wheels) w.rotation.x += dt * 3;
      }
    }
  }
}
