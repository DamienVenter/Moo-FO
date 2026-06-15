// MOO-FO — BeachWorld. A second playable map: OCEAN on the left, BEACH on the
// right, all the way through. Implements the same public interface as World so
// it drops into main.js. The animated three.js ocean (real displaced waves +
// rolling breakers + shoreline foam/splash) is the centrepiece.

import * as THREE from 'three';
import { CFG, COLORS } from './config.js';
import { terrainHeight, WATER_LEVEL, setBiome, beachShoreX } from './terrain.js';
import * as M from './models.js';

const H = CFG.MAP_HALF;
const WATER_Y = WATER_LEVEL + 0.05;

// directional swell components for the ocean surface (Gerstner-ish).
const WAVES = [
  { dx: 1.0, dz: 0.18, len: 34, amp: 0.55, speed: 0.9 },
  { dx: 0.7, dz: -0.5, len: 19, amp: 0.32, speed: 1.35 },
  { dx: 0.3, dz: 0.9, len: 11, amp: 0.18, speed: 1.9 },
];

export class BeachWorld {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio || null;
    this._gullT = 3;
    setBiome('beach');

    // Moonlit fill — keeps the beach bright and readable even at night (the
    // moon "lights up everything"), without washing out daytime.
    this._moon = new THREE.HemisphereLight(0xcfe0ff, 0x3a4668, 0.65);
    this.scene.add(this._moon);

    this.colliders = [];
    this._blockers = [];
    // farm spawn arrays exist but stay empty on the beach.
    this.cowSpawnAreas = [];
    this.chickenSpawnAreas = [];
    this.sheepSpawnAreas = [];
    this.pigSpawnAreas = [];
    this.horseSpawnAreas = [];
    this.duckAreas = [];
    // beach abductables.
    this.crabSpawnAreas = [];
    this.humanSpawnAreas = [];
    this.fishSpawnAreas = [];
    this.farmerSpawns = [];        // lifeguard posts (the threat)

    this._map = { ocean: true, shore: [], props: [] };
    this._objs = [];
    this._anim = {};

