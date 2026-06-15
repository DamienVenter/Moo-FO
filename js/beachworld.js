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

// ---- GPU ocean: Gerstner-wave vertex displacement + textured water shading.
const OCEAN_VERT = `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vFoam;
  varying float vShore;
  float shoreX(float z){ return -30.0 + 5.0*sin(z*0.03) + 7.0*sin(z*0.013+1.0); }
  void main(){
    vec2 xz = vec2(position.x, position.z);
    float sx = shoreX(xz.y);
    float shoreDist = sx - xz.x;                 // >0 = open sea
    vShore = shoreDist;
    float ampF = clamp(shoreDist/55.0, 0.0, 1.0);// flatten to a clean waterline

    vec2 dirs[5]; float L[5]; float Q[5]; float A[5]; float S[5];
    dirs[0]=normalize(vec2(1.0,0.18)); L[0]=37.0; Q[0]=0.82; A[0]=0.85; S[0]=1.0;
    dirs[1]=normalize(vec2(0.7,-0.5)); L[1]=21.0; Q[1]=0.72; A[1]=0.5;  S[1]=1.4;
    dirs[2]=normalize(vec2(0.25,0.97));L[2]=12.5; Q[2]=0.6;  A[2]=0.3;  S[2]=1.9;
    dirs[3]=normalize(vec2(-0.5,0.62));L[3]=7.7;  Q[3]=0.5;  A[3]=0.17; S[3]=2.5;
    dirs[4]=normalize(vec2(0.9,0.42)); L[4]=4.6;  Q[4]=0.4;  A[4]=0.09; S[4]=3.3;

    vec3 disp = vec3(0.0);
    vec3 nrm = vec3(0.0, 1.0, 0.0);
    float foam = 0.0;
    for (int i=0;i<5;i++){
      float k = 6.2831853/L[i];
      float f = k*dot(dirs[i], xz) + uTime*S[i];
      float a = A[i]*ampF;
      float ca = cos(f), sa = sin(f);
      disp.x += Q[i]*a*dirs[i].x*ca;
      disp.z += Q[i]*a*dirs[i].y*ca;
      disp.y += a*sa;
      nrm.x -= dirs[i].x*k*a*ca;
      nrm.z -= dirs[i].y*k*a*ca;
      nrm.y -= Q[i]*k*a*sa;
      foam += max(0.0, sa)*a;
    }
    // fine cross-chop for unpredictable surface texture
    disp.y += ampF*0.05*sin(xz.x*0.8 + uTime*2.1)*cos(xz.y*0.7 - uTime*1.7);
    vFoam = foam;
    vN = normalize(nrm);
    vec3 dp = vec3(position.x + disp.x, position.y + disp.y, position.z + disp.z);
    vec4 wp = modelMatrix * vec4(dp, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const OCEAN_FRAG = `
  uniform float uTime;
  uniform vec3 uDeep, uShallow, uFoam, uSun;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vFoam;
  varying float vShore;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y); }
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vWorld);
    float depthT = clamp(vShore/130.0, 0.0, 1.0);
    vec3 col = mix(uShallow, uDeep, depthT);
    // Fresnel sky sheen
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(col, vec3(0.55,0.74,0.95), fres*0.55);
    // animated sun glitter
    vec3 Hh = normalize(uSun + V);
    float spec = pow(max(dot(N, Hh), 0.0), 140.0);
    float twk = 0.6 + 0.4*noise(vWorld.xz*0.6 + uTime*1.5);
    col += spec * vec3(1.0,0.97,0.85) * 1.6 * twk;
    // whitecaps on steep crests + a foam band hugging the shore, broken by noise
    float crest = smoothstep(0.5, 1.0, vFoam);
    float shoreFoam = smoothstep(16.0, 0.0, vShore);
    float fn = noise(vWorld.xz*0.22 + uTime*0.35);
    float foam = clamp(crest*0.85 + shoreFoam*1.1, 0.0, 1.0) * smoothstep(0.25, 0.7, fn+0.25);
    col = mix(col, uFoam, foam);
    float alpha = mix(0.95, 0.75, depthT);
    gl_FragColor = vec4(col, clamp(alpha + foam*0.25, 0.0, 1.0));
  }
