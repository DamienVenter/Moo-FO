// MOO-FO — js/models.js (Agent M) — v2 "designer detail" pass.
// Voxel model factories. Every factory returns a THREE.Group whose origin is at
// the BOTTOM-CENTER of the model (sits on the ground at position.y = 0).
// Characters face +Z. Animation joints are parent Groups positioned at the joint
// (hip / shoulder / neck) so rotating the userData object swings the limb.
// Materials are MeshLambertMaterial, bright + saturated — the night look comes
// from scene lighting, never from darkened materials.
//
// v2 additions: cached procedural canvas textures (planks / shingles / stone /
// door panels / corrugated metal / brick / patchwork) applied tastefully to the
// big buildings, far richer micro-detail on every factory, and four new
// critters: sheep, duck, owl, bat. Mesh budgets: instanced decor ≤ ~14 meshes,
// hero characters ≤ ~45, buildings ≤ ~80. Geometry is shared via a scaled unit
// box + a keyed geometry cache; materials are shared via the mat()/emat() caches.

import * as THREE from 'three';
import { CFG, COLORS, ENABLE_SHADOWS } from './config.js';

const PI2 = Math.PI * 2;

/* ------------------------------------------------------------------ *
 *  Procedural canvas textures (cached, NearestFilter, 64px)
 *  Textures are near-white luminance maps (±12%-ish) that MULTIPLY the
 *  material color — bright voxel colors stay bright, surfaces gain grain.
 * ------------------------------------------------------------------ */

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function lum(ctx, v) {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  ctx.fillStyle = `rgb(${c},${c},${c})`;
}

function paintPlanks(ctx, w, h) {
  // Vertical boards with grain flecks, dark seams and nail dots.
  const r = makeRng(7);
  const boards = 5, bw = w / boards;
  for (let i = 0; i < boards; i++) {
    lum(ctx, 228 + r() * 24);
    ctx.fillRect(i * bw, 0, bw, h);
    for (let k = 0; k < 6; k++) {
      lum(ctx, 212 + r() * 18);
      ctx.fillRect(i * bw + 1 + ((r() * (bw - 4)) | 0), (r() * h) | 0, 1, 5 + ((r() * 10) | 0));
    }
    lum(ctx, 198);
    ctx.fillRect(i * bw, 0, 1, h);                       // board seam
    lum(ctx, 186);                                        // nails top + bottom
    ctx.fillRect(i * bw + bw / 2 - 1, 4, 2, 2);
    ctx.fillRect(i * bw + bw / 2 - 1, h - 6, 2, 2);
  }
}

function paintShingles(ctx, w, h) {
  // Offset rows of shingles with butt-shadow lines.
  const r = makeRng(11);
  const rows = 8, rh = h / rows, sw = w / 4;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * (sw / 2);
    for (let i = -1; i < 5; i++) {
      lum(ctx, 224 + r() * 28);
      ctx.fillRect(i * sw + off, row * rh, sw, rh);
      lum(ctx, 200);
      ctx.fillRect(i * sw + off, row * rh, 1, rh);        // shingle gap
    }
    lum(ctx, 192);
    ctx.fillRect(0, (row + 1) * rh - 1, w, 1);            // row shadow
  }
}

function paintStone(ctx, w, h) {
  // Offset stone blocks with mortar joints.
  const r = makeRng(23);
  lum(ctx, 198);
  ctx.fillRect(0, 0, w, h);                               // mortar
  const rows = 4, rh = h / rows;
  for (let row = 0; row < rows; row++) {
    const cols = 3 + (row % 2), cw = w / cols, off = (row % 2) * (cw / 2);
    for (let i = -1; i <= cols; i++) {
      lum(ctx, 222 + r() * 30);
      ctx.fillRect(i * cw + off + 1, row * rh + 1, cw - 2, rh - 2);
    }
  }
}

function paintDoor(ctx, w, h) {
  // Four recessed door panels over vertical grain.
  const r = makeRng(31);
  lum(ctx, 234);
  ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 26; k++) {
    lum(ctx, 222 + r() * 20);
    ctx.fillRect((r() * w) | 0, (r() * h) | 0, 1, 6 + ((r() * 10) | 0));
  }
  for (const [px, py] of [[w * 0.14, h * 0.08], [w * 0.56, h * 0.08], [w * 0.14, h * 0.56], [w * 0.56, h * 0.56]]) {
    const pw = w * 0.3, ph = h * 0.36;
    lum(ctx, 200); ctx.fillRect(px, py, pw, ph);
    lum(ctx, 246); ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    lum(ctx, 226); ctx.fillRect(px + 4, py + 4, pw - 8, ph - 8);
  }
}

function paintMetal(ctx, w, h) {
  // Corrugated sheets: vertical ribs + two seam lines.
  for (let x = 0; x < w; x += 8) {
    lum(ctx, 210); ctx.fillRect(x, 0, 2, h);
    lum(ctx, 232); ctx.fillRect(x + 2, 0, 3, h);
    lum(ctx, 252); ctx.fillRect(x + 5, 0, 3, h);
  }
  lum(ctx, 202);
  ctx.fillRect(0, Math.round(h * 0.33), w, 1);
  ctx.fillRect(0, Math.round(h * 0.66), w, 1);
}

function paintBrick(ctx, w, h) {
  const r = makeRng(43);
  lum(ctx, 202);
  ctx.fillRect(0, 0, w, h);                               // mortar
  const rows = 8, rh = h / rows, bw = w / 4;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * (bw / 2);
    for (let i = -1; i < 5; i++) {
      lum(ctx, 224 + r() * 30);
      ctx.fillRect(i * bw + off + 1, row * rh + 1, bw - 2, rh - 2);
    }
  }
}

function paintPatch(ctx, w, h) {
  // Loose weave + sewn-on patches with stitch dashes (scarecrow shirt).
  const r = makeRng(53);
  lum(ctx, 236);
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { lum(ctx, 226); ctx.fillRect(0, y, w, 1); }
  for (let x = 0; x < w; x += 4) { lum(ctx, 230); ctx.fillRect(x, 0, 1, h); }
  for (const [px, py, s] of [[8, 10, 16], [38, 34, 18], [14, 42, 12]]) {
    lum(ctx, 208 + r() * 14);
    ctx.fillRect(px, py, s, s);
    lum(ctx, 186);
    for (let d = 0; d < s; d += 4) {
      ctx.fillRect(px + d, py - 1, 2, 1); ctx.fillRect(px + d, py + s, 2, 1);
      ctx.fillRect(px - 1, py + d, 1, 2); ctx.fillRect(px + s, py + d, 1, 2);
    }
  }
}

const _TEX_PAINTERS = {
  planks: paintPlanks,
  shingles: paintShingles,
  stone: paintStone,
  door: paintDoor,
  metal: paintMetal,
  brick: paintBrick,
  patch: paintPatch,
};

const _texCache = new Map();

/** Cached 64px NearestFilter canvas texture by name (null outside the DOM). */
function tex(name) {
  if (typeof document === 'undefined') return null;
  let t = _texCache.get(name);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  _TEX_PAINTERS[name](c.getContext('2d'), 64, 64);
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _texCache.set(name, t);
  return t;
}

/* ------------------------------------------------------------------ *
 *  Shared cached materials & geometries
 * ------------------------------------------------------------------ */

const _matCache = new Map();

/**
 * Cached MeshLambertMaterial by color, flat-shading flag and (optional)
 * procedural texture key ('planks' | 'shingles' | 'stone' | 'door' |
 * 'metal' | 'brick' | 'patch').
 */
export function mat(hex, flat = false, texKey = null) {
  const key = hex + (flat ? '|f' : '') + (texKey ? '|t' + texKey : '');
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: flat });
    if (texKey) m.map = tex(texKey);
    _matCache.set(key, m);
  }
  return m;
}