    this._buildGround();
    this._buildOcean();
    this._buildShoreline();
    this._buildProps();
    this._buildAmbient();
    this._buildSpawns();
  }

  // -------------------------------------------------------------- ground
  _buildGround() {
    // One big displaced grid sampling the beach heightfield: sand on the beach,
    // darker wet sand at the waterline, dim seabed under the ocean.
    const N = 150, span = H * 2;
    const geo = new THREE.PlaneGeometry(span, span, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(COLORS.sand);
    const wet = new THREE.Color(0xb0a06a);
    const sea = new THREE.Color(0x9a8c5a);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      let c;
      if (y < -0.2) c = sea;                          // submerged seabed
      else if (y < 0.6) c = wet;                      // wet shore
      else c = sand;                                  // dry sand / dunes
      // a little speckle so the sand isn't flat.
      const n = 0.92 + ((i * 9301 + 49297) % 233280) / 233280 * 0.16;
      col[i * 3] = c.r * n; col[i * 3 + 1] = c.g * n; col[i * 3 + 2] = c.b * n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = false;
    this.scene.add(ground);
    this._objs.push(ground);
  }

  // -------------------------------------------------------------- ocean
  _buildOcean() {
    // The ocean covers the left side (out past the shoreline). A subdivided
    // plane whose vertices are displaced every frame by the swell.
    const segX = 96, segZ = 130;
    // span x∈[-H-60 .. -6] (ocean only — stops just sea-ward of the beach so
    // it never overlaps dry sand), z∈[-H-60 .. H+60].
    const width = (H + 60) - 6;
    const geo = new THREE.PlaneGeometry(width, H * 2 + 120, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(-6 - width / 2, 0, 0);
    this._oceanGeo = geo;
    this._oceanBase = Float32Array.from(geo.attributes.position.array);
    const mat = new THREE.MeshPhongMaterial({
      color: COLORS.water, transparent: true, opacity: 0.86, shininess: 80,
      specular: 0x9fd0ff, flatShading: true, side: THREE.DoubleSide,
    });
    mat.emissive = new THREE.Color(0x12386b); mat.emissiveIntensity = 0.35;
    this._ocean = new THREE.Mesh(geo, mat);
    this._ocean.position.y = WATER_Y;
    this.scene.add(this._ocean);
    this._objs.push(this._ocean);

    // a deep, opaque "underwater" plane below so gaps never show through.
    const deep = new THREE.Mesh(
      new THREE.PlaneGeometry(width, H * 2 + 120),
      new THREE.MeshBasicMaterial({ color: COLORS.waterDeep })
    );
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(-6 - width / 2, WATER_Y - 3, 0);
    this.scene.add(deep);
    this._objs.push(deep);
  }

  _buildShoreline() {
    // Foam sprite texture (soft white puff).
    this._foamTex = makeFoam();
    // Rolling BREAKERS: long thin foam crest lines that travel from the sea
    // toward the shore and recycle — the "waves splashing" read.
    this._breakers = [];
    const NB = 7;
    for (let i = 0; i < NB; i++) {
      const g = new THREE.Group();
      const segs = 26;
      for (let s = 0; s < segs; s++) {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._foamTex, transparent: true, opacity: 0.0, depthWrite: false }));
        const sc = 5 + Math.random() * 3;
        spr.scale.set(sc, sc * 0.6, 1);
        g.add(spr);
      }
      this.scene.add(g);
      this._objs.push(g);
      this._breakers.push({ g, phase: i / NB, speed: 0.05 + Math.random() * 0.02 });
    }
    // Shoreline WASH strip + SPLASH puffs that bob along the waterline.
    this._splashes = [];
    for (let i = 0; i < 60; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._foamTex, transparent: true, opacity: 0.5, depthWrite: false }));
      const z = -H + Math.random() * H * 2;
      spr.scale.set(4 + Math.random() * 3, 3, 1);
      this.scene.add(spr);
      this._objs.push(spr);
      this._splashes.push({ spr, z, phase: Math.random() * 6 });
    }
  }

  // -------------------------------------------------------------- props
  _place(group, x, z, rotY, opts = {}) {
    if (!group) return null;
    const y = opts.y != null ? opts.y : terrainHeight(x, z);
    group.position.set(x, y, z);
    group.rotation.y = rotY || 0;
    this.scene.add(group);
    this._objs.push(group);
    if (opts.collider) this.colliders.push({ x, z, r: opts.collider.r, h: y + opts.collider.h });
    if (opts.block) this._blockers.push({ x, z, r: opts.block });
    if (opts.map) this._map.props.push({ x, z, kind: opts.map });
    return group;
  }
  // a dry-beach x for a given z, `inset` units inland from the waterline.
  _beachX(z, inset) { return beachShoreX(z) + inset; }

  _buildProps() {
    // Umbrellas + sandcastles dotted along the dry beach.
    for (let i = 0; i < 14; i++) {
      const z = -H + 50 + Math.random() * (H * 2 - 100);
      const x = this._beachX(z, 24 + Math.random() * 90);
      if (terrainHeight(x, z) < 0.4) continue;
      if (M.createUmbrella) this._place(M.createUmbrella(), x, z, Math.random() * 6, { block: 1.4, map: 'umbrella' });
    }
    for (let i = 0; i < 10; i++) {
      const z = -H + 60 + Math.random() * (H * 2 - 120);
      const x = this._beachX(z, 10 + Math.random() * 26);
      if (terrainHeight(x, z) < 0.3) continue;
      if (M.createSandcastle) this._place(M.createSandcastle(), x, z, Math.random() * 6, { block: 1.2, map: 'castle' });
    }
    // Lifeguard towers spaced along the shore.
    for (let i = 0; i < 4; i++) {
      const z = -H + 90 + i * ((H * 2 - 180) / 3);
      const x = this._beachX(z, 30);
      if (M.createLifeguardTower) this._place(M.createLifeguardTower(), x, z, -Math.PI / 2, { collider: { r: 3, h: 8 }, block: 3, map: 'tower' });
    }
    // Washed-up barrels near the waterline + palms further inland.
    for (let i = 0; i < 9; i++) {
      const z = -H + 40 + Math.random() * (H * 2 - 80);
      const x = this._beachX(z, 4 + Math.random() * 40);
      if (terrainHeight(x, z) < 0.1) continue;
      if (M.createBeachBarrel) this._place(M.createBeachBarrel(), x, z, Math.random() * 6, { collider: { r: 1.1, h: 1.8 }, map: 'barrel' });
    }
    for (let i = 0; i < 12; i++) {
      const z = -H + 60 + Math.random() * (H * 2 - 120);
      const x = this._beachX(z, 70 + Math.random() * 120);
      if (terrainHeight(x, z) < 1.0) continue;
      if (M.createPalm) this._place(M.createPalm(), x, z, Math.random() * 6, { collider: { r: 1, h: 7 }, block: 1.6 });
    }
    // Boats + yachts floating out on the water (animated bob in update).
    this._boats = [];
    for (let i = 0; i < 5; i++) {
      const z = -H + 80 + Math.random() * (H * 2 - 160);
      const x = beachShoreX(z) - 60 - Math.random() * 160;
      const mk = (i % 2 === 0) ? M.createBoat : M.createYacht;
      if (!mk) continue;
      const b = mk();
      b.position.set(x, WATER_Y, z);
      b.rotation.y = Math.random() * 6;
      this.scene.add(b); this._objs.push(b);
      this._boats.push({ g: b, z, phase: Math.random() * 6 });
      this._map.props.push({ x, z, kind: 'boat' });
    }
  }

  // ------------------------------------------------------------- ambient
  _buildAmbient() {
    // Sharks cruising just under the surface, dolphins arcing, seagulls flying.
    this._sharks = [];
    for (let i = 0; i < 4; i++) {
      if (!M.createShark) break;
      const g = M.createShark();
      this.scene.add(g); this._objs.push(g);
      this._sharks.push({ g, z: -H + Math.random() * H * 2, x: beachShoreX(0) - 80 - Math.random() * 180, dir: Math.random() < 0.5 ? 1 : -1, spd: 4 + Math.random() * 3, phase: Math.random() * 6 });
    }
    this._dolphins = [];
    for (let i = 0; i < 3; i++) {
      if (!M.createDolphin) break;
      const g = M.createDolphin();
      this.scene.add(g); this._objs.push(g);
      this._dolphins.push({ g, z: -H + Math.random() * H * 2, x: beachShoreX(0) - 120 - Math.random() * 150, spd: 7 + Math.random() * 3, t: Math.random() * 6 });
    }
    this._gulls = [];
    for (let i = 0; i < 8; i++) {
      if (!M.createSeagull) break;
      const g = M.createSeagull();
      this.scene.add(g); this._objs.push(g);
      this._gulls.push({ g, cx: (Math.random() * 2 - 1) * H * 0.8, cz: (Math.random() * 2 - 1) * H * 0.8, r: 30 + Math.random() * 80, a: Math.random() * 6, spd: 0.2 + Math.random() * 0.2, y: 26 + Math.random() * 24 });
    }
  }

  // -------------------------------------------------------------- spawns
  _buildSpawns() {
    // Crabs (the main abduction target) all along the wet/dry shore.
    for (let i = 0; i < 6; i++) {
      const z = -H + 60 + i * ((H * 2 - 120) / 5);
      this.crabSpawnAreas.push({ x: this._beachX(z, 26), z, r: 40, count: 9 });
    }
    // Beachgoers scattered on the dry sand.
    for (let i = 0; i < 4; i++) {
      const z = -H + 90 + i * ((H * 2 - 180) / 3);
      this.humanSpawnAreas.push({ x: this._beachX(z, 60), z, r: 34, count: 5 });
    }
    // Fish in the shallows just off the shore.
    for (let i = 0; i < 4; i++) {
      const z = -H + 80 + i * ((H * 2 - 160) / 3);
      this.fishSpawnAreas.push({ x: beachShoreX(z) - 22, z, r: 26, count: 7 });
    }
    // Lifeguards patrol the foreshore (the threat).
    for (let i = 0; i < 4; i++) {
      const z = -H + 110 + i * ((H * 2 - 220) / 3);
      this.farmerSpawns.push({ x: this._beachX(z, 16), z });
    }
  }

  // ----------------------------------------------------- world interface
  isWater(x, z) { return terrainHeight(x, z) < WATER_LEVEL - 0.1; }
  groundY(x, z) { return terrainHeight(x, z); }

  randomSpawn() {
    for (let i = 0; i < 40; i++) {
      const z = -H + 60 + Math.random() * (H * 2 - 120);
      const x = this._beachX(z, 30 + Math.random() * 110);
      if (x < H - 30 && terrainHeight(x, z) > 0.5) return { x, z };
    }
    return { x: 60, z: 0 };
  }
  goldenCowSpot() { const z = (Math.random() * 2 - 1) * H * 0.6; return { x: this._beachX(z, 50), z }; }

  get waterfallPos() { return null; }
  get tractorPos() { return null; }
  get horsePos() { return null; }

  // ------------------------------------------------------------- update
  update(dt, elapsed) {
    // 1) OCEAN SURFACE — displace every vertex by the swell, then re-face it.
    if (this._oceanGeo) {
      const arr = this._oceanGeo.attributes.position.array;
      const base = this._oceanBase;
      for (let i = 0; i < arr.length; i += 3) {
        const bx = base[i], bz = base[i + 2];
        // damp the swell to zero as it nears the shore so it never pokes above
        // the sand (clean waterline); full height in open water.
        const ampF = Math.max(0, Math.min(1, (beachShoreX(bz) - bx) / 55));
        let y = 0, dx = 0, dz = 0;
        for (const w of WAVES) {
          const k = (2 * Math.PI) / w.len;
          const ph = (bx * w.dx + bz * w.dz) * k + elapsed * w.speed;
          y += Math.sin(ph) * w.amp * ampF;
          const c = Math.cos(ph) * w.amp * 0.5 * ampF;
          dx += w.dx * c; dz += w.dz * c;
        }
        arr[i] = bx + dx;
        arr[i + 1] = y;
        arr[i + 2] = bz + dz;
      }
      this._oceanGeo.attributes.position.needsUpdate = true;
      this._oceanGeo.computeVertexNormals();
    }

    // 2) ROLLING BREAKERS — each crest line travels from sea toward the shore.
    if (this._breakers) {
      for (const b of this._breakers) {
        b.phase = (b.phase + dt * b.speed) % 1;
        const kids = b.g.children;
        for (let s = 0; s < kids.length; s++) {
          const z = -H + (s / kids.length) * H * 2;
          const shore = beachShoreX(z);
          // travel from ~140 units out, in to the shoreline.
          const x = shore - (1 - b.phase) * 150;
          const op = Math.sin(b.phase * Math.PI) * 0.85;     // swell + foam at the end
          kids[s].position.set(x, WATER_Y + 0.3 + Math.sin(elapsed * 2 + s) * 0.2, z + Math.sin(s) * 2);
          kids[s].material.opacity = op * (b.phase > 0.6 ? 1 : 0.5);
        }
      }
    }

    // 3) SHORELINE WASH + SPLASH — foam puffs riding the waterline in/out.
    if (this._splashes) {
      for (const s of this._splashes) {
        const wash = Math.sin(elapsed * 0.8 + s.phase);     // -1 out, +1 up the sand
        const x = beachShoreX(s.z) + wash * 6 - 2;
        s.spr.position.set(x, WATER_Y + 0.35 + Math.max(0, wash) * 0.5, s.z);
        s.spr.material.opacity = 0.35 + 0.4 * Math.max(0, wash);
      }
    }

    // 4) boats bob; sharks cruise; dolphins arc; gulls circle.
    if (this._boats) for (const b of this._boats) { b.g.position.y = WATER_Y + Math.sin(elapsed * 1.1 + b.phase) * 0.5; b.g.rotation.z = Math.sin(elapsed * 0.9 + b.phase) * 0.06; }
    if (this._sharks) for (const s of this._sharks) {
      s.z += s.dir * s.spd * dt;
      if (s.z > H + 40) s.z = -H - 40; if (s.z < -H - 40) s.z = H + 40;
      s.g.position.set(s.x + Math.sin(elapsed * 0.5 + s.phase) * 8, WATER_Y - 0.4, s.z);
      s.g.rotation.y = s.dir > 0 ? 0 : Math.PI;
    }
    if (this._dolphins) for (const d of this._dolphins) {
      d.t += dt;
      d.z += d.spd * dt; if (d.z > H + 40) d.z = -H - 40;
      const arc = Math.sin(d.t * 1.4);
      d.g.position.set(d.x, WATER_Y + Math.max(-0.6, arc) * 4.5, d.z);
      d.g.rotation.x = -Math.cos(d.t * 1.4) * 0.7;
      // entering the water at the end of a leap → splash + the odd whistle.
      const up = arc > 0;
      if (d._up && !up && this.audio) { this.audio.play('splash', { volume: 0.35, ratejitter: 0.2 }); if (Math.random() < 0.5) this.audio.play('dolphin', { volume: 0.4, ratejitter: 0.15 }); }
      d._up = up;
    }
    // occasional seagull cries overhead.
    this._gullT -= dt;
    if (this._gullT <= 0) { this._gullT = 4 + Math.random() * 7; if (this.audio && this._gulls && this._gulls.length) this.audio.play('seagull', { volume: 0.3, ratejitter: 0.2 }); }
    if (this._gulls) for (const g of this._gulls) {
      g.a += dt * g.spd;
      g.g.position.set(g.cx + Math.cos(g.a) * g.r, g.y + Math.sin(g.a * 2) * 3, g.cz + Math.sin(g.a) * g.r);
      g.g.rotation.y = -g.a + Math.PI / 2;
      const w = g.g.userData && g.g.userData.wings;
      if (w) { const f = Math.sin(elapsed * 8 + g.cx) * 0.6; if (w[0]) w[0].rotation.z = f; if (w[1]) w[1].rotation.z = -f; }
    }
  }

  // ------------------------------------------------------------- minimap
  drawMinimap(ctx, sizePx) {
    const s = sizePx / (H * 2);
    const toPx = (wx) => (wx + H) * s;
    // beach sand fill
    ctx.fillStyle = '#e7d39a';
    ctx.fillRect(0, 0, sizePx, sizePx);
    // ocean (left of the meandering shoreline)
    ctx.fillStyle = '#2f63b0';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let z = -H; z <= H; z += 12) ctx.lineTo(toPx(beachShoreX(z)), toPx(z));
    ctx.lineTo(0, sizePx);
    ctx.closePath();
    ctx.fill();
    // foam line along the shore
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1.5, sizePx * 0.012);
    ctx.beginPath();
    for (let z = -H; z <= H; z += 12) { const px = toPx(beachShoreX(z)), py = toPx(z); if (z === -H) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.stroke();
    // props
    for (const p of this._map.props) {
      const px = toPx(p.x), py = toPx(p.z);
      if (p.kind === 'umbrella') { ctx.fillStyle = '#ff5a5a'; dot(ctx, px, py, sizePx * 0.02); }
      else if (p.kind === 'tower') { ctx.fillStyle = '#ffffff'; sq(ctx, px, py, sizePx * 0.03); }
      else if (p.kind === 'barrel') { ctx.fillStyle = '#8a6d52'; dot(ctx, px, py, sizePx * 0.013); }
      else if (p.kind === 'castle') { ctx.fillStyle = '#cba66a'; dot(ctx, px, py, sizePx * 0.014); }
      else if (p.kind === 'boat') { ctx.fillStyle = '#eaeaea'; sq(ctx, px, py, sizePx * 0.02); }
    }
  }

  dispose() {
    for (const o of this._objs) { if (o.parent) o.parent.remove(o); else this.scene.remove(o); }
    this._objs.length = 0;
  }
}

function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, 6.283); ctx.fill(); }
function sq(ctx, x, y, r) { ctx.fillRect(x - r, y - r, r * 2, r * 2); }

let _foam = null;
function makeFoam() {
  if (_foam) return _foam;
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(24, 24, 2, 24, 24, 23);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.6, 'rgba(235,247,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 48, 48);
  _foam = new THREE.CanvasTexture(c);
  return _foam;
}