`;

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
    // A real GPU ocean: a high-res plane displaced in the VERTEX shader by
    // layered Gerstner waves + chop, coloured in the FRAGMENT shader by depth,
    // Fresnel sky-sheen, animated sun-glitter and crest/shore whitecaps.
    const width = (H + 60) - 6;            // x∈[-H-60 .. -6] (sea only)
    const geo = new THREE.PlaneGeometry(width, H * 2 + 120, 200, 240);
    geo.rotateX(-Math.PI / 2);
    geo.translate(-6 - width / 2, 0, 0);

    this._oceanMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x0a3b7a) },
        uShallow: { value: new THREE.Color(0x2bbfc4) },
        uFoam: { value: new THREE.Color(0xeaf7ff) },
        uSun: { value: new THREE.Vector3(0.45, 0.72, 0.5).normalize() },
      },
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
    });
    this._ocean = new THREE.Mesh(geo, this._oceanMat);
    this._ocean.position.y = WATER_Y;
    this._ocean.frustumCulled = false;
    this.scene.add(this._ocean);
    this._objs.push(this._ocean);

    // a deep, opaque shelf below so nothing ever shows through the sea.
    const deep = new THREE.Mesh(
      new THREE.PlaneGeometry(width, H * 2 + 120),
      new THREE.MeshBasicMaterial({ color: 0x07336b })
    );
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(-6 - width / 2, WATER_Y - 3.5, 0);
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
    // 1) OCEAN — the GPU shader does the waves; just advance its clock.
    if (this._oceanMat) this._oceanMat.uniforms.uTime.value = elapsed;

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
    const shorePxAt = (z) => toPx(beachShoreX(z));

    // SAND — a warm vertical gradient with a faint speckle so it reads as beach.
    const sg = ctx.createLinearGradient(0, 0, sizePx, 0);
    sg.addColorStop(0, '#d8c074'); sg.addColorStop(1, '#efe0ad');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, sizePx, sizePx);

    // OCEAN — a depth gradient (deep navy offshore → bright turquoise at shore),
    // clipped to the meandering shoreline.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let z = -H; z <= H; z += 8) ctx.lineTo(shorePxAt(z), toPx(z));
    ctx.lineTo(0, sizePx); ctx.closePath(); ctx.clip();
    const og = ctx.createLinearGradient(0, 0, sizePx * 0.62, 0);
    og.addColorStop(0, '#0a2f63'); og.addColorStop(0.7, '#1f6fb0'); og.addColorStop(1, '#39c2c4');
    ctx.fillStyle = og; ctx.fillRect(0, 0, sizePx, sizePx);
    // a couple of soft swell bands
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = sizePx * 0.008;
    for (let o = 0.18; o < 0.95; o += 0.22) {
      ctx.beginPath();
      for (let z = -H; z <= H; z += 10) { const px = shorePxAt(z) * o, py = toPx(z); z === -H ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.restore();

    // FOAM — a soft glowing band right along the waterline.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(2, sizePx * 0.018);
    ctx.shadowColor = 'rgba(255,255,255,0.7)'; ctx.shadowBlur = sizePx * 0.02;
    ctx.beginPath();
    for (let z = -H; z <= H; z += 8) { const px = shorePxAt(z), py = toPx(z); z === -H ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // PROPS — clean little icons.
    for (const p of this._map.props) {
      const px = toPx(p.x), py = toPx(p.z);
      if (p.kind === 'umbrella') { ctx.fillStyle = '#ff5a5a'; dot(ctx, px, py, sizePx * 0.022); ctx.fillStyle = '#fff'; dot(ctx, px, py, sizePx * 0.008); }
      else if (p.kind === 'tower') { ctx.fillStyle = '#ff7043'; sq(ctx, px, py, sizePx * 0.026); }
      else if (p.kind === 'barrel') { ctx.fillStyle = '#7a5b3a'; dot(ctx, px, py, sizePx * 0.012); }
      else if (p.kind === 'castle') { ctx.fillStyle = '#c9a96a'; sq(ctx, px, py, sizePx * 0.016); }
      else if (p.kind === 'boat') { ctx.fillStyle = '#f0f0f0'; sq(ctx, px, py, sizePx * 0.02); }
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
