// MOO-FO — SavannahWorld. A golden grassland map: rolling elevation, a thin
// river + watering holes, acacia/baobab/dead trees, dense real grass, driving
// jeeps & safari cars, vultures, giraffes, dust-devil hazards, and a ranger
// threat. Implements the same public interface as World so it drops into main.

import * as THREE from 'three';
import { CFG, COLORS } from './config.js';
import { terrainHeight, WATER_LEVEL, setBiome, riverX, savRiverHalf, SAV_HOLES } from './terrain.js';
import * as M from './models.js';

const H = CFG.MAP_HALF;
const WATER_Y = WATER_LEVEL + 0.05;

export class SavannahWorld {
  constructor(scene, audio, opts = {}) {
    this.scene = scene;
    this.audio = audio || null;
    this.onHitPlayer = opts.onHitPlayer || null;
    setBiome('savannah');

    // Warm golden-hour key + soft sky fill so the plains glow.
    this.scene.add(new THREE.HemisphereLight(0xfff0cf, 0x6a5a36, 0.75));
    const sun = new THREE.DirectionalLight(0xfff2c8, 0.5); sun.position.set(120, 160, 60);
    this.scene.add(sun);

    this.colliders = [];
    this._blockers = [];
    // farm spawn arrays exist but stay empty here.
    this.cowSpawnAreas = []; this.chickenSpawnAreas = []; this.sheepSpawnAreas = [];
    this.pigSpawnAreas = []; this.horseSpawnAreas = []; this.duckAreas = [];
    this.crabSpawnAreas = []; this.humanSpawnAreas = []; this.fishSpawnAreas = [];
    // savannah abductables.
    this.lionSpawnAreas = []; this.elephantSpawnAreas = [];
    this.flamingoSpawnAreas = []; this.storkSpawnAreas = []; this.crocSpawnAreas = [];
    this.farmerSpawns = [];          // ranger posts (the threat)

    this._map = { holes: [], river: true, props: [] };
    this._objs = [];

    this._buildGround();
    this._buildGrass();
    this._buildWater();
    this._buildTrees();
    this._buildVehicles();
    this._buildAmbient();
    this._buildHazards();
    this._buildSpawns();
  }