/** Cached emissive MeshLambertMaterial (shared — do not animate these). */
function emat(hex, emissiveHex, intensity = 0.9, flat = false) {
  const key = `${hex}|e${emissiveHex}|${intensity}${flat ? '|f' : ''}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: hex,
      emissive: emissiveHex,
      emissiveIntensity: intensity,
      flatShading: flat,
    });
    _matCache.set(key, m);
  }
  return m;
}

const _geoCache = new Map();
function _geo(key, build) {
  let g = _geoCache.get(key);
  if (!g) { g = build(); _geoCache.set(key, g); }
  return g;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function cylGeo(rt, rb, h, seg = 8) {
  return _geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}
// Cylinder with its axis along X (wheels, axles, hay bales).
function cylXGeo(r, h, seg = 8) {
  return _geo(`cx${r},${h},${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}
// Cylinder with its axis along Z (mailbox roof, windmill hub, headlights).
function cylZGeo(r, h, seg = 8) {
  return _geo(`cz${r},${h},${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateX(Math.PI / 2);
    return g;
  });
}
function coneGeo(r, h, seg = 8) {
  return _geo(`co${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}
function sphGeo(r, w = 8, h = 6) {
  return _geo(`sp${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
}
function domeGeo(r, w = 10, h = 5) {
  return _geo(`dm${r},${w},${h}`, () =>
    new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2));
}
function icoGeo(r) {
  return _geo(`ic${r}`, () => new THREE.IcosahedronGeometry(r, 0));
}
function torusGeo(r, t, a = 6, b = 12) {
  return _geo(`to${r},${t},${a},${b}`, () => new THREE.TorusGeometry(r, t, a, b));
}

/* ------------------------------------------------------------------ *
 *  Small builder helpers
 * ------------------------------------------------------------------ */

function applyShadows(m, cast = true, recv = true) {
  if (ENABLE_SHADOWS) { m.castShadow = cast; m.receiveShadow = recv; }
  return m;
}

/** Box mesh from the shared unit cube (scaled), added to parent. */
function box(parent, w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  applyShadows(m);
  if (parent) parent.add(m);
  return m;
}

/** Generic mesh helper, added to parent. */
function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  applyShadows(m);
  if (parent) parent.add(m);
  return m;
}

/** Pivot group positioned at a joint. */
function pivot(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

/* ------------------------------------------------------------------ *
 *  blobShadow — cheap ground shadow for dynamic entities
 * ------------------------------------------------------------------ */

const _blobGeo = new THREE.CircleGeometry(1, 16);
const _blobMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
});

/** Ground-hugging dark circle (y = 0.02). Scale = radius. */
export function blobShadow(radius) {
  const m = new THREE.Mesh(_blobGeo, _blobMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.scale.setScalar(radius);
  m.renderOrder = 1;
  return m;
}

/* ------------------------------------------------------------------ *
 *  createUFO — diameter ~5, height ~2.2. The hero model.
 *  userData: { dome, ring, lights: Mesh[8], beamAnchor }
 *  Two-tone hull (light top / dark underside), panel-line ring segments,
 *  rivets, antenna, glass dome with an alien pilot at a blinking console,
 *  concentric underside rings + emissive emitter lens, 8 rim lights.
 * ------------------------------------------------------------------ */

export function createUFO() {
  const g = new THREE.Group();
  const hullTop = mat(0xb7c3d6, true);     // lighter top shell
  const hullLow = mat(0x76849b, true);     // darker underside
  const greeble = mat(0x55607a, true);

  // ---- Underside: emissive emitter lens + concentric detail rings.
  const emitter = add(g, cylGeo(0.55, 0.74, 0.2, 10),
    emat(COLORS.beam, COLORS.beam, 1.0, true), 0, 0.1, 0);
  emitter.castShadow = false;
  add(g, cylGeo(1.42, 0.66, 0.55, 10), hullLow, 0, 0.5, 0);    // hub cone
  add(g, cylGeo(1.46, 1.34, 0.1, 12), greeble, 0, 0.31, 0);    // inner ring
  add(g, cylGeo(1.98, 1.88, 0.14, 12), hullLow, 0, 0.46, 0);   // outer ring
  for (let i = 0; i < 4; i++) {                                 // greeble pods
    const a = (i / 4) * PI2 + 0.4;
    box(g, 0.34, 0.22, 0.3, i % 2 ? greeble : hullLow,
      Math.cos(a) * 1.55, 0.5, Math.sin(a) * 1.55).rotation.y = -a;
  }

  // ---- Hull: flattened two-tone lens (light cap over dark belly).
  const bodyTop = add(g, sphGeo(2.5, 10, 6), hullTop, 0, 1.02, 0);
  bodyTop.scale.set(1, 0.32, 1);
  const bodyLow = add(g, sphGeo(2.44, 10, 6), hullLow, 0, 0.92, 0);
  bodyLow.scale.set(1, 0.3, 1);

  // Panel lines: 8 radial seam strips over the upper hull.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2 + Math.PI / 8;
    const seg = box(g, 0.05, 0.04, 0.85, greeble,
      Math.cos(a + Math.PI / 2) * 1.78, 1.32, Math.sin(a + Math.PI / 2) * 1.78);
    seg.rotation.order = 'YXZ';
    seg.rotation.y = -(a + Math.PI / 2) + Math.PI / 2;
    seg.rotation.x = 0.42;
  }
  // Rivet dots around the rim.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI2 + 0.15;
    const rv = box(g, 0.09, 0.07, 0.09, greeble, Math.cos(a) * 2.32, 1.16, Math.sin(a) * 2.32);
    rv.rotation.y = -a;
  }

  // ---- Rim ring (counter-rotated by ufo.js) carrying 8 light bulbs.
  const ring = pivot(g, 0, 1.0, 0);
  const torus = add(ring, torusGeo(2.55, 0.18, 6, 14), mat(0x7a8696, true), 0, 0, 0);
  torus.rotation.x = Math.PI / 2;
  const lights = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2;
    // Each bulb gets its OWN material so gameplay can blink them individually.
    const bm = new THREE.MeshLambertMaterial({
      color: COLORS.ufoGlow,
      emissive: COLORS.ufoGlow,
      emissiveIntensity: 1.0,
      flatShading: true,
    });
    const b = add(ring, sphGeo(0.16, 6, 4), bm, Math.cos(a) * 2.62, -0.05, Math.sin(a) * 2.62);
    b.castShadow = false;
    lights.push(b);
  }

  // ---- Dome collar + antenna with emissive tip.
  add(g, cylGeo(1.24, 1.34, 0.16, 10), greeble, 0, 1.5, 0);
  box(g, 0.04, 0.5, 0.04, greeble, 0.78, 1.62, -0.55);
  const antTip = add(g, sphGeo(0.07, 5, 4), emat(0xff6b9d, 0xff2d78, 1.0, true), 0.78, 1.9, -0.55);
  antTip.castShadow = false;

  // ---- Cockpit: console with blinking boxes + alien pilot.
  const alien = pivot(g, 0, 1.45, 0);
  const green = mat(0x3a7d44, true);
  box(alien, 0.56, 0.14, 0.3, greeble, 0, 0.16, 0.42);                 // console desk
  const bl1 = box(alien, 0.1, 0.07, 0.06, emat(0xff5252, 0xff1744, 1.0), -0.14, 0.27, 0.42);
  bl1.castShadow = false;
  const bl2 = box(alien, 0.1, 0.07, 0.06, emat(0x7ce8ff, 0x00b8d4, 1.0), 0.14, 0.27, 0.42);
  bl2.castShadow = false;
  add(alien, cylGeo(0.16, 0.26, 0.3, 7), green, 0, 0.13, 0);           // little body
  const aHead = add(alien, sphGeo(0.24, 7, 5), green, 0, 0.45, 0);     // big head
  aHead.scale.set(1, 1.15, 0.95);
  box(alien, 0.09, 0.13, 0.04, mat(0x101418), -0.1, 0.48, 0.21);       // left eye
  box(alien, 0.09, 0.13, 0.04, mat(0x101418), 0.1, 0.48, 0.21);        // right eye
  for (const s of [-1, 1]) {                                            // arms on console
    const arm = box(alien, 0.05, 0.05, 0.3, green, s * 0.16, 0.2, 0.22);
    arm.rotation.x = -0.35;
  }

  // ---- Tinted glass dome (unique material — ufo.js may pulse it).
  const domeMat = new THREE.MeshLambertMaterial({
    color: COLORS.ufoDome,
    emissive: COLORS.ufoDome,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    flatShading: true,
  });
  const dome = add(g, domeGeo(1.15, 10, 5), domeMat, 0, 1.35, 0);
  dome.scale.set(1, 0.8, 1);
  dome.castShadow = false;

  // Beam anchor at the bottom center.
  const beamAnchor = new THREE.Object3D();
  beamAnchor.position.set(0, 0.08, 0);
  g.add(beamAnchor);

  g.userData = { dome, ring, lights, beamAnchor };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCow — 'holstein' | 'brown' | 'golden'. ~2.2 long, ~1.6 tall.
 *  userData: { head, legs: [FL, FR, BL, BR], tail, body }
 *  legs/head/tail are pivot Groups at hip / neck / tail-base.
 *  v2: asymmetric patch maps, brows, neck-strap bell, pink inner ears,
 *  nose ring on 'brown', emissive glow patches + stars on 'golden'.
 * ------------------------------------------------------------------ */

export function createCow(variant = 'holstein') {
  const g = new THREE.Group();
  const golden = variant === 'golden';
  const brown = variant === 'brown';

  const bodyMat = golden ? emat(COLORS.gold, 0xffb300, 0.45)
    : brown ? mat(COLORS.cowBrown)
      : mat(COLORS.cowWhite);
  const darkMat = golden ? emat(0xffe082, 0xffa000, 0.35)
    : brown ? mat(0x6b4226)
      : mat(COLORS.cowBlack);
  const hoofMat = mat(0x4a3a30);
  const pinkMat = mat(COLORS.cowPink);
  const hornMat = golden ? emat(COLORS.gold, 0xffca28, 0.6) : mat(0xf0e6c8);

  // Body + chest + rump.
  const body = box(g, 1.0, 0.74, 1.42, bodyMat, 0, 1.0, 0);
  box(g, 0.9, 0.6, 0.3, bodyMat, 0, 1.02, 0.78);
  box(g, 0.86, 0.56, 0.22, bodyMat, 0, 1.04, -0.78);

  // Asymmetric patches (thin boxes proud of the body) — different per side.
  if (golden) {
    // Emissive glow patches instead of pigment.
    const glowP = emat(0xfff3c4, 0xffd54f, 0.8);
    box(g, 0.06, 0.36, 0.48, glowP, -0.51, 1.05, 0.1).castShadow = false;
    box(g, 0.42, 0.06, 0.4, glowP, 0.14, 1.39, -0.28).castShadow = false;
  } else {
    const patch = brown ? mat(0xa9714b) : darkMat;
    box(g, 0.08, 0.44, 0.56, patch, -0.5, 1.08, 0.22);     // left shoulder blob
    box(g, 0.08, 0.3, 0.34, patch, -0.5, 0.88, -0.46);     // left hip spot
    box(g, 0.08, 0.5, 0.66, patch, 0.5, 0.98, -0.18);      // big right-side map
    box(g, 0.55, 0.08, 0.52, patch, 0.14, 1.38, -0.32);    // back saddle
    box(g, 0.34, 0.08, 0.3, patch, -0.2, 1.38, 0.44);      // small back spot
  }

  // Udder + four teats.
  box(g, 0.5, 0.26, 0.5, pinkMat, 0, 0.58, -0.3);
  for (const dx of [-0.14, 0.14]) {
    for (const dz of [-0.42, -0.18]) {
      box(g, 0.07, 0.16, 0.07, pinkMat, dx, 0.44, dz);
    }
  }

  // Legs — pivot at the hip (y = 0.62). Order: FL, FR, BL, BR.
  const legs = [];
  for (const [lx, lz] of [[0.34, 0.46], [-0.34, 0.46], [0.34, -0.46], [-0.34, -0.46]]) {
    const hip = pivot(g, lx, 0.62, lz);
    box(hip, 0.24, 0.5, 0.24, bodyMat, 0, -0.26, 0);
    box(hip, 0.26, 0.13, 0.26, hoofMat, 0, -0.56, 0);
    legs.push(hip);
  }

  // Tail — pivot at the base, hangs down, dark tuft at the end.
  const tail = pivot(g, 0, 1.32, -0.74);
  const tailSeg = box(tail, 0.09, 0.5, 0.09, bodyMat, 0, -0.24, -0.06);
  tailSeg.rotation.x = 0.18;
  box(tail, 0.15, 0.2, 0.15, darkMat, 0, -0.52, -0.12);

  // Bell on a neck strap (the proper farm accessory).
  const strap = box(g, 0.66, 0.1, 0.56, mat(0x7a3b2e), 0, 1.18, 0.62);
  strap.rotation.x = 0.25;
  const bell = box(g, 0.16, 0.18, 0.12,
    golden ? emat(COLORS.gold, 0xffc107, 0.9) : emat(COLORS.gold, 0xc79a1e, 0.25),
    0, 1.0, 0.84);
  bell.castShadow = false;
  box(g, 0.05, 0.06, 0.05, mat(0x4a3a30), 0, 0.9, 0.85);   // clapper

  // Head — pivot at the neck; nods with rotation.x.
  const head = pivot(g, 0, 1.25, 0.66);
  box(head, 0.62, 0.54, 0.5, bodyMat, 0, 0.12, 0.22);
  if (!golden && !brown) box(head, 0.24, 0.26, 0.05, darkMat, 0.17, 0.18, 0.455); // eye patch
  // Snout + nostrils.
  box(head, 0.46, 0.28, 0.24, pinkMat, 0, -0.06, 0.5);
  box(head, 0.06, 0.09, 0.05, mat(0x8c4a5a), -0.12, -0.04, 0.61);
  box(head, 0.06, 0.09, 0.05, mat(0x8c4a5a), 0.12, -0.04, 0.61);
  // Nose ring on the brown bull.
  if (brown) {
    const ringM = add(head, torusGeo(0.08, 0.025, 5, 8), emat(COLORS.gold, 0xc79a1e, 0.25, true), 0, -0.16, 0.62);
    ringM.castShadow = false;
  }
  // Eyes + sleepy brows for charm.
  box(head, 0.07, 0.12, 0.05, mat(0x14110e), -0.19, 0.2, 0.46);
  box(head, 0.07, 0.12, 0.05, mat(0x14110e), 0.19, 0.2, 0.46);
  const browM = brown ? mat(0x5d4037) : darkMat;
  const browL = box(head, 0.12, 0.04, 0.05, browM, -0.19, 0.3, 0.465);
  browL.rotation.z = -0.2;
  const browR = box(head, 0.12, 0.04, 0.05, browM, 0.19, 0.3, 0.465);
  browR.rotation.z = 0.2;
  // Ears with pink inner ears.
  for (const s of [-1, 1]) {
    const ear = box(head, 0.26, 0.13, 0.18, bodyMat, s * 0.42, 0.3, 0.12);
    ear.rotation.z = s * 0.35;
    const inner = box(head, 0.16, 0.06, 0.11, pinkMat, s * 0.45, 0.27, 0.13);
    inner.rotation.z = s * 0.35;
  }
  // Horns + forelock tuft.
  for (const s of [-1, 1]) {
    const horn = box(head, 0.1, 0.2, 0.1, hornMat, s * 0.2, 0.44, 0.1);
    horn.rotation.z = s * -0.35;
  }
  box(head, 0.3, 0.1, 0.2, brown ? mat(0x5d4037) : darkMat, 0, 0.42, 0.3);

  // Golden cow: floating sparkle stars.
  if (golden) {
    const starMat = emat(COLORS.gold, 0xffd54f, 1.0);
    for (const [sx, sy, sz, ss] of [[0.7, 1.75, 0.1, 0.13], [-0.62, 1.95, 0.35, 0.1], [0.15, 2.05, -0.5, 0.11]]) {
      const star = box(g, ss, ss, ss, starMat, sx, sy, sz);
      star.rotation.set(0.5, 0.7, 0.5);
      star.castShadow = false;
    }
  }

  g.userData = { head, legs, tail, body };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createFarmer — variant 0|1|2. ~2 tall.
 *  userData: { head, arms: [l, r], legs: [l, r], gun, gunTip }
 *  Arms pivot at shoulders, legs at hips, head at neck. Gun is parented
 *  to the right arm; raising arms[1] (rotation.x = -PI/2) aims forward.
 *  Variants: 0 red plaid shirt + straw hat | 1 blue shirt + brown vest +
 *  cap | 2 green shirt + bandana + grey beard. All wear overalls with
 *  straps/buttons/pocket, rolled sleeves, work gloves, heeled boots, and
 *  carry a double-barrel shotgun with an emissive-orange muzzle dot.
 * ------------------------------------------------------------------ */

export function createFarmer(variant = 0) {
  const g = new THREE.Group();
  const v = ((variant % 3) + 3) % 3;
  const shirtHex = [COLORS.shirt, 0x3f6fb5, 0x43a047][v];
  const cuffHex = [0xef7c4a, 0x6f97d1, 0x66bb6a][v];
  const beardHex = [0x6d4c41, 0x4e342e, 0x9e9e9e][v];
  const shirt = mat(shirtHex);
  const cuff = mat(cuffHex);
  const denim = mat(COLORS.denim);
  const denimD = mat(0x33598f);
  const skin = mat(COLORS.skin);
  const boot = mat(0x4e342e);
  const glove = mat(0xc9a36a);

  // Legs — pivot at the hips. [left(+X), right(-X)]
  const legL = pivot(g, 0.17, 0.98, 0);
  const legR = pivot(g, -0.17, 0.98, 0);
  for (const leg of [legL, legR]) {
    box(leg, 0.27, 0.82, 0.29, denim, 0, -0.45, 0);
    box(leg, 0.3, 0.18, 0.42, boot, 0, -0.89, 0.05);            // boot + toe
    box(leg, 0.32, 0.08, 0.3, boot, 0, -0.82, -0.02);           // boot cuff
    box(leg, 0.28, 0.08, 0.14, mat(0x36241c), 0, -0.94, -0.1);  // heel block
  }

  // Hips + torso.
  box(g, 0.72, 0.32, 0.46, denim, 0, 1.06, 0);
  box(g, 0.78, 0.62, 0.5, shirt, 0, 1.43, 0);

  // Per-variant chest dressing.
  if (v === 0) {
    // Red plaid: thin overlay stripes (2 vertical + 1 horizontal).
    const plaid = mat(0x8e2a23);
    box(g, 0.07, 0.6, 0.52, plaid, -0.26, 1.43, 0);
    box(g, 0.07, 0.6, 0.52, plaid, 0.26, 1.43, 0);
    box(g, 0.8, 0.07, 0.52, plaid, 0, 1.55, 0);
  } else if (v === 1) {
    // Brown vest: two front panels + back panel.
    const vest = mat(0x6d4c41);
    box(g, 0.22, 0.6, 0.08, vest, -0.26, 1.43, 0.24);
    box(g, 0.22, 0.6, 0.08, vest, 0.26, 1.43, 0.24);
    box(g, 0.8, 0.6, 0.08, vest, 0, 1.43, -0.24);
  } else {
    // Red neck bandana, knot at the front.
    const bandana = mat(0xc62828);
    box(g, 0.5, 0.14, 0.5, bandana, 0, 1.7, 0.04);
    box(g, 0.14, 0.2, 0.08, bandana, 0.1, 1.58, 0.27);
  }

  // Overalls bib + chest pocket + straps with gold buttons.
  box(g, 0.5, 0.42, 0.1, denim, 0, 1.42, 0.26);
  box(g, 0.26, 0.18, 0.04, denimD, 0, 1.36, 0.32);              // bib pocket
  for (const s of [-1, 1]) {
    const strap = box(g, 0.11, 0.38, 0.07, denim, s * 0.17, 1.63, 0.24);
    strap.rotation.x = -0.12;
    box(g, 0.11, 0.07, 0.34, denim, s * 0.17, 1.76, 0.05);      // over the shoulder
    const btn = box(g, 0.07, 0.07, 0.05, emat(COLORS.gold, 0xc79a1e, 0.25), s * 0.17, 1.56, 0.32);
    btn.castShadow = false;
  }

  // Arms — pivot at the shoulders. [left(+X), right(-X)]
  const arms = [];
  for (const s of [1, -1]) {
    const arm = pivot(g, s * 0.47, 1.66, 0);
    box(arm, 0.21, 0.36, 0.23, shirt, 0, -0.18, 0);   // sleeve
    box(arm, 0.25, 0.11, 0.27, cuff, 0, -0.38, 0);    // rolled cuff
    box(arm, 0.18, 0.3, 0.2, skin, 0, -0.58, 0);      // bare forearm
    box(arm, 0.2, 0.16, 0.2, glove, 0, -0.8, 0.02);   // work glove
    arms.push(arm);
  }
  const [armL, armR] = arms;

  // Double-barreled shotgun in the right hand. Built pointing +Z, then
  // rotated to lie along the arm (-Y) at a slight "low ready" angle —
  // raising the arm (arms[1].rotation.x = -PI/2) aims it forward and a
  // touch upward, right at UFO altitude.
  const gun = pivot(armR, -0.04, -0.7, 0.18);
  gun.rotation.x = Math.PI / 2 - 0.35;
  const gunMetal = mat(0x37474f);
  const stock = box(gun, 0.13, 0.17, 0.4, mat(COLORS.woodDark), 0, -0.04, -0.32);
  stock.rotation.x = -0.2;
  box(gun, 0.13, 0.15, 0.34, mat(0x546e7a), 0, 0.02, 0);        // receiver
  box(gun, 0.1, 0.1, 0.26, mat(COLORS.wood), 0, -0.06, 0.32);   // fore-grip
  for (const s of [-1, 1]) {                                     // twin barrels
    const barrel = add(gun, cylGeo(0.045, 0.045, 0.72, 6), gunMetal, s * 0.05, 0.06, 0.5);
    barrel.rotation.x = Math.PI / 2;
  }
  box(gun, 0.17, 0.07, 0.07, gunMetal, 0, 0.06, 0.78);          // barrel band
  const muzzle = box(gun, 0.13, 0.1, 0.05, emat(0xffab40, 0xff6d00, 0.9), 0, 0.06, 0.86);
  muzzle.castShadow = false;                                     // hot muzzle dot
  const gunTip = new THREE.Object3D();
  gunTip.position.set(0, 0.06, 0.88);
  gun.add(gunTip);

  // Head — pivot at the neck.
  const head = pivot(g, 0, 1.76, 0);
  box(head, 0.46, 0.42, 0.42, skin, 0, 0.23, 0);
  box(head, 0.07, 0.1, 0.04, mat(0x14110e), -0.11, 0.3, 0.215);  // eyes
  box(head, 0.07, 0.1, 0.04, mat(0x14110e), 0.11, 0.3, 0.215);
  box(head, 0.09, 0.1, 0.08, mat(0xdda575), 0, 0.22, 0.24);      // nose
  box(head, 0.38, 0.16, 0.12, mat(beardHex), 0, 0.08, 0.19);     // beard
  box(head, 0.3, 0.07, 0.06, mat(beardHex), 0, 0.17, 0.235);     // mustache

  // Per-variant headgear.
  if (v === 0) {
    // Wide straw hat with red band.
    box(head, 0.72, 0.06, 0.68, mat(COLORS.straw), 0, 0.46, 0);
    box(head, 0.38, 0.22, 0.36, mat(COLORS.straw), 0, 0.58, 0);
    box(head, 0.4, 0.07, 0.38, mat(0x8a3324), 0, 0.51, 0);
  } else if (v === 1) {
    // Flat cap with a stubby bill.
    box(head, 0.5, 0.16, 0.48, mat(0x546e7a), 0, 0.5, 0);
    box(head, 0.4, 0.05, 0.2, mat(0x455a64), 0, 0.45, 0.3);
    box(head, 0.08, 0.05, 0.08, mat(0x455a64), 0, 0.59, 0);      // cap button
  } else {
    // Grey hair under a worn leather hat.
    box(head, 0.48, 0.1, 0.44, mat(0x9e9e9e), 0, 0.46, -0.02);
    box(head, 0.62, 0.06, 0.58, mat(0x5d4037), 0, 0.5, 0);
    box(head, 0.34, 0.18, 0.32, mat(0x5d4037), 0, 0.6, 0);
  }

  g.userData = { head, arms: [armL, armR], legs: [legL, legR], gun, gunTip };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createChicken — ~0.55 tall. userData: { head, wings: [l, r] }
 * ------------------------------------------------------------------ */

export function createChicken() {
  const g = new THREE.Group();
  const white = mat(0xfafafa);
  const cream = mat(0xefe8d8);
  const orange = mat(0xffa726);
  const red = mat(0xe53935);

  // Legs + feet.
  for (const s of [-1, 1]) {
    box(g, 0.05, 0.14, 0.05, orange, s * 0.06, 0.07, 0);
    box(g, 0.09, 0.03, 0.12, orange, s * 0.06, 0.015, 0.04);
  }

  // Body + breast + layered tail feathers.
  box(g, 0.3, 0.25, 0.4, white, 0, 0.26, 0);
  box(g, 0.24, 0.17, 0.1, cream, 0, 0.23, 0.23);
  const tail = box(g, 0.14, 0.21, 0.12, white, 0, 0.4, -0.21);
  tail.rotation.x = 0.5;
  const tail2 = box(g, 0.1, 0.16, 0.09, cream, 0, 0.46, -0.26);
  tail2.rotation.x = 0.7;

  // Wings — pivot at the top (shoulder), rotation.z flaps them out.
  const wings = [];
  for (const s of [1, -1]) {
    const wing = pivot(g, s * 0.16, 0.36, -0.02);
    box(wing, 0.05, 0.16, 0.26, white, s * 0.02, -0.09, 0);
    box(wing, 0.055, 0.06, 0.2, cream, s * 0.02, -0.16, -0.03);  // wing-tip shade
    wings.push(wing);
  }

  // Head — pivot at the neck; pecks with rotation.x.
  const head = pivot(g, 0, 0.36, 0.14);
  box(head, 0.19, 0.21, 0.17, white, 0, 0.1, 0.04);
  box(head, 0.04, 0.06, 0.04, mat(0x14110e), -0.05, 0.13, 0.13);  // eyes
  box(head, 0.04, 0.06, 0.04, mat(0x14110e), 0.05, 0.13, 0.13);
  box(head, 0.06, 0.05, 0.11, orange, 0, 0.08, 0.17);             // beak
  box(head, 0.04, 0.08, 0.04, red, 0, 0.0, 0.14);                 // wattle
  box(head, 0.04, 0.08, 0.09, red, 0, 0.24, 0.04);                // comb
  box(head, 0.04, 0.06, 0.05, red, 0, 0.22, 0.11);

  g.userData = { head, wings };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createSheep — ~1.6 long, ~1.2 tall. userData: { head, legs: [4], tail }
 *  Chunky stacked-wool body, darker face/legs, little ears.
 *  Legs pivot at the hips, head nods at the neck.
 * ------------------------------------------------------------------ */

export function createSheep() {
  const g = new THREE.Group();
  const wool = mat(COLORS.wool);
  const woolLt = mat(0xf4f1e7);
  const dark = mat(0x4a4039);
  const pink = mat(COLORS.cowPink);

  // Wool body: main slab + offset lumps for that cauliflower silhouette.
  box(g, 0.86, 0.58, 1.1, wool, 0, 0.74, 0);
  const lumpA = box(g, 0.72, 0.34, 0.84, woolLt, 0.06, 1.04, 0.1);
  lumpA.rotation.y = 0.12;
  const lumpB = box(g, 0.5, 0.26, 0.5, wool, -0.18, 1.12, -0.32);
  lumpB.rotation.y = -0.2;
  box(g, 0.7, 0.4, 0.34, woolLt, -0.04, 0.8, 0.58);    // chest puff
  box(g, 0.62, 0.36, 0.28, wool, 0.05, 0.82, -0.6);    // rump puff

  // Legs — dark + slim, pivot at the hip. Order: FL, FR, BL, BR.
  const legs = [];
  for (const [lx, lz] of [[0.26, 0.38], [-0.26, 0.38], [0.26, -0.38], [-0.26, -0.38]]) {
    const hip = pivot(g, lx, 0.5, lz);
    box(hip, 0.15, 0.42, 0.15, dark, 0, -0.22, 0);
    box(hip, 0.17, 0.09, 0.17, mat(0x2e2722), 0, -0.46, 0);
    legs.push(hip);
  }

  // Tail — a wool nub, pivot at the base so it can waggle.
  const tail = pivot(g, 0, 1.0, -0.74);
  box(tail, 0.18, 0.22, 0.16, woolLt, 0, -0.04, -0.04);

  // Head — pivot at the neck; dark face with a wool cap.
  const head = pivot(g, 0, 1.0, 0.62);
  box(head, 0.34, 0.36, 0.36, dark, 0, 0.06, 0.16);
  box(head, 0.4, 0.2, 0.3, woolLt, 0, 0.28, 0.06);     // wool toupee
  box(head, 0.06, 0.09, 0.04, mat(0x14110e), -0.1, 0.12, 0.345);  // eyes
  box(head, 0.06, 0.09, 0.04, mat(0x14110e), 0.1, 0.12, 0.345);
  box(head, 0.1, 0.07, 0.05, pink, 0, -0.06, 0.34);    // little pink nose
  for (const s of [-1, 1]) {                            // droopy little ears
    const ear = box(head, 0.18, 0.09, 0.12, dark, s * 0.24, 0.12, 0.1);
    ear.rotation.z = s * 0.55;
  }

  g.userData = { head, legs, tail };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createDuck — ~0.5 long mallard. userData: { head, wings: [l, r] }
 *  Origin at the WATERLINE (bottom of the body — it floats, no legs).
 *  Green head, white neck ring, yellow bill, raised curly tail tip.
 * ------------------------------------------------------------------ */

export function createDuck() {
  const g = new THREE.Group();
  const bodyM = mat(COLORS.duck);
  const breast = mat(0x6e5230);
  const headM = mat(COLORS.duckHead);

  // Body sits on the waterline; chest slightly proud.
  box(g, 0.26, 0.18, 0.44, bodyM, 0, 0.09, 0);
  box(g, 0.22, 0.14, 0.12, breast, 0, 0.1, 0.22);
  // Raised tail tip with the mallard curl.
  const tail = box(g, 0.12, 0.08, 0.14, bodyM, 0, 0.18, -0.22);
  tail.rotation.x = 0.55;
  const curl = box(g, 0.05, 0.05, 0.07, mat(0x2b2b2b), 0, 0.25, -0.27);
  curl.rotation.x = 0.9;

  // Folded wings — pivot at the shoulders, rotation.z flaps.
  const wings = [];
  for (const s of [1, -1]) {
    const wing = pivot(g, s * 0.14, 0.17, -0.02);
    const w = box(wing, 0.04, 0.1, 0.26, breast, s * 0.01, -0.05, -0.02);
    w.rotation.x = 0.08;
    wings.push(wing);
  }

  // Head — pivot at the neck; white ring, green head, yellow bill.
  const head = pivot(g, 0, 0.18, 0.16);
  box(head, 0.13, 0.05, 0.12, mat(0xfafafa), 0, 0.02, 0.01);     // neck ring
  box(head, 0.15, 0.16, 0.15, headM, 0, 0.13, 0.02);
  box(head, 0.03, 0.04, 0.03, mat(0x14110e), -0.055, 0.16, 0.085); // eyes
  box(head, 0.03, 0.04, 0.03, mat(0x14110e), 0.055, 0.16, 0.085);
  box(head, 0.09, 0.045, 0.12, mat(0xf2b53a), 0, 0.1, 0.14);     // bill
  box(head, 0.05, 0.02, 0.04, mat(0xd99a23), 0, 0.085, 0.19);    // bill nail

  g.userData = { head, wings };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createOwl — ~0.45 tall. userData: { head, wings: [l, r] }
 *  Big white-disc eyes with black pupils, ear tufts, folded wings.
 * ------------------------------------------------------------------ */

export function createOwl() {
  const g = new THREE.Group();
  const brown = mat(0x6d4c41);
  const tawny = mat(0x8d6e63);
  const creamM = mat(0xe8dcc2);

  // Feet + plump body with a speckle-cream belly.
  box(g, 0.07, 0.04, 0.09, mat(0xd99a23), -0.06, 0.02, 0.02);
  box(g, 0.07, 0.04, 0.09, mat(0xd99a23), 0.06, 0.02, 0.02);
  box(g, 0.22, 0.26, 0.18, brown, 0, 0.17, 0);
  box(g, 0.16, 0.2, 0.04, creamM, 0, 0.16, 0.09);
  const tail = box(g, 0.12, 0.05, 0.12, tawny, 0, 0.06, -0.1);
  tail.rotation.x = -0.5;

  // Folded wings — pivot at the shoulders, rotation.z lifts them.
  const wings = [];
  for (const s of [1, -1]) {
    const wing = pivot(g, s * 0.12, 0.28, 0);
    const w = box(wing, 0.045, 0.2, 0.14, tawny, s * 0.005, -0.1, -0.01);
    w.rotation.x = 0.06;
    wings.push(wing);
  }

  // Head — pivot at the neck (owls love to swivel).
  const head = pivot(g, 0, 0.3, 0);
  box(head, 0.24, 0.18, 0.2, brown, 0, 0.08, 0);
  // Big eyes: white disc + black pupil (slightly asymmetric squint).
  for (const s of [-1, 1]) {
    const disc = add(head, cylZGeo(0.055, 0.02, 8), mat(0xfafafa), s * 0.06, 0.1, 0.1);
    disc.castShadow = false;
    add(head, cylZGeo(0.026, 0.022, 6), mat(0x14110e), s * 0.06, 0.1 + s * 0.005, 0.105);
  }
  const beak = add(head, coneGeo(0.025, 0.06, 4), mat(0xd99a23), 0, 0.05, 0.11);
  beak.rotation.x = Math.PI / 2;
  // Ear tufts.
  for (const s of [-1, 1]) {
    const tuft = box(head, 0.05, 0.09, 0.05, brown, s * 0.09, 0.2, 0);
    tuft.rotation.z = s * -0.35;
  }

  g.userData = { head, wings };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBat — ~0.35 tall, ~0.9 wingspan. userData: { wings: [l, r] }
 *  Wing pivots are at the body, so wings[i].rotation.z flaps them.
 * ------------------------------------------------------------------ */

export function createBat() {
  const g = new THREE.Group();
  const fur = mat(0x3a3242);
  const membrane = mat(0x2a2433);

  // Body + head + big ears + beady eyes.
  box(g, 0.12, 0.16, 0.1, fur, 0, 0.16, 0);
  box(g, 0.12, 0.1, 0.1, fur, 0, 0.27, 0.01);
  box(g, 0.02, 0.03, 0.02, emat(0xffd54f, 0xffb300, 0.8), -0.035, 0.28, 0.06);
  box(g, 0.02, 0.03, 0.02, emat(0xffd54f, 0xffb300, 0.8), 0.035, 0.28, 0.06);
  for (const s of [-1, 1]) {
    const ear = box(g, 0.04, 0.08, 0.03, fur, s * 0.045, 0.345, 0);
    ear.rotation.z = s * -0.25;
  }
  box(g, 0.04, 0.05, 0.03, fur, 0, 0.07, 0);   // stubby tail nub

  // Wings — pivots AT the body sides; rotation.z flaps.
  const wings = [];
  for (const s of [1, -1]) {
    const wing = pivot(g, s * 0.06, 0.2, 0);
    const inner = box(wing, 0.2, 0.035, 0.14, membrane, s * 0.1, 0, -0.01);
    inner.rotation.y = s * -0.08;
    const outer = box(wing, 0.18, 0.03, 0.11, membrane, s * 0.28, 0.015, -0.03);
    outer.rotation.set(0, s * -0.18, s * 0.12);
    const finger = box(wing, 0.16, 0.02, 0.02, fur, s * 0.2, 0.03, 0.05);
    finger.rotation.y = s * -0.1;
    wings.push(wing);
  }

  g.userData = { wings };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createTree — 0 oak | 1 pine | 2 birch-poplar. Distinct silhouettes
 *  that read at distance. Heavily instanced — kept ≤ ~12 meshes.
 * ------------------------------------------------------------------ */

export function createTree(type = 0) {
  const g = new THREE.Group();
  const t = ((type % 3) + 3) % 3;
  if (t === 0) {
    // Oak — fat trunk with two branch stubs, 3-tone clustered canopy + apples.
    box(g, 0.55, 1.9, 0.55, mat(COLORS.wood), 0, 0.95, 0);
    box(g, 0.5, 0.26, 0.22, mat(COLORS.wood), 0.36, 1.65, 0.05).rotation.z = -0.55;
    box(g, 0.42, 0.22, 0.2, mat(COLORS.woodDark), -0.3, 1.3, -0.1).rotation.z = 0.7;
    const c1 = box(g, 2.6, 1.5, 2.6, mat(COLORS.grassB), 0, 2.6, 0);
    c1.rotation.y = 0.1;
    box(g, 1.7, 1.1, 1.7, mat(COLORS.grassC), 0.85, 3.3, 0.6);      // side cluster
    box(g, 1.5, 1.0, 1.5, mat(0x66bb6a), -0.8, 3.45, -0.5);         // side cluster
    box(g, 1.9, 1.2, 1.9, mat(COLORS.grassC), 0, 3.85, 0);
    box(g, 1.1, 0.85, 1.1, mat(COLORS.grassA), 0.1, 4.7, 0.1);
    // Tiny red apples tucked into the canopy.
    box(g, 0.14, 0.14, 0.14, mat(0xe53935), 1.1, 3.0, 1.15);
    box(g, 0.13, 0.13, 0.13, mat(0xe53935), -1.05, 3.6, 0.55);
    box(g, 0.12, 0.12, 0.12, mat(0xef5350), 0.35, 4.35, -0.85);
  } else if (t === 1) {
    // Pine — visible trunk base with root flare, 4 stacked frustum tiers.
    box(g, 0.45, 1.4, 0.45, mat(COLORS.woodDark), 0, 0.7, 0);
    box(g, 0.3, 0.35, 0.24, mat(COLORS.woodDark), 0.3, 0.17, 0.1).rotation.z = 0.5;
    box(g, 0.26, 0.32, 0.22, mat(COLORS.woodDark), -0.26, 0.16, -0.14).rotation.z = -0.5;
    const pineA = mat(0x2e7d32, true);
    const pineB = mat(0x43a047, true);
    add(g, cylGeo(0.95, 1.9, 2.0, 7), pineA, 0, 2.15, 0);
    add(g, cylGeo(0.7, 1.5, 1.8, 7), pineB, 0, 3.7, 0);
    add(g, cylGeo(0.45, 1.1, 1.6, 7), pineA, 0, 5.1, 0);
    add(g, coneGeo(0.65, 1.6, 7), pineB, 0, 6.5, 0);
  } else {
    // Birch-poplar — pale trunk with dark band marks, tall 2-tone canopy.
    box(g, 0.38, 2.0, 0.38, mat(0xddd5c4), 0, 1.0, 0);
    box(g, 0.4, 0.1, 0.4, mat(0x4a4039), 0, 0.55, 0);
    box(g, 0.4, 0.08, 0.4, mat(0x4a4039), 0, 1.15, 0);
    box(g, 0.4, 0.09, 0.4, mat(0x4a4039), 0, 1.7, 0);
    box(g, 1.35, 2.1, 1.35, mat(0x66bb6a), 0, 3.0, 0);
    box(g, 1.15, 2.0, 1.15, mat(COLORS.grassC), 0.06, 5.0, -0.05).rotation.y = 0.2;
    box(g, 0.9, 1.7, 0.9, mat(0x66bb6a), -0.05, 6.6, 0.05);
    box(g, 0.5, 1.1, 0.5, mat(COLORS.grassA), 0.04, 7.7, 0);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBush — 0 berry bush | 1 flowering blob. ~0.8–1.4.
 * ------------------------------------------------------------------ */

export function createBush(type = 0) {
  const g = new THREE.Group();
  if (((type % 2) + 2) % 2 === 0) {
    // Boxy bush cluster studded with ripe berries.
    box(g, 0.95, 0.7, 0.95, mat(COLORS.grassB), 0, 0.35, 0);
    const side = box(g, 0.6, 0.5, 0.6, mat(COLORS.grassC), 0.42, 0.32, 0.26);
    side.rotation.y = 0.3;
    box(g, 0.5, 0.45, 0.5, mat(COLORS.grassA), -0.36, 0.4, -0.2);
    box(g, 0.09, 0.09, 0.09, mat(0xe53935), 0.25, 0.68, 0.34);
    box(g, 0.08, 0.08, 0.08, mat(0xe53935), -0.2, 0.6, 0.42);
    box(g, 0.08, 0.08, 0.08, mat(0xc62828), 0.52, 0.5, -0.1);
    box(g, 0.07, 0.07, 0.07, mat(0xe53935), -0.42, 0.62, -0.38);
  } else {
    // Round flowering blob with little blossoms.
    const blob = add(g, sphGeo(0.7, 7, 5), mat(COLORS.grassC, true), 0, 0.6, 0);
    blob.scale.set(1, 0.85, 1);
    add(g, sphGeo(0.4, 6, 4), mat(COLORS.grassB, true), 0.5, 0.38, 0.2);
    box(g, 0.1, 0.1, 0.1, mat(0xffe082), -0.15, 1.18, 0.15);
    box(g, 0.09, 0.09, 0.09, mat(0xf48fb1), 0.3, 1.0, -0.28);
    box(g, 0.09, 0.09, 0.09, mat(0xf48fb1), 0.62, 0.62, 0.3);
    box(g, 0.08, 0.08, 0.08, mat(0xffffff), -0.45, 0.82, -0.1);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createRock — 0|1|2. Stacked angular chunks + moss cap + lichen flecks.
 * ------------------------------------------------------------------ */

export function createRock(type = 0) {
  const g = new THREE.Group();
  const t = ((type % 3) + 3) % 3;
  const stone = mat(COLORS.stone, true);
  const stoneLt = mat(0xb4b4b4, true);
  const moss = mat(0x6aa84f);
  const lichen = mat(0xc8cf9e);
  if (t === 0) {
    const a = box(g, 0.85, 0.55, 0.7, mat(COLORS.stone), 0, 0.26, 0);
    a.rotation.y = 0.4;
    const b = box(g, 0.45, 0.35, 0.4, mat(0xb4b4b4), 0.38, 0.17, 0.22);
    b.rotation.y = -0.3;
    const c = box(g, 0.4, 0.3, 0.36, mat(0xb4b4b4), -0.12, 0.6, -0.08);
    c.rotation.set(0.1, 0.9, 0.08);
    box(g, 0.3, 0.06, 0.26, moss, -0.1, 0.78, -0.06);
    box(g, 0.08, 0.04, 0.08, lichen, 0.3, 0.5, 0.2);
  } else if (t === 1) {
    const a = add(g, icoGeo(0.55), stone, 0, 0.4, 0);
    a.scale.set(1.1, 0.8, 1);
    a.rotation.set(0.3, 0.8, 0.1);
    const b = add(g, icoGeo(0.28), stoneLt, -0.5, 0.2, 0.15);
    b.rotation.y = 1.2;
    box(g, 0.34, 0.06, 0.3, moss, 0.02, 0.76, -0.04).rotation.y = 0.5;
    box(g, 0.07, 0.04, 0.07, lichen, -0.42, 0.36, 0.2);
    box(g, 0.06, 0.04, 0.06, lichen, 0.35, 0.55, 0.3);
  } else {
    const a = box(g, 1.15, 0.32, 0.9, mat(COLORS.stone), 0, 0.16, 0);
    a.rotation.y = 0.25;
    const b = box(g, 0.7, 0.28, 0.6, mat(0xb4b4b4), 0.1, 0.43, -0.05);
    b.rotation.y = -0.35;
    const c = box(g, 0.4, 0.24, 0.34, mat(COLORS.stone), -0.05, 0.66, 0.05);
    c.rotation.y = 0.6;
    box(g, 0.32, 0.06, 0.28, moss, -0.04, 0.8, 0.04);
    box(g, 0.08, 0.04, 0.08, lichen, 0.45, 0.34, 0.25);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBarn — ~12 x 10 x 10. Front gable faces +Z.
 *  Plank-textured walls, shingled gambrel roof with ridge cap, stone
 *  foundation strip, white corner/eave trim, X-braced sliding door with
 *  track + handles, hayloft door with hoist beam + rope + pulley, two
 *  framed windows, weather vane (arrow + rooster) on the ridge.
 * ------------------------------------------------------------------ */

export function createBarn() {
  const g = new THREE.Group();
  const red = mat(COLORS.barnRed, false, 'planks');
  const trim = mat(COLORS.barnTrim);
  const roof = mat(COLORS.roof, false, 'shingles');
  const dark = mat(0x3a2a22);

  // Stone foundation strip.
  box(g, 12.3, 0.55, 10.3, mat(COLORS.stone, false, 'stone'), 0, 0.27, 0);

  // Walls: lower + gambrel mid + upper stories (stepped under the roof).
  box(g, 12, 4.6, 10, red, 0, 2.55, 0);
  box(g, 9.2, 2.4, 10, red, 0, 5.85, 0);
  box(g, 4.0, 1.0, 10, red, 0, 7.55, 0);

  // Gambrel roof panels (steep lower, shallow upper) + ridge cap.
  for (const s of [-1, 1]) {
    const lower = box(g, 3.0, 0.18, 10.8, roof, s * 5.4, 5.9, 0);
    lower.rotation.z = -s * 0.99;
    const upper = box(g, 5.1, 0.18, 10.8, roof, s * 2.3, 8.05, 0);
    upper.rotation.z = -s * 0.382;
  }
  box(g, 0.6, 0.3, 11.0, mat(0x553b32), 0, 9.05, 0);   // ridge cap

  // White trim: corner boards + eave bands all round.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(g, 0.35, 4.6, 0.35, trim, sx * 5.95, 2.55, sz * 4.95);
    }
  }
  box(g, 12.3, 0.28, 0.28, trim, 0, 4.88, 5.0);
  box(g, 12.3, 0.28, 0.28, trim, 0, 4.88, -5.0);
  box(g, 0.28, 0.28, 10.3, trim, 6.0, 4.88, 0);
  box(g, 0.28, 0.28, 10.3, trim, -6.0, 4.88, 0);

  // Big X-braced SLIDING door: track, rollers, panel, braces, handles.
  box(g, 5.2, 0.2, 0.3, dark, 0.4, 4.45, 5.12);                       // track bar
  box(g, 0.22, 0.3, 0.18, mat(0x55606a), -1.0, 4.32, 5.2);            // roller L
  box(g, 0.22, 0.3, 0.18, mat(0x55606a), 1.0, 4.32, 5.2);             // roller R
  box(g, 3.4, 3.7, 0.14, mat(COLORS.woodDark, false, 'door'), 0, 2.4, 5.12);
  box(g, 3.4, 0.18, 0.06, trim, 0, 4.16, 5.21);                       // top board
  box(g, 3.4, 0.18, 0.06, trim, 0, 0.64, 5.21);                       // bottom board
  for (const d of [-1, 1]) {                                           // the big X
    const brace = box(g, 0.2, 4.6, 0.06, trim, 0, 2.4, 5.2);
    brace.rotation.z = d * 0.74;
  }
  box(g, 0.12, 0.5, 0.1, mat(0x55606a), -1.45, 2.3, 5.22);            // handle
  box(g, 0.12, 0.5, 0.1, mat(0x55606a), 1.45, 2.3, 5.22);             // handle

  // Hayloft door + hoist beam, hanging rope and pulley.
  box(g, 1.9, 1.9, 0.15, trim, 0, 6.35, 5.02);
  box(g, 1.45, 1.45, 0.16, mat(0x4a3327, false, 'door'), 0, 6.35, 5.06);
  box(g, 1.1, 0.32, 0.36, mat(COLORS.straw), 0, 5.65, 5.22);          // spilled hay
  box(g, 0.22, 0.22, 1.5, mat(COLORS.woodDark), 0, 7.75, 5.4);        // hoist beam
  box(g, 0.05, 0.95, 0.05, dark, 0, 7.2, 6.05);                       // rope
  box(g, 0.18, 0.16, 0.18, mat(0x55606a), 0, 6.66, 6.05);             // pulley block
  box(g, 0.08, 0.12, 0.08, mat(0x37474f), 0, 6.54, 6.05);             // hook

  // Two small framed windows flanking the sliding door.
  for (const s of [-1, 1]) {
    box(g, 1.0, 1.0, 0.14, trim, s * 3.9, 2.9, 5.02);
    box(g, 0.74, 0.74, 0.15, mat(0x2c3550), s * 3.9, 2.9, 5.06);
    box(g, 1.15, 0.12, 0.22, trim, s * 3.9, 2.34, 5.06);              // sill
  }

  // Weather vane: post, N–S arrow, rooster silhouette.
  box(g, 0.07, 0.85, 0.07, dark, 0, 9.6, 0);
  box(g, 0.9, 0.05, 0.05, dark, 0, 9.85, 0);                          // arrow shaft
  box(g, 0.14, 0.12, 0.05, dark, 0.48, 9.85, 0);                      // arrow head
  box(g, 0.1, 0.16, 0.05, dark, -0.44, 9.85, 0);                      // arrow tail fin
  box(g, 0.05, 0.24, 0.2, dark, 0, 10.08, 0);                         // rooster body
  box(g, 0.05, 0.12, 0.09, dark, 0, 10.16, 0.13);                     // rooster head
  box(g, 0.05, 0.1, 0.05, mat(0xe53935), 0, 10.26, 0.13);             // comb

  return g;
}

/* ------------------------------------------------------------------ *
 *  createFarmhouse — ~10 x 8 x 8. Front (porch) faces +Z, ridge along X.
 *  Plank walls, shingle roof, brick chimney with cap, paneled front door
 *  with window + knob, 4 mullioned windows with sills + shutters + warm
 *  emissive panes, porch with steps / 4 turned posts / railing with
 *  balusters / bench, and a hanging lantern.
 * ------------------------------------------------------------------ */

export function createFarmhouse() {
  const g = new THREE.Group();
  const wall = mat(COLORS.barnTrim, false, 'planks');
  const white = mat(0xffffff);
  const roof = mat(COLORS.roof, false, 'shingles');
  const wood = mat(COLORS.wood, false, 'planks');
  const woodD = mat(COLORS.woodDark);
  const shutterM = mat(0x3f6e58);
  const glow = emat(0xffd98c, 0xff9d3c, 0.9);

  // Main walls + stepped gable fill (stays under the roof planes).
  box(g, 10, 4.6, 7, wall, 0, 2.3, 0);
  box(g, 10, 1.05, 3.6, wall, 0, 5.1, 0);
  box(g, 10, 0.8, 1.2, wall, 0, 5.9, 0);

  // Gable roof + ridge cap.
  for (const s of [-1, 1]) {
    const slab = box(g, 11, 0.2, 4.4, roof, 0, 5.6, s * 1.8);
    slab.rotation.x = s * 0.52;
  }
  box(g, 11.2, 0.28, 0.6, mat(0x553b32), 0, 6.75, 0);

  // Brick chimney on the rear slope, with cap + flue.
  box(g, 0.9, 2.9, 0.9, mat(0xb46a55, false, 'brick'), 3.0, 6.5, -1.2);
  box(g, 1.15, 0.25, 1.15, mat(0x8a8a8a), 3.0, 8.0, -1.2);
  box(g, 0.5, 0.18, 0.5, mat(0x2b2b2b), 3.0, 8.16, -1.2);

  // Windows: white frame, warm pane, cross mullions, sill, working shutters.
  const windowAt = (x, y, z, ry = 0) => {
    const w = pivot(g, x, y, z);
    w.rotation.y = ry;
    box(w, 1.3, 1.5, 0.12, white, 0, 0, 0);
    const pane = box(w, 1.0, 1.2, 0.12, glow, 0, 0, 0.04);
    pane.castShadow = false;
    box(w, 0.09, 1.2, 0.1, white, 0, 0, 0.08);
    box(w, 1.0, 0.09, 0.1, white, 0, 0, 0.08);
    box(w, 1.5, 0.12, 0.2, white, 0, -0.81, 0.04);                    // sill
    for (const s of [-1, 1]) {                                         // shutters
      const sh = box(w, 0.34, 1.42, 0.08, shutterM, s * 0.86, 0, 0.03);
      sh.rotation.y = s * 0.18;
    }
  };
  windowAt(-3.0, 2.0, 3.52);
  windowAt(3.0, 2.0, 3.52);
  windowAt(-2.2, 3.78, 3.52);
  windowAt(2.2, 3.78, 3.52);

  // Paneled front door with a little lit window + brass knob.
  box(g, 1.4, 2.4, 0.1, white, 0, 1.6, 3.52);
  box(g, 1.1, 2.2, 0.12, mat(0x6e4435, false, 'door'), 0, 1.55, 3.56);
  const doorWin = box(g, 0.5, 0.36, 0.05, glow, 0, 2.25, 3.63);
  doorWin.castShadow = false;
  box(g, 0.09, 0.09, 0.07, emat(COLORS.gold, 0xc79a1e, 0.3), 0.38, 1.5, 3.63);

  // Hanging porch lantern: bracket chain + glowing body + cap.
  box(g, 0.04, 0.3, 0.04, mat(0x3b3b42), 1.0, 2.6, 3.7);
  const lantern = box(g, 0.18, 0.26, 0.14, emat(0xffd98c, 0xffa040, 1.0), 1.0, 2.32, 3.7);
  lantern.castShadow = false;
  box(g, 0.24, 0.05, 0.2, mat(0x3b3b42), 1.0, 2.48, 3.7);

  // Porch: floor, two steps, 4 turned posts, sloped roof.
  box(g, 7.2, 0.3, 2.6, wood, 0, 0.3, 4.7);
  box(g, 2.0, 0.18, 0.55, wood, 0, 0.26, 6.2);
  box(g, 2.0, 0.18, 0.55, wood, 0, 0.09, 6.7);
  for (const x of [-3.3, -1.15, 1.15, 3.3]) {                          // turned posts
    box(g, 0.26, 0.18, 0.26, white, x, 0.54, 5.7);                     // base block
    box(g, 0.15, 1.9, 0.15, white, x, 1.55, 5.7);                      // shaft
    box(g, 0.24, 0.14, 0.24, white, x, 2.55, 5.7);                     // capital
  }
  const proof = box(g, 7.8, 0.16, 3.0, roof, 0, 2.78, 4.7);
  proof.rotation.x = 0.1;

  // Railing with balusters (gap at the door).
  for (const s of [-1, 1]) {
    box(g, 2.7, 0.1, 0.1, white, s * 2.1, 1.05, 5.72);
    for (const x of [-3.0, -2.2, -1.4, 1.4, 2.2, 3.0]) {
      if (Math.sign(x) === s) box(g, 0.07, 0.5, 0.07, white, x, 0.75, 5.72);
    }
    box(g, 0.1, 0.1, 2.2, white, s * 3.45, 1.05, 4.75);                // side rails
  }

  // A little porch bench by the window.
  box(g, 1.5, 0.1, 0.45, woodD, -2.3, 0.85, 4.35);
  box(g, 1.5, 0.5, 0.1, woodD, -2.3, 1.2, 4.14);
  box(g, 0.1, 0.42, 0.4, woodD, -2.95, 0.62, 4.35);
  box(g, 0.1, 0.42, 0.4, woodD, -1.65, 0.62, 4.35);

  return g;
}

/* ------------------------------------------------------------------ *
 *  createSilo — r ~2.5, h ~12, corrugated body, dome cap, ladder.
 * ------------------------------------------------------------------ */

export function createSilo() {
  const g = new THREE.Group();
  const body = mat(0xb9c4cf, false, 'metal');
  const band = mat(0x93a0ad, true);

  add(g, cylGeo(2.5, 2.5, 10, 12), body, 0, 5, 0);
  for (const y of [2.5, 5, 7.5]) {
    add(g, cylGeo(2.56, 2.56, 0.18, 12), band, 0, y, 0);
  }
  const cap = add(g, domeGeo(2.5, 12, 5), mat(COLORS.ufoBody, true), 0, 10, 0);
  cap.scale.set(1, 0.72, 1);
  // Top vent with a little cone hat.
  add(g, cylGeo(0.3, 0.3, 0.5, 6), band, 0, 11.9, 0);
  add(g, coneGeo(0.45, 0.4, 6), mat(0x78909c, true), 0, 12.3, 0);
  // Ladder up the front with a safety hoop near the top.
  for (const s of [-1, 1]) {
    box(g, 0.07, 9.2, 0.07, mat(0x6f7d92), s * 0.32, 4.7, 2.48);
  }
  for (let i = 0; i < 8; i++) {
    box(g, 0.7, 0.06, 0.06, mat(0x6f7d92), 0, 1.1 + i * 1.1, 2.48);
  }
  const hoop = add(g, torusGeo(0.5, 0.04, 5, 10), mat(0x6f7d92, true), 0, 8.6, 2.5);
  hoop.rotation.x = Math.PI / 2;
  // Hatch door + filler chute at the base.
  box(g, 0.9, 1.3, 0.15, mat(0x55606a), 0, 0.7, 2.42);
  box(g, 0.5, 0.1, 0.5, mat(0x55606a), 0, 1.42, 2.4);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createWindmill — ~11 tall lattice tower. userData: { blades }
 *  4 splayed legs with 3 levels of cross-braces, platform, gear head,
 *  tail vane, 6 framed cloth sails, ladder up one leg.
 *  blades Group sits at the hub; spin with blades.rotation.z.
 * ------------------------------------------------------------------ */

export function createWindmill() {
  const g = new THREE.Group();
  const steel = mat(0x8e9aa6);
  const light = mat(0xd7dee6);

  // Four splayed legs.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = box(g, 0.2, 9.4, 0.2, steel, sx * 0.88, 4.5, sz * 0.88);
    leg.rotation.z = -sx * 0.116;
    leg.rotation.x = sz * 0.116;
  }
  // Lattice girdles at THREE heights (cross-braces).
  for (const [y, hw] of [[1.6, 1.22], [4.2, 0.92], [6.8, 0.62]]) {
    box(g, hw * 2 + 0.2, 0.09, 0.09, steel, 0, y, hw);
    box(g, hw * 2 + 0.2, 0.09, 0.09, steel, 0, y, -hw);
    box(g, 0.09, 0.09, hw * 2 + 0.2, steel, hw, y, 0);
    box(g, 0.09, 0.09, hw * 2 + 0.2, steel, -hw, y, 0);
  }
  // Diagonal X braces on the front face between girdle 1 and 2.
  for (const d of [-1, 1]) {
    const brace = box(g, 0.07, 2.9, 0.07, steel, 0, 2.9, 1.06);
    brace.rotation.z = d * 0.62;
  }
  // Ladder up the +Z/-X leg.
  box(g, 0.05, 7.6, 0.05, light, -0.62, 3.8, 1.18);
  box(g, 0.05, 7.6, 0.05, light, -0.3, 3.8, 1.18);
  for (let i = 0; i < 6; i++) {
    box(g, 0.38, 0.05, 0.05, light, -0.46, 0.9 + i * 1.25, 1.18);
  }
  // Platform + gear head + roof plate.
  box(g, 1.7, 0.16, 1.7, mat(COLORS.wood, false, 'planks'), 0, 9.05, 0);
  box(g, 0.8, 0.8, 1.05, steel, 0, 9.65, 0);
  box(g, 0.9, 0.14, 1.15, light, 0, 10.1, 0);
  // Tail boom + red vane.
  box(g, 0.08, 0.08, 1.4, steel, 0, 9.7, -1.1);
  box(g, 0.06, 0.75, 0.9, mat(0xe05348), 0, 9.85, -1.75);

  // Blade wheel at the hub (front): 6 sails, each a spar + frame + cloth.
  const blades = pivot(g, 0, 9.7, 0.68);
  add(blades, cylZGeo(0.2, 0.3, 8), mat(0x55606a, true), 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const sail = pivot(blades, 0, 0, 0);
    sail.rotation.z = (i / 6) * PI2;
    box(sail, 0.09, 2.1, 0.06, steel, 0, 1.05, 0);                    // spar
    box(sail, 0.5, 0.07, 0.06, steel, 0, 0.85, 0.04);                 // frame bottom
    box(sail, 0.5, 0.07, 0.06, steel, 0, 2.1, 0.04);                  // frame top
    const cloth = box(sail, 0.44, 1.3, 0.04, light, 0.05, 1.48, 0.07);
    cloth.rotation.y = 0.3;                                            // pitched cloth
  }

  g.userData = { blades };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createWell — individual stone-block ring (two offset courses),
 *  wooden A-frame with shingled mini-roof, crank handle + axle, rope
 *  wound around the axle, hanging bucket over the water.
 * ------------------------------------------------------------------ */

export function createWell() {
  const g = new THREE.Group();
  const rope = mat(0x6d5a45);

  // Core ring + water surface.
  add(g, cylGeo(0.82, 0.9, 0.8, 8), mat(0x8c8c8c, true), 0, 0.4, 0);
  const water = add(g, cylGeo(0.7, 0.7, 0.06, 8), mat(COLORS.waterDeep, true), 0, 0.74, 0);
  water.castShadow = false;
  // Two offset courses of individual stone blocks around the core.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2;
    const s = box(g, 0.42, 0.34, 0.26, i % 2 ? mat(COLORS.stone) : mat(0xb4b4b4),
      Math.cos(a) * 0.86, 0.2, Math.sin(a) * 0.86);
    s.rotation.y = -a + Math.PI / 2;
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2 + Math.PI / 8;                             // offset course
    const s = box(g, 0.4, 0.32, 0.24, i % 2 ? mat(0xb4b4b4) : mat(COLORS.stone),
      Math.cos(a) * 0.88, 0.54, Math.sin(a) * 0.88);
    s.rotation.y = -a + Math.PI / 2;
  }

  // Wooden A-frame: posts + diagonal braces.
  for (const s of [-1, 1]) {
    box(g, 0.15, 1.6, 0.15, mat(COLORS.woodDark), s * 0.85, 1.35, 0);
    const brace = box(g, 0.1, 0.7, 0.1, mat(COLORS.wood), s * 0.72, 0.9, 0.3);
    brace.rotation.x = -0.5;
  }
  // Shingled mini-roof + ridge.
  for (const s of [-1, 1]) {
    const slab = box(g, 2.3, 0.1, 1.05, mat(COLORS.roof, false, 'shingles'), 0, 2.32, s * 0.4);
    slab.rotation.x = s * 0.55;
  }
  box(g, 2.4, 0.14, 0.22, mat(0x553b32), 0, 2.58, 0);

  // Crank: axle, wound rope coils, crank arm + handle.
  add(g, cylXGeo(0.07, 1.9, 6), mat(COLORS.woodDark), 0, 1.62, 0);
  add(g, cylXGeo(0.11, 0.34, 6), rope, -0.05, 1.62, 0);                // rope coil
  add(g, cylXGeo(0.1, 0.18, 6), rope, 0.22, 1.62, 0);                  // loose coil
  box(g, 0.07, 0.3, 0.07, mat(COLORS.woodDark), 0.99, 1.5, 0);         // crank arm
  box(g, 0.07, 0.07, 0.3, mat(0x4e342e), 0.99, 1.36, 0.12);            // crank handle
  // Hanging rope + bucket with a steel rim.
  box(g, 0.05, 0.5, 0.05, rope, 0, 1.32, 0);
  box(g, 0.28, 0.24, 0.28, mat(COLORS.wood), 0, 0.97, 0);
  box(g, 0.32, 0.06, 0.32, mat(0x55606a), 0, 1.1, 0);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createScarecrow — cross-pole arms with cuffs, patch-textured shirt,
 *  button eyes, straw tufts at cuffs/neck/base, resident crow.
 * ------------------------------------------------------------------ */

export function createScarecrow() {
  const g = new THREE.Group();
  const shirt = mat(0x7e57c2, false, 'patch');
  const stripe = mat(0x9575cd);
  const straw = mat(COLORS.straw);

  // Post + cross-pole.
  box(g, 0.14, 1.6, 0.14, mat(COLORS.woodDark), 0, 0.8, 0);
  box(g, 1.7, 0.1, 0.1, mat(COLORS.woodDark), 0, 1.66, -0.05);
  // Torso with stripes and a sewn denim patch.
  box(g, 0.56, 0.62, 0.32, shirt, 0, 1.5, 0);
  box(g, 0.58, 0.08, 0.34, stripe, 0, 1.62, 0);
  box(g, 0.58, 0.08, 0.34, stripe, 0, 1.4, 0);
  box(g, 0.18, 0.18, 0.04, mat(COLORS.denim), 0.12, 1.45, 0.17);
  // Sleeves with cuffs and straw poking out.
  for (const s of [-1, 1]) {
    box(g, 0.55, 0.18, 0.18, shirt, s * 0.55, 1.66, 0);
    box(g, 0.1, 0.21, 0.21, stripe, s * 0.8, 1.66, 0);                // sleeve cuff
    const tuft = box(g, 0.13, 0.26, 0.13, straw, s * 0.92, 1.66, 0);
    tuft.rotation.z = s * 1.35;
  }
  // Straw at the neck + skirt of straw at the base of the torso.
  box(g, 0.3, 0.1, 0.24, straw, 0, 1.82, 0);
  for (const [dx, rz] of [[-0.14, 0.25], [0.02, -0.1], [0.16, -0.3]]) {
    const wisp = box(g, 0.1, 0.34, 0.1, straw, dx, 1.1, 0.03);
    wisp.rotation.z = rz;
  }
  // Burlap head with button eyes + stitched mouth.
  box(g, 0.4, 0.4, 0.36, mat(COLORS.sand), 0, 2.02, 0);
  box(g, 0.08, 0.08, 0.04, mat(0x3a2a22), -0.1, 2.08, 0.185);
  box(g, 0.08, 0.08, 0.04, mat(0x2b2b2b), 0.1, 2.08, 0.185);          // odd buttons
  box(g, 0.16, 0.04, 0.04, mat(0x3a2a22), 0, 1.92, 0.185);
  // Straw hat.
  box(g, 0.62, 0.06, 0.58, straw, 0, 2.24, 0);
  box(g, 0.34, 0.2, 0.32, straw, 0, 2.36, 0);
  // A cheeky crow perched on the arm.
  box(g, 0.14, 0.13, 0.2, mat(0x1c1c22), 0.62, 1.82, -0.05);
  box(g, 0.1, 0.1, 0.09, mat(0x1c1c22), 0.62, 1.93, 0.05);
  box(g, 0.04, 0.04, 0.07, mat(0xffa726), 0.62, 1.92, 0.12);
  const crowTail = box(g, 0.05, 0.04, 0.12, mat(0x1c1c22), 0.62, 1.86, -0.18);
  crowTail.rotation.x = -0.4;
  return g;
}

/* ------------------------------------------------------------------ *
 *  createTractor — ~3.5 long, faces +Z. userData: { wheels: Mesh[] }
 *  Engine hood + exhaust/muffler + stack cap, radiator grille, fenders,
 *  treaded rear wheels (lug boxes spin with the tire), seat, steering
 *  wheel on a column, emissive headlights.
 *  Wheel geometry axis is X — spin with wheel.rotation.x.
 * ------------------------------------------------------------------ */

export function createTractor() {
  const g = new THREE.Group();
  const green = mat(0x2f9e44);
  const greenD = mat(0x257a35);
  const dark = mat(0x263238);

  // Chassis + engine hood + radiator grille + headlights.
  box(g, 1.1, 0.5, 2.6, green, 0, 0.95, 0);
  box(g, 0.9, 0.55, 1.3, green, 0, 1.32, 0.6);
  box(g, 0.94, 0.1, 1.34, greenD, 0, 1.62, 0.6);                      // hood ridge
  box(g, 0.8, 0.42, 0.12, mat(0x55606a, false, 'metal'), 0, 1.28, 1.28);
  for (const s of [-1, 1]) {
    const hl = add(g, cylZGeo(0.09, 0.08, 8), emat(0xffe3a1, 0xffb547, 0.8, true), s * 0.25, 1.42, 1.33);
    hl.castShadow = false;
  }
  // Exhaust stack: pipe + muffler + rain cap.
  add(g, cylGeo(0.06, 0.06, 0.8, 6), dark, 0.28, 1.95, 0.5);
  add(g, cylGeo(0.1, 0.1, 0.22, 6), dark, 0.28, 2.3, 0.5);
  const capPiv = box(g, 0.14, 0.04, 0.12, mat(0x55606a), 0.28, 2.44, 0.53);
  capPiv.rotation.x = 0.5;                                             // flapper cap
  // Seat + backrest + steering wheel on a column.
  box(g, 0.5, 0.12, 0.5, dark, 0, 1.28, -0.72);
  box(g, 0.5, 0.5, 0.12, dark, 0, 1.56, -0.98);
  const column = box(g, 0.07, 0.4, 0.07, dark, 0, 1.42, -0.18);
  column.rotation.x = 0.5;
  const wheelRim = add(g, torusGeo(0.17, 0.035, 5, 10), mat(0x263238, true), 0, 1.62, -0.28);
  wheelRim.rotation.x = 0.5 + Math.PI / 2;
  // Rear fenders arched over the big wheels.
  for (const s of [-1, 1]) {
    box(g, 0.3, 0.12, 1.15, green, s * 0.78, 1.52, -0.62);
    box(g, 0.3, 0.4, 0.12, greenD, s * 0.78, 1.32, -0.04);            // fender lip
  }
  // Wheels: big treaded rear (lug boxes around the tire), small front.
  const wheels = [];
  const wheelAt = (x, y, z, r, w, lugs) => {
    const m = add(g, cylXGeo(r, w, 10), mat(0x263238, true), x, y, z);
    const hub = new THREE.Mesh(cylXGeo(r * 0.42, w + 0.04, 8), emat(COLORS.gold, 0xc79a1e, 0.15, true));
    applyShadows(hub);
    m.add(hub);
    for (let i = 0; i < lugs; i++) {                                   // tread lugs
      const a = (i / lugs) * PI2;
      const lug = new THREE.Mesh(UNIT_BOX, mat(0x1b2227));
      lug.scale.set(w + 0.02, 0.1, 0.16);
      lug.position.set(0, Math.cos(a) * r, Math.sin(a) * r);
      lug.rotation.x = -a;
      applyShadows(lug);
      m.add(lug);
    }
    wheels.push(m);
    return m;
  };
  wheelAt(-0.78, 0.74, -0.62, 0.74, 0.4, 6);
  wheelAt(0.78, 0.74, -0.62, 0.74, 0.4, 6);
  wheelAt(-0.62, 0.42, 0.95, 0.42, 0.28, 0);
  wheelAt(0.62, 0.42, 0.95, 0.42, 0.28, 0);

  g.userData = { wheels };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createHayBale — round bale lying on its side (axis along X), with
 *  spiral end swirls, twine bands and straw stubble at the ends.
 * ------------------------------------------------------------------ */

export function createHayBale() {
  const g = new THREE.Group();
  add(g, cylXGeo(0.7, 1.0, 10), mat(COLORS.straw, true), 0, 0.7, 0);
  add(g, cylXGeo(0.5, 1.06, 10), mat(0xc9a64e, true), 0, 0.7, 0);     // end swirl ring
  add(g, cylXGeo(0.2, 1.1, 8), mat(0xa8853c, true), 0, 0.7, 0);       // swirl core
  for (const x of [-0.26, 0.26]) {                                     // twine bands
    add(g, cylXGeo(0.715, 0.08, 10), mat(0xb38f3e, true), x, 0.7, 0);
  }
  // Straw stubble poking from each end.
  for (const s of [-1, 1]) {
    box(g, 0.1, 0.07, 0.07, mat(0xe0bb55), s * 0.58, 1.05, 0.3).rotation.z = s * 0.4;
    box(g, 0.1, 0.06, 0.06, mat(0xc9a64e), s * 0.58, 0.55, -0.42).rotation.z = -s * 0.3;
    box(g, 0.09, 0.06, 0.06, mat(0xe0bb55), s * 0.57, 0.9, -0.35).rotation.z = s * 0.6;
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createFenceSection — posts every ~2 + two rails, height ~1.1.
 *  Runs along +X from the origin (x in [0, length]).
 *  Posts get beveled caps; the top rail sags a touch; knot dots.
 * ------------------------------------------------------------------ */

export function createFenceSection(length = 8) {
  const g = new THREE.Group();
  const postM = mat(COLORS.woodDark);
  const railM = mat(COLORS.wood);
  const xs = [];
  for (let x = 0; x < length - 0.01; x += 2) xs.push(x);
  xs.push(length);
  for (const x of xs) {
    box(g, 0.18, 1.1, 0.18, postM, x, 0.55, 0);
    box(g, 0.24, 0.09, 0.24, postM, x, 1.14, 0);                      // beveled cap
  }
  // Top rail sits true; middle rail sags a touch (lower + rotated).
  box(g, length, 0.13, 0.08, railM, length / 2, 0.92, 0.1);
  const mid = box(g, length, 0.12, 0.08, railM, length / 2, 0.48, 0.1);
  mid.rotation.z = 0.018;
  mid.rotation.y = 0.012;
  // A couple of knot dots on the rails.
  box(g, 0.05, 0.07, 0.04, postM, length * 0.3, 0.93, 0.15);
  box(g, 0.05, 0.06, 0.04, postM, length * 0.72, 0.49, 0.15);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBridge — arched plank deck (plank-by-plank with tiny jitter),
 *  side rails with posts, visible support beams + cross beams under.
 *  Runs along +X, centered on the origin (x in [-length/2, length/2]).
 * ------------------------------------------------------------------ */

export function createBridge(length = 14, width = 4) {
  const g = new THREE.Group();
  const arch = Math.min(0.6, Math.max(0.15, length * 0.045));
  const deckY = (x) => 0.22 + arch * (1 - Math.pow((2 * x) / length, 2));
  const slopeAt = (x) => Math.atan((-8 * arch * x) / (length * length));
  const jr = makeRng(91);                                              // deterministic jitter

  // Deck planks (two alternating wood tones), following the arch.
  const n = Math.max(6, Math.round(length / 0.6));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (i + 0.5) * step;
    const plank = box(g, step * 0.94, 0.14, width, i % 2 ? mat(0x99756a) : mat(COLORS.wood),
      x, deckY(x) + (jr() - 0.5) * 0.025, 0);
    plank.rotation.z = slopeAt(x);
    plank.rotation.y = (jr() - 0.5) * 0.03;                            // hand-laid look
  }
  // Long support beams, cross beams and corner footing posts underneath.
  for (const s of [-1, 1]) {
    box(g, length * 0.94, 0.18, 0.24, mat(COLORS.woodDark), 0, 0.12, s * (width / 2 - 0.3));
    for (const e of [-1, 1]) {
      box(g, 0.22, 0.5, 0.22, mat(COLORS.woodDark), e * (length / 2 - 0.25), 0.25, s * (width / 2 - 0.25));
    }
  }
  for (const fx of [-0.28, 0, 0.28]) {                                 // cross beams
    box(g, 0.26, 0.16, width - 0.4, mat(COLORS.woodDark), fx * length, 0.14, 0);
  }
  // Side railings: posts + rail segments that follow the arch.
  const nSeg = Math.max(2, Math.round(length / 1.8));
  const segW = length / nSeg;
  for (const s of [-1, 1]) {
    const rz = s * (width / 2 - 0.1);
    for (let i = 0; i <= nSeg; i++) {
      const x = -length / 2 + i * segW;
      box(g, 0.13, 0.85, 0.13, mat(COLORS.woodDark), x, deckY(x) + 0.42, rz);
    }
    for (let i = 0; i < nSeg; i++) {
      const xm = -length / 2 + (i + 0.5) * segW;
      const rail = box(g, segW, 0.11, 0.11, mat(COLORS.wood), xm, deckY(xm) + 0.84, rz);
      rail.rotation.z = slopeAt(xm);
    }
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCoop — ~3 x 2.5 x 2.5 chicken coop. Front faces +Z.
 *  Plank walls, shingle roof, ramp with cleats, ROUND pophole door,
 *  tiny vent window, nesting-box bump on the side.
 * ------------------------------------------------------------------ */

export function createCoop() {
  const g = new THREE.Group();
  const red = mat(COLORS.barnRed, false, 'planks');
  const trim = mat(COLORS.barnTrim);

  // Stilts + body.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    box(g, 0.16, 0.42, 0.16, mat(COLORS.woodDark), sx * 1.3, 0.21, sz * 0.9);
  }
  box(g, 3, 1.5, 2.2, red, 0, 1.15, 0);
  // Slanted shingle roof with a ridge board and a little roof vent.
  const roof = box(g, 3.5, 0.14, 2.8, mat(COLORS.roof, false, 'shingles'), 0, 2.1, -0.1);
  roof.rotation.x = 0.16;
  box(g, 3.5, 0.1, 0.18, mat(0x553b32), 0, 2.36, -1.42);
  box(g, 0.45, 0.3, 0.45, red, 0.9, 2.42, -0.5);
  box(g, 0.6, 0.1, 0.6, mat(COLORS.woodDark), 0.9, 2.6, -0.5);
  // Corner trim boards.
  for (const s of [-1, 1]) {
    box(g, 0.14, 1.5, 0.14, trim, s * 1.46, 1.15, 1.05);
  }
  // ROUND pophole door: white ring + dark hole.
  const ringFrame = add(g, cylZGeo(0.42, 0.1, 10), trim, -0.6, 1.0, 1.1);
  ringFrame.castShadow = false;
  add(g, cylZGeo(0.32, 0.12, 10), mat(0x3a2a22), -0.6, 1.0, 1.12);
  // Tiny ventilation window (slatted) high on the front.
  box(g, 0.5, 0.4, 0.1, trim, 0.75, 1.55, 1.1);
  box(g, 0.36, 0.07, 0.12, mat(0x3a2a22), 0.75, 1.64, 1.12);
  box(g, 0.36, 0.07, 0.12, mat(0x3a2a22), 0.75, 1.52, 1.12);
  box(g, 0.36, 0.07, 0.12, mat(0x3a2a22), 0.75, 1.4, 1.12);
  // Ramp with cleats (its own group so the cleats tilt with the board).
  const ramp = pivot(g, -0.6, 0.55, 1.12);
  ramp.rotation.x = 0.42;
  box(ramp, 0.55, 0.07, 1.5, mat(COLORS.wood), 0, 0, 0.7);
  for (const z of [0.35, 0.75, 1.15]) {
    box(ramp, 0.55, 0.06, 0.09, mat(COLORS.woodDark), 0, 0.05, z);
  }
  // Side nesting-box bump with a slanted lid.
  box(g, 0.6, 0.65, 0.9, red, 1.65, 1.1, -0.3);
  const lid = box(g, 0.75, 0.08, 1.0, trim, 1.68, 1.48, -0.3);
  lid.rotation.z = -0.18;
  return g;
}

/* ------------------------------------------------------------------ *
 *  createPumpkin — ~0.5 tall. Six ribbed lobes, curly stem, one leaf.
 * ------------------------------------------------------------------ */

export function createPumpkin() {
  const g = new THREE.Group();
  // Six lobes arranged around the core (alternating orange tones).
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI2;
    const lobe = add(g, sphGeo(0.22, 7, 5), i % 2 ? mat(0xd9731f, true) : mat(0xf28a1f, true),
      Math.cos(a) * 0.12, 0.24, Math.sin(a) * 0.12);
    lobe.scale.set(0.78, 1.0, 0.78);
    lobe.rotation.y = -a;
  }
  // Curly stem (two kinked segments) + one leaf.
  const stem = box(g, 0.07, 0.18, 0.07, mat(0x6d8f3a), 0.02, 0.5, 0);
  stem.rotation.z = 0.25;
  const curl = box(g, 0.05, 0.12, 0.05, mat(0x55742c), 0.08, 0.58, 0.02);
  curl.rotation.z = 0.9;
  const leaf = box(g, 0.2, 0.03, 0.14, mat(0x55742c), -0.14, 0.5, 0.06);
  leaf.rotation.set(0.1, 0.4, 0.2);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCornStalk — ~1.8 tall (heavily instanced — 7 meshes).
 *  Leaning leaf blades, tassel top, one ear with silk.
 * ------------------------------------------------------------------ */

export function createCornStalk() {
  const g = new THREE.Group();
  const stalk = box(g, 0.1, 1.8, 0.1, mat(0x4f9e3d), 0, 0.9, 0);
  stalk.rotation.z = 0.04;
  const leafA = box(g, 0.7, 0.07, 0.16, mat(0x5db04a), 0.26, 0.95, 0);
  leafA.rotation.z = 0.5;
  const leafB = box(g, 0.62, 0.07, 0.16, mat(0x4f9e3d), -0.24, 1.25, 0.05);
  leafB.rotation.z = -0.55;
  const leafC = box(g, 0.5, 0.06, 0.14, mat(0x5db04a), 0.2, 1.5, -0.06);
  leafC.rotation.set(0.1, 0.3, 0.6);
  const tassel = box(g, 0.06, 0.3, 0.06, mat(0xd9c27e), 0.04, 1.92, 0);
  tassel.rotation.z = -0.08;
  const cob = box(g, 0.14, 0.34, 0.14, mat(0xe8c34a), 0.11, 1.05, 0.09);
  cob.rotation.z = 0.25;
  const silk = box(g, 0.06, 0.12, 0.06, mat(0xc98a3b), 0.16, 1.26, 0.1);
  silk.rotation.z = 0.5;
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCattail — pond reeds ~1.2: two reeds + grass blades.
 * ------------------------------------------------------------------ */

export function createCattail() {
  const g = new THREE.Group();
  // Tall reed.
  const stemA = box(g, 0.05, 1.1, 0.05, mat(0x5da244), 0, 0.55, 0);
  stemA.rotation.z = 0.05;
  add(g, cylGeo(0.09, 0.09, 0.42, 6), mat(0x7a4a21, true), 0.03, 0.96, 0);
  box(g, 0.03, 0.2, 0.03, mat(COLORS.straw), 0.04, 1.27, 0);
  // Shorter second reed, leaning the other way.
  const stemB = box(g, 0.04, 0.85, 0.04, mat(0x4f9e3d), -0.18, 0.42, 0.08);
  stemB.rotation.z = -0.12;
  add(g, cylGeo(0.07, 0.07, 0.32, 6), mat(0x8a5526, true), -0.23, 0.92, 0.08);
  // Grass blades around the base.
  const bladeA = box(g, 0.04, 0.95, 0.14, mat(0x4f9e3d), 0.12, 0.45, 0.03);
  bladeA.rotation.set(0.1, 0.4, 0.18);
  const bladeB = box(g, 0.04, 0.7, 0.12, mat(0x5da244), -0.1, 0.34, -0.1);
  bladeB.rotation.set(-0.12, -0.5, -0.22);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createSunflower — ~1.6 tall. Ring of 8 petal boxes around a dark
 *  seed disc, two leaves on the stem. Face tilted up toward +Z.
 * ------------------------------------------------------------------ */

export function createSunflower() {
  const g = new THREE.Group();
  box(g, 0.07, 1.3, 0.07, mat(0x4f9e3d), 0, 0.65, 0);
  for (const [s, y] of [[1, 0.55], [-1, 0.82]]) {
    const leaf = box(g, 0.34, 0.06, 0.18, mat(0x5db04a), s * 0.18, y, 0.02);
    leaf.rotation.z = s * 0.5;
  }
  const head = pivot(g, 0, 1.32, 0.06);
  head.rotation.x = 1.15; // face up-forward
  // Petal ring: 8 golden petal boxes around the disc.
  const petalM = emat(COLORS.gold, 0xc79a1e, 0.15);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2;
    const p = box(head, 0.16, 0.02, 0.22, petalM, Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.34);
    p.rotation.y = -a + Math.PI / 2;
    p.castShadow = false;
  }
  // Dark seed-disc face (two stacked discs for depth).
  add(head, cylGeo(0.26, 0.26, 0.07, 8), mat(0x6d4c41, true), 0, 0.02, 0);
  add(head, cylGeo(0.14, 0.14, 0.1, 8), mat(0x4a3327, true), 0, 0.04, 0);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createLanternPost — ~3 tall, curved bracket arm, 4-bar glass cage,
 *  emissive flame core, drip cap.
 * ------------------------------------------------------------------ */

export function createLanternPost() {
  const g = new THREE.Group();
  const dark = mat(0x3b3b42);
  box(g, 0.44, 0.22, 0.44, mat(COLORS.stone, false, 'stone'), 0, 0.11, 0);
  box(g, 0.16, 2.7, 0.16, mat(COLORS.woodDark), 0, 1.45, 0);
  // Curved bracket arm: three segments easing over, plus a scroll brace.
  box(g, 0.3, 0.09, 0.09, mat(COLORS.woodDark), 0.13, 2.74, 0);
  const seg2 = box(g, 0.26, 0.08, 0.08, mat(COLORS.woodDark), 0.36, 2.7, 0);
  seg2.rotation.z = -0.3;
  const seg3 = box(g, 0.2, 0.07, 0.07, mat(COLORS.woodDark), 0.5, 2.61, 0);
  seg3.rotation.z = -0.7;
  const brace = box(g, 0.4, 0.08, 0.08, mat(COLORS.woodDark), 0.16, 2.55, 0);
  brace.rotation.z = 0.7;
  box(g, 0.05, 0.14, 0.05, dark, 0.52, 2.48, 0);                      // hook link
  // Hanging lantern cage with glowing core.
  const lan = pivot(g, 0.52, 2.16, 0);
  box(lan, 0.32, 0.07, 0.32, dark, 0, 0.22, 0);
  box(lan, 0.28, 0.07, 0.28, dark, 0, -0.22, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    box(lan, 0.045, 0.42, 0.045, dark, sx * 0.12, 0, sz * 0.12);
  }
  const glowCore = box(lan, 0.17, 0.28, 0.17, emat(0xffe2a8, 0xffb74d, 1.0), 0, 0, 0);
  glowCore.castShadow = false;
  add(lan, coneGeo(0.26, 0.2, 4), dark, 0, 0.34, 0);                  // drip cap
  box(lan, 0.05, 0.07, 0.05, dark, 0, 0.47, 0);                       // cap finial
  return g;
}

/* ------------------------------------------------------------------ *
 *  createMailbox — ~1.5 tall. Rounded box on a post, door with latch,
 *  little red flag UP, house-number dot.
 * ------------------------------------------------------------------ */

export function createMailbox() {
  const g = new THREE.Group();
  box(g, 0.11, 1.0, 0.11, mat(COLORS.wood), 0, 0.5, 0);
  box(g, 0.3, 0.06, 0.2, mat(COLORS.wood), 0, 0.98, 0);
  const kneeBrace = box(g, 0.2, 0.05, 0.05, mat(COLORS.woodDark), 0.1, 0.88, 0);
  kneeBrace.rotation.z = 0.6;
  // Box body with rounded top (half-buried cylinder).
  box(g, 0.36, 0.24, 0.6, mat(0x4a7fd6), 0, 1.13, 0);
  add(g, cylZGeo(0.18, 0.6, 8), mat(0x4a7fd6, true), 0, 1.25, 0);
  box(g, 0.3, 0.2, 0.05, mat(0x32599e), 0, 1.12, 0.31);               // door
  box(g, 0.08, 0.04, 0.04, mat(0xd9d9d9), 0, 1.05, 0.34);             // latch
  box(g, 0.07, 0.07, 0.03, mat(0xf5f5f0), 0.12, 1.16, 0.315);         // number plate
  // Flag up!
  box(g, 0.03, 0.3, 0.04, mat(0xe53935), 0.2, 1.36, -0.12);
  box(g, 0.03, 0.1, 0.16, mat(0xe53935), 0.2, 1.48, -0.05);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCar — parked pickup truck, ~4 long, faces +Z.
 *  Cab with glass, flatbed with side rails, ROUND emissive headlights,
 *  bumpers, license plate, wheels with hubcaps.
 * ------------------------------------------------------------------ */

export function createCar() {
  const g = new THREE.Group();
  const paint = mat(0x3ba7dd);
  const paintD = mat(0x2e8cbb);
  const gray = mat(0x78909c);

  // Body slab + cab with poking-out window band (Crossy style).
  box(g, 1.8, 0.55, 4.0, paint, 0, 0.78, 0);
  box(g, 1.7, 0.75, 1.4, paint, 0, 1.4, 0.5);
  const glass = box(g, 1.74, 0.45, 1.1, emat(0x9fd8ff, 0x3a6a8a, 0.25), 0, 1.45, 0.55);
  glass.castShadow = false;
  box(g, 1.74, 0.08, 1.44, paintD, 0, 1.8, 0.5);                      // cab roof cap
  // Flatbed: side rails on posts + tailgate + a pile of hay.
  for (const s of [-1, 1]) {
    box(g, 0.12, 0.42, 1.7, paint, s * 0.84, 1.22, -1.1);
    box(g, 0.16, 0.08, 1.78, paintD, s * 0.84, 1.46, -1.1);           // rail top bar
  }
  box(g, 1.8, 0.42, 0.12, paint, 0, 1.22, -1.94);
  box(g, 1.3, 0.32, 1.2, mat(COLORS.straw), 0, 1.18, -1.1);
  // Grille, ROUND headlights, taillights, bumpers, plate, mirrors, exhaust.
  box(g, 1.5, 0.3, 0.1, mat(0x78909c, false, 'metal'), 0, 0.78, 2.02);
  for (const s of [-1, 1]) {
    const hl = add(g, cylZGeo(0.12, 0.08, 8), emat(0xffe3a1, 0xffb547, 0.7, true), s * 0.62, 0.97, 2.04);
    hl.castShadow = false;
    box(g, 0.18, 0.14, 0.07, emat(0xff6b5e, 0xc62828, 0.5), s * 0.7, 0.95, -2.02);
    box(g, 0.06, 0.06, 0.18, gray, s * 0.92, 1.45, 1.05);             // mirror arms
    box(g, 0.04, 0.14, 0.12, mat(0xd9d9d9), s * 0.99, 1.45, 1.05);    // mirrors
  }
  box(g, 1.95, 0.16, 0.16, gray, 0, 0.5, 2.0);
  box(g, 1.95, 0.16, 0.16, gray, 0, 0.5, -2.0);
  box(g, 0.3, 0.14, 0.04, mat(0xf5f5f0), 0, 0.72, -2.03);             // license plate
  box(g, 0.18, 0.06, 0.02, mat(0x32599e), 0, 0.72, -2.05);            // plate lettering
  add(g, cylXGeo(0.05, 0.25, 6), gray, 0.5, 0.35, -2.0);              // exhaust
  // Wheels with bright hubcaps.
  for (const [x, z] of [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.25], [0.85, -1.25]]) {
    add(g, cylXGeo(0.42, 0.3, 10), mat(0x263238, true), x, 0.42, z);
    add(g, cylXGeo(0.18, 0.34, 8), mat(0xcfd8dc, true), x, 0.42, z);
  }
  return g;
}