  // -------------------------------------------------------------- ground
  _buildGround() {
    const N = 170, span = H * 2;
    const geo = new THREE.PlaneGeometry(span, span, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const dry = new THREE.Color(0xc8b25a);     // dry gold grass
    const green = new THREE.Color(0x8a9b46);   // greener near water
    const dirt = new THREE.Color(0x9c7d4a);    // riverbed / hole bed
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      let c;
      if (y < -0.1) c = dirt;
      else {
        // greener in the low ground (near rivers/holes), drier on the rises.
        const t = THREE.MathUtils.clamp(y / 7, 0, 1);
        c = green.clone().lerp(dry, t);
      }
      const n = 0.9 + ((i * 9301 + 49297) % 233280) / 233280 * 0.2;
      col[i * 3] = c.r * n; col[i * 3 + 1] = c.g * n; col[i * 3 + 2] = c.b * n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.scene.add(ground); this._objs.push(ground);
  }

  // ---------------------------------------------------------- real grass
  _buildGrass() {
    // Thousands of instanced blades scattered over the dry plains — cheap + dense.
    const COUNT = 5200;
    const blade = new THREE.ConeGeometry(0.09, 1.2, 3, 1, true);
    blade.translate(0, 0.6, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb6a14e, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(blade, mat, COUNT);
    const dummy = new THREE.Object3D();
    const c1 = new THREE.Color(0xc7b257), c2 = new THREE.Color(0x8fa24a);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    let n = 0;
    for (let i = 0; i < COUNT * 3 && n < COUNT; i++) {
      const x = (Math.random() * 2 - 1) * (H - 8);
      const z = (Math.random() * 2 - 1) * (H - 8);
      const y = terrainHeight(x, z);
      if (y < 0.4) continue;                      // no grass in water/beds
      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.scale.set(0.7 + Math.random() * 0.9, 0.7 + Math.random() * 1.1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      const c = c1.clone().lerp(c2, Math.random());
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh); this._objs.push(mesh);
  }

  // -------------------------------------------------------------- water
  _waterMat() {
    return new THREE.MeshPhongMaterial({ color: 0x4a86c0, transparent: true, opacity: 0.85, shininess: 70, specular: 0x9fd0ff });
  }
  _buildWater() {
    // thin river strip following the farm river path.
    const pts = [];
    for (let z = -H; z <= H; z += 6) pts.push({ x: riverX(z), z, w: savRiverHalf(z) * 2 + 1 });
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      pos.push(p.x - p.w / 2, WATER_Y, p.z, p.x + p.w / 2, WATER_Y, p.z);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const river = new THREE.Mesh(g, this._waterMat());
    this.scene.add(river); this._objs.push(river);
    this._riverMesh = river;

    // watering holes — discs of water.
    for (const b of SAV_HOLES) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(b.r + 0.5, 28), this._waterMat());
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(b.x, WATER_Y, b.z);
      this.scene.add(disc); this._objs.push(disc);
      this._map.holes.push({ x: b.x, z: b.z, r: b.r });
      this._blockers.push({ x: b.x, z: b.z, r: b.r * 0.6 });
    }
  }

  // -------------------------------------------------------------- trees
  _place(group, x, z, rotY, opts = {}) {
    if (!group) return null;
    group.position.set(x, opts.y != null ? opts.y : terrainHeight(x, z), z);
    group.rotation.y = rotY || 0;
    if (opts.s) group.scale.setScalar(opts.s);
    this.scene.add(group); this._objs.push(group);
    if (opts.collider) this.colliders.push({ x, z, r: opts.collider.r, h: (opts.y != null ? opts.y : terrainHeight(x, z)) + opts.collider.h });
    if (opts.block) this._blockers.push({ x, z, r: opts.block });
    if (opts.map) this._map.props.push({ x, z, kind: opts.map });
    return group;
  }
  _openSpot(minH) {
    for (let k = 0; k < 24; k++) {
      const x = (Math.random() * 2 - 1) * (H - 30);
      const z = (Math.random() * 2 - 1) * (H - 30);
      if (this.isWater(x, z)) continue;
      const y = terrainHeight(x, z);
      if (y < (minH || 0.5) || y > 16) continue;
      return { x, z };
    }
    return null;
  }
  _buildTrees() {
    // Acacias scattered widely (the signature tree).
    for (let i = 0; i < 46; i++) { const p = this._openSpot(0.6); if (p && M.createAcacia) this._place(M.createAcacia(), p.x, p.z, Math.random() * 6, { collider: { r: 1.2, h: 6 }, block: 2, map: 'acacia', s: 0.9 + Math.random() * 0.5 }); }
    // Baobabs — few, big, tall collision hazards.
    for (let i = 0; i < 6; i++) { const p = this._openSpot(0.8); if (p && M.createBaobab) this._place(M.createBaobab(), p.x, p.z, Math.random() * 6, { collider: { r: 2.6, h: 11 }, block: 3.4, map: 'baobab' }); }
    // Dead trees (vulture perches) — register the perch tops for _buildAmbient.
    this._deadTrees = [];
    for (let i = 0; i < 10; i++) {
      const p = this._openSpot(0.6);
      if (p && M.createDeadTree) { this._place(M.createDeadTree(), p.x, p.z, Math.random() * 6, { collider: { r: 0.8, h: 5 }, block: 1.4, map: 'deadtree' }); this._deadTrees.push({ x: p.x, z: p.z, y: terrainHeight(p.x, p.z) }); }
    }
    // Bushes everywhere.
    const bushes = [];
    for (let i = 0; i < 130; i++) { const p = this._openSpot(0.5); if (p) bushes.push(p); }
    for (const p of bushes) if (M.createBush) this._place(M.createBush((Math.random() * 2) | 0), p.x, p.z, Math.random() * 6, { s: 0.7 + Math.random() * 0.8 });
  }

  // ----------------------------------------------------------- vehicles
  _buildVehicles() {
    this._vehicles = [];
    for (let i = 0; i < 5; i++) {
      const mk = i % 2 === 0 ? M.createJeep : M.createSafariCar;
      if (!mk) continue;
      const g = mk();
      const z0 = (Math.random() * 2 - 1) * (H - 40);
      g.position.set((Math.random() * 2 - 1) * (H - 40), 0, z0);
      this.scene.add(g); this._objs.push(g);
      // each drives a slow looping heading; bobs over terrain.
      this._vehicles.push({ g, ang: Math.random() * 6, turn: (Math.random() - 0.5) * 0.2, spd: 9 + Math.random() * 6, x: g.position.x, z: g.position.z });
    }
  }

  // ------------------------------------------------------------ ambient
  _buildAmbient() {
    // Vultures: some perched on dead trees, others wheeling overhead.
    this._vultures = [];
    if (M.createVulture) {
      for (const t of (this._deadTrees || [])) {
        const v = M.createVulture(); v.position.set(t.x + (Math.random() - 0.5) * 1.5, t.y + 4.2, t.z); v.rotation.y = Math.random() * 6;
        this.scene.add(v); this._objs.push(v); this._vultures.push({ g: v, perched: true });
      }
      for (let i = 0; i < 6; i++) {
        const v = M.createVulture(); this.scene.add(v); this._objs.push(v);
        this._vultures.push({ g: v, perched: false, cx: (Math.random() * 2 - 1) * H * 0.7, cz: (Math.random() * 2 - 1) * H * 0.7, r: 35 + Math.random() * 70, a: Math.random() * 6, spd: 0.18 + Math.random() * 0.15, y: 30 + Math.random() * 22 });
      }
    }
    // Giraffes: tall, scattered — collision hazards (you crash into them).
    this._giraffes = [];
    for (let i = 0; i < 7; i++) {
      const p = this._openSpot(0.6);
      if (p && M.createGiraffe) { const g = this._place(M.createGiraffe(), p.x, p.z, Math.random() * 6, { collider: { r: 1.4, h: 8 }, block: 2, map: 'giraffe' }); this._giraffes.push({ g, phase: Math.random() * 6 }); }
    }
  }

  // ------------------------------------------------------------ hazards
  _buildHazards() {
    // Dust devils — a few roaming tornadoes that damage the UFO on contact.
    this._devils = [];
    for (let i = 0; i < 4; i++) {
      if (!M.createDustDevil) break;
      const g = M.createDustDevil();
      const x = (Math.random() * 2 - 1) * (H - 60), z = (Math.random() * 2 - 1) * (H - 60);
      g.position.set(x, terrainHeight(x, z), z);
      this.scene.add(g); this._objs.push(g);
      this._devils.push({ g, x, z, ang: Math.random() * 6, spd: 7 + Math.random() * 5, turn: (Math.random() - 0.5) * 0.5, hitT: 0 });
    }
  }

  // -------------------------------------------------------------- spawns
  _buildSpawns() {
    // Big game — FEW lions and elephants, out on the open plains.
    this.lionSpawnAreas.push({ x: -40, z: 40, r: 120, count: 5 });
    this.elephantSpawnAreas.push({ x: 60, z: -60, r: 140, count: 4 });
    // Watering-hole birds + crocs.
    for (const b of SAV_HOLES) {
      this.flamingoSpawnAreas.push({ x: b.x, z: b.z, r: b.r + 10, count: 7 });
      this.storkSpawnAreas.push({ x: b.x, z: b.z, r: b.r + 14, count: 3 });
      this.crocSpawnAreas.push({ x: b.x, z: b.z, r: b.r * 0.7, count: 2 });
    }
    // Rangers patrol, spread out + jittered (farmers.js jitters further).
    this.farmerSpawns.push({ x: -120, z: -80, patrolRadius: 48 });
    this.farmerSpawns.push({ x: 150, z: 90, patrolRadius: 46 });
    this.farmerSpawns.push({ x: 40, z: 200, patrolRadius: 44 });
  }

  // ----------------------------------------------------- world interface
  isWater(x, z) { return terrainHeight(x, z) < WATER_LEVEL - 0.1; }
  groundY(x, z) { return terrainHeight(x, z); }
  randomSpawn() {
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() * 2 - 1) * (H - 40), z = (Math.random() * 2 - 1) * (H - 40);
      if (this.isWater(x, z)) continue;
      const y = terrainHeight(x, z);
      if (y < 0.6 || y > 16) continue;
      let ok = true;
      for (const b of this._blockers) if ((x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + 6) ** 2) { ok = false; break; }
      if (ok) return { x, z };
    }
    return { x: 0, z: 30 };
  }
  goldenCowSpot() { return { x: 0, z: 0 }; }    // unused (cowSpawnAreas empty → no golden)
  get waterfallPos() { return null; }
  get tractorPos() { return null; }
  get horsePos() { return null; }

  // ------------------------------------------------------------- update
  update(dt, elapsed, cycle, ufoPos) {
    // vehicles drive in slow arcs, bobbing over the terrain.
    if (this._vehicles) for (const v of this._vehicles) {
      v.ang += v.turn * dt;
      v.x += Math.sin(v.ang) * v.spd * dt; v.z += Math.cos(v.ang) * v.spd * dt;
      if (Math.abs(v.x) > H - 30 || Math.abs(v.z) > H - 30) { v.turn = -v.turn; v.ang += Math.PI; v.x = Math.max(-(H - 30), Math.min(H - 30, v.x)); v.z = Math.max(-(H - 30), Math.min(H - 30, v.z)); }
      v.g.position.set(v.x, terrainHeight(v.x, v.z), v.z);
      v.g.rotation.y = v.ang;
      v.g.position.y += Math.sin(elapsed * 6 + v.x) * 0.08;
    }
    // vultures: perched ones shuffle; wheeling ones circle + flap.
    if (this._vultures) for (const v of this._vultures) {
      if (v.perched) { if (v.g.userData.wings) { const f = Math.sin(elapsed * 1.5) * 0.05; v.g.userData.wings[0] && (v.g.userData.wings[0].rotation.z = f); } continue; }
      v.a += dt * v.spd;
      v.g.position.set(v.cx + Math.cos(v.a) * v.r, v.y + Math.sin(v.a * 2) * 3, v.cz + Math.sin(v.a) * v.r);
      v.g.rotation.y = -v.a + Math.PI / 2;
      const w = v.g.userData.wings; if (w) { const f = Math.sin(elapsed * 6 + v.cx) * 0.6; w[0] && (w[0].rotation.z = f); w[1] && (w[1].rotation.z = -f); }
    }
    // giraffes sway gently.
    if (this._giraffes) for (const gg of this._giraffes) { if (gg.g) gg.g.rotation.z = Math.sin(elapsed * 0.7 + gg.phase) * 0.02; }
    // dust devils roam + spin; damage the UFO on contact.
    if (this._devils) for (const d of this._devils) {
      d.ang += d.turn * dt;
      d.x += Math.sin(d.ang) * d.spd * dt; d.z += Math.cos(d.ang) * d.spd * dt;
      if (Math.abs(d.x) > H - 40 || Math.abs(d.z) > H - 40) { d.ang += Math.PI; d.x = Math.max(-(H - 40), Math.min(H - 40, d.x)); d.z = Math.max(-(H - 40), Math.min(H - 40, d.z)); }
      d.g.position.set(d.x, terrainHeight(d.x, d.z), d.z);
      const rings = d.g.userData && d.g.userData.rings;
      if (rings) for (let i = 0; i < rings.length; i++) rings[i].rotation.y = elapsed * (3 + i * 0.5);
      d.hitT -= dt;
      if (this.onHitPlayer && ufoPos && d.hitT <= 0) {
        const dd = Math.hypot(ufoPos.x - d.x, ufoPos.z - d.z);
        if (dd < 7) { d.hitT = 1.2; this.onHitPlayer(1); if (this.audio) this.audio.play('dustdevil', { volume: 0.5 }); }
      }
    }
  }

  // ------------------------------------------------------------- minimap
  drawMinimap(ctx, sizePx) {
    const s = sizePx / (H * 2);
    const toPx = (wx) => (wx + H) * s;
    // grassland gradient
    const g = ctx.createLinearGradient(0, 0, sizePx, sizePx);
    g.addColorStop(0, '#bfa94f'); g.addColorStop(1, '#9aac52');
    ctx.fillStyle = g; ctx.fillRect(0, 0, sizePx, sizePx);
    // river
    ctx.strokeStyle = '#4a86c0'; ctx.lineWidth = Math.max(2, sizePx * 0.016); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let z = -H; z <= H; z += 10) { const px = toPx(riverX(z)), py = toPx(z); z === -H ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
    // watering holes
    for (const h of this._map.holes) { ctx.fillStyle = '#4a86c0'; dot(ctx, toPx(h.x), toPx(h.z), h.r * s + 1); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    // props
    for (const p of this._map.props) {
      const px = toPx(p.x), py = toPx(p.z);
      if (p.kind === 'acacia') { ctx.fillStyle = '#5e7d3a'; dot(ctx, px, py, sizePx * 0.012); }
      else if (p.kind === 'baobab') { ctx.fillStyle = '#8a6a44'; dot(ctx, px, py, sizePx * 0.02); }
      else if (p.kind === 'deadtree') { ctx.fillStyle = '#b3a98f'; dot(ctx, px, py, sizePx * 0.01); }
      else if (p.kind === 'giraffe') { ctx.fillStyle = '#e0b24a'; sq(ctx, px, py, sizePx * 0.012); }
    }
  }

  dispose() { for (const o of this._objs) { if (o.parent) o.parent.remove(o); else this.scene.remove(o); } this._objs.length = 0; }
}

function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, 6.283); ctx.fill(); }
function sq(ctx, x, y, r) { ctx.fillRect(x - r, y - r, r * 2, r * 2); }
