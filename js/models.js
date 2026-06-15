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

// Prism extruded along X from a closed 2D cross-section in the Y-Z plane.
// `profile` is an array of [y, z] points (CCW), `len` is the X extrusion.
// Used for solid pitched gable / gambrel roof masses so the roofline reads
// as one continuous triangular/angled form with no rectangular block beneath.
function prismXGeo(profile, len) {
  const key = `pr${len}|${profile.map((p) => p.join(',')).join(';')}`;
  return _geo(key, () => {
    // Author the shape so it maps cleanly to world axes after the rotateY
    // below: shape (x=-z, y=y) extruded along z, then rotated so the
    // extrusion runs along X and the profile lands at its intended (y, z).
    const pts = profile.map((p) => [-p[1], p[0]]);   // [y,z] → shape (x,y)
    // ExtrudeGeometry wants a CCW outer contour for outward-facing normals;
    // reverse if the authored profile came out clockwise so end caps and
    // walls always face out regardless of point order.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) pts.reverse();
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);                    // center the extrusion on X
    g.rotateY(Math.PI / 2);                          // extrusion axis → world X
    return g;
  });
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
 *  createUFO(opts) — diameter ~4.5, height ~2.3. The hero model.
 *  opts = { shape, hull, dome, light } — cosmetic options for the shop.
 *    shape : 'saucer' (default) | 'orb' | 'delta' | 'ringed'
 *    hull  : 0xRRGGBB body/hull colour      (default classic two-tone)
 *    dome  : 0xRRGGBB glass dome colour      (default COLORS.ufoDome)
 *    light : 0xRRGGBB rim running-lights +   (default COLORS.ufoGlow)
 *            beam-adjacent emitter glow
 *  userData (IDENTICAL for ALL shapes — ufo.js depends on it):
 *    { dome, ring, lights: Mesh[8], beamAnchor }
 *      dome  — Mesh spun by ufo.js
 *      ring  — pivot Group spun by ufo.js
 *      lights — array of ~8 rim light meshes that blink individually
 *      beamAnchor — Object3D under the craft the beam hangs from
 *  Defaults reproduce the CURRENT classic saucer EXACTLY so existing
 *  zero-arg callers are unchanged. Bottom-center origin, faces +Z.
 * ------------------------------------------------------------------ */

export function createUFO(opts = {}) {
  const shape = opts.shape || 'saucer';
  // Hull palette: when a custom `hull` is given, derive a light cap / dark
  // belly / greeble tone from it so the recolour reads as one craft; the
  // defaults below are the exact classic hull colours.
  const hullBase = opts.hull != null ? opts.hull : null;
  const hullTopHex = hullBase != null ? _tint(hullBase, 1.18) : 0xb7c3d6;
  const hullLowHex = hullBase != null ? hullBase : 0x76849b;
  const greebleHex = hullBase != null ? _tint(hullBase, 0.72) : 0x55607a;
  const ringHex = hullBase != null ? _tint(hullBase, 0.92) : 0x7a8696;
  const lightHex = opts.light != null ? opts.light : COLORS.ufoGlow;
  const domeHex = opts.dome != null ? opts.dome : COLORS.ufoDome;
  const beamHex = opts.light != null ? opts.light : COLORS.beam;

  const g = new THREE.Group();
  const hullTop = mat(hullTopHex, true);   // lighter top shell
  const hullLow = mat(hullLowHex, true);   // darker underside
  const greeble = mat(greebleHex, true);

  // ---- Shared underside emitter lens (beam-adjacent glow uses `light`).
  const emitter = add(g, cylGeo(0.55, 0.74, 0.2, 10),
    emat(beamHex, beamHex, 1.0, true), 0, 0.1, 0);
  emitter.castShadow = false;

  // ---- Rim ring + 8 blinking light bulbs. The torus/halo geometry &
  //      radius differ per shape but the contract (pivot Group `ring`
  //      carrying an 8-entry `lights` array) is identical everywhere.
  const ring = pivot(g, 0, 1.0, 0);
  const lights = [];
  // Per-shape light placement radius / height (set below).
  let lightR = 2.62, lightY = -0.05, ringTorus = null;
  const addRimLights = (radius, y) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI2;
      // Each bulb gets its OWN material so gameplay can blink it alone.
      const bm = new THREE.MeshLambertMaterial({
        color: lightHex, emissive: lightHex, emissiveIntensity: 1.0, flatShading: true,
      });
      const b = add(ring, sphGeo(0.16, 6, 4), bm, Math.cos(a) * radius, y, Math.sin(a) * radius);
      b.castShadow = false;
      lights.push(b);
    }
  };

  // ---- Tinted glass dome material (unique per craft — ufo.js may pulse).
  const domeMat = new THREE.MeshLambertMaterial({
    color: domeHex, emissive: domeHex, emissiveIntensity: 0.25,
    transparent: true, opacity: 0.45, depthWrite: false, flatShading: true,
  });

  let dome;

  if (shape === 'orb') {
    // ---- ORB: rounded egg body, small dome on top, slim equatorial ring.
    //      Belly center y=1.42 (r 1.36 half-height) → bottom ≈ y0, so the
    //      egg sits ON the ground; a short pedestal fills the underside.
    add(g, cylGeo(0.85, 0.55, 0.32, 10), hullLow, 0, 0.16, 0);  // base pedestal
    const belly = add(g, sphGeo(1.48, 12, 9), hullLow, 0, 1.42, 0);
    belly.scale.set(1.0, 0.92, 1.0);                            // egg belly
    const shell = add(g, sphGeo(1.36, 12, 8), hullTop, 0, 1.64, 0);
    shell.scale.set(1.0, 0.78, 1.0);                            // lighter upper shell
    // Vertical hull seam ribs around the equator.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI2;
      const rib = box(g, 0.08, 1.5, 0.1, greeble, Math.cos(a) * 1.4, 1.4, Math.sin(a) * 1.4);
      rib.rotation.y = -a;
    }
    // Slim equatorial ring carrying the rim lights.
    ring.position.y = 1.4;
    ringTorus = add(ring, torusGeo(1.64, 0.1, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(1.72, 0);
    // Small dome + collar on TOP of the egg.
    add(g, cylGeo(0.7, 0.82, 0.14, 10), greeble, 0, 2.22, 0);   // dome collar
    dome = add(g, domeGeo(0.66, 10, 5), domeMat, 0, 2.28, 0);
    dome.scale.set(1, 0.92, 1);
    dome.castShadow = false;
    // Console + antenna sit under the small top dome.
    _ufoConsole(g, greeble, 2.12, 0.5);
    _ufoAntenna(g, greeble, 0.5, 2.4, -0.4);

  } else if (shape === 'delta') {
    // ---- DELTA: angular arrowhead craft, cockpit dome on the spine, rim
    //      lights along the wing edges. The swept planform is built from a
    //      tapered stack of body slabs: sharp nose at +Z, wide tail at -Z.
    // Body slabs forming the delta planform (nose +Z, swept tail -Z).
    const slab = (w, d, y, z, low) => box(g, w, 0.34, d, low ? hullLow : hullTop, 0, y, z);
    slab(0.5, 1.0, 0.95, 1.55, false);                          // sharp nose
    slab(1.6, 1.0, 0.92, 0.7, true);                            // mid fuselage
    slab(2.9, 1.0, 0.9, -0.2, false);                           // broad waist
    slab(3.8, 1.0, 0.88, -1.05, true);                          // wide tail block
    // Raised dorsal spine ridge.
    box(g, 0.6, 0.4, 2.6, hullTop, 0, 1.28, 0.1);
    // Swept-back tail fins (wingtip edges) angled up.
    for (const s of [-1, 1]) {
      const fin = box(g, 0.16, 0.7, 1.0, greeble, s * 1.7, 1.15, -1.0);
      fin.rotation.z = s * 0.4;
    }
    // Underside emitter recess panel.
    box(g, 1.3, 0.16, 1.3, greeble, 0, 0.66, -0.1);
    // Rim ring: lights run along the wing EDGES (a flat oval ring).
    ring.position.y = 0.95;
    ringTorus = add(ring, torusGeo(2.0, 0.12, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    ringTorus.scale.set(0.95, 1.25, 1);                         // stretch toward the tail
    // Place 8 lights along the delta outline rather than a circle.
    const edge = [
      [0, 1.7], [0.95, 0.6], [1.55, -0.7], [1.55, -1.4],
      [-1.55, -1.4], [-1.55, -0.7], [-0.95, 0.6], [0, 1.7],
    ];
    for (let i = 0; i < 8; i++) {
      const [lx, lz] = edge[i];
      const bm = new THREE.MeshLambertMaterial({
        color: lightHex, emissive: lightHex, emissiveIntensity: 1.0, flatShading: true,
      });
      const b = add(ring, sphGeo(0.15, 6, 4), bm, lx, 0, lz);
      b.castShadow = false;
      lights.push(b);
    }
    // Cockpit dome on the spine + console + antenna.
    add(g, cylGeo(0.66, 0.78, 0.12, 10), greeble, 0, 1.5, 0.2);
    dome = add(g, domeGeo(0.62, 10, 5), domeMat, 0, 1.56, 0.2);
    dome.scale.set(1, 0.82, 1.15);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.46, 0.7);
    _ufoAntenna(g, greeble, 0.0, 1.7, -1.2);

  } else if (shape === 'ringed') {
    // ---- RINGED: compact core with a big separate halo RING around it.
    //      The `ring` pivot IS the prominent halo; lights set into it.
    add(g, cylGeo(0.9, 0.6, 0.4, 10), hullLow, 0, 0.32, 0);     // base cone
    const core = add(g, sphGeo(1.3, 12, 9), hullLow, 0, 1.15, 0);
    core.scale.set(1, 0.85, 1);                                 // compact belly
    const cap = add(g, sphGeo(1.18, 12, 8), hullTop, 0, 1.32, 0);
    cap.scale.set(1, 0.62, 1);                                  // lighter cap
    // Greeble band around the core waist.
    add(g, cylGeo(1.2, 1.2, 0.2, 12), greeble, 0, 1.1, 0);
    // Prominent halo ring (the spinning pivot) — fat torus + 8 inset lights.
    ring.position.y = 1.15;
    ringTorus = add(ring, torusGeo(2.25, 0.26, 8, 18), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    // Decorative spokes/struts tying the halo to the core.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI2 + 0.4;
      const strut = box(ring, 1.0, 0.1, 0.1, greeble,
        Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55);
      strut.rotation.y = -a;
    }
    addRimLights(2.25, 0);                                      // lights set INTO the halo
    // Dome on top of the core + console + antenna.
    add(g, cylGeo(0.96, 1.06, 0.14, 10), greeble, 0, 1.74, 0);
    dome = add(g, domeGeo(0.92, 10, 5), domeMat, 0, 1.8, 0);
    dome.scale.set(1, 0.82, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.7, 0.42);
    _ufoAntenna(g, greeble, 0.62, 2.0, -0.42);

  } else if (shape === 'mushroom') {
    // ---- MUSHROOM: tall slender stalk topped by a wide flattened domed cap.
    //      Glass dome (cockpit) is a small nub on top of the cap; rim lights
    //      tucked under the cap edge.
    add(g, cylGeo(0.42, 0.62, 0.3, 10), hullLow, 0, 0.15, 0);    // foot flare
    add(g, cylGeo(0.34, 0.4, 1.5, 10), hullTop, 0, 1.0, 0);      // slender stalk
    add(g, cylGeo(0.5, 0.36, 0.18, 10), greeble, 0, 1.7, 0);     // collar under cap
    // Wide domed cap (a flattened hemisphere) — the main body.
    const cap = add(g, domeGeo(1.9, 12, 6), hullTop, 0, 1.78, 0);
    cap.scale.set(1, 0.62, 1);
    // Cap underside ring (darker) so the silhouette reads from below.
    const under = add(g, cylGeo(1.86, 1.5, 0.16, 16), hullLow, 0, 1.74, 0);
    under.castShadow = false;
    // Spots dotted over the cap top.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI2 + 0.3;
      const r = 0.7 + (i % 2) * 0.5;
      const sp = add(g, sphGeo(0.16, 6, 4), greeble,
        Math.cos(a) * r, 2.0 + (i % 2 ? 0.12 : 0.2), Math.sin(a) * r);
      sp.scale.set(1, 0.5, 1);
    }
    // Rim ring: lights under the cap edge.
    ring.position.y = 1.72;
    ringTorus = add(ring, torusGeo(1.84, 0.1, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(1.86, 0.02);
    // Small glass dome nub on the very top of the cap.
    add(g, cylGeo(0.4, 0.5, 0.1, 10), greeble, 0, 2.36, 0);      // dome collar
    dome = add(g, domeGeo(0.4, 10, 5), domeMat, 0, 2.42, 0);
    dome.scale.set(1, 0.9, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 2.28, 0.3);
    _ufoAntenna(g, greeble, 0.42, 2.6, -0.3);

  } else if (shape === 'crystal') {
    // ---- CRYSTAL: angular faceted gem — two stacked cones base-to-base make
    //      an octahedron-ish body; box facets add edges; glass dome at the top
    //      tip; rim lights around the widest equator.
    add(g, cylGeo(0.6, 0.78, 0.22, 8), hullLow, 0, 0.11, 0);     // base nub
    // Lower cone (point down), upper cone (point up) meeting at the equator.
    const lower = add(g, cylGeo(1.7, 0.05, 1.05, 8), hullLow, 0, 0.72, 0);
    lower.rotation.y = Math.PI / 8;
    const upper = add(g, cylGeo(0.05, 1.7, 1.2, 8), hullTop, 0, 1.85, 0);
    upper.rotation.y = Math.PI / 8;
    // Equator collar band.
    add(g, cylGeo(1.74, 1.74, 0.14, 8), greeble, 0, 1.24, 0).rotation.y = Math.PI / 8;
    // A few box facets riding the upper faces to catch the light.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI2 + Math.PI / 4;
      const fac = box(g, 0.5, 0.7, 0.12, greeble,
        Math.cos(a) * 1.0, 1.7, Math.sin(a) * 1.0);
      fac.rotation.y = -a;
      fac.rotation.x = 0.5;
    }
    // Rim ring at the widest equator.
    ring.position.y = 1.24;
    ringTorus = add(ring, torusGeo(1.82, 0.12, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(1.86, 0);
    // Glass dome capping the very top tip.
    dome = add(g, domeGeo(0.46, 10, 5), domeMat, 0, 2.45, 0);
    dome.scale.set(1, 1.1, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.5, 0.34);
    _ufoAntenna(g, greeble, 0.55, 2.0, -0.34);

  } else if (shape === 'star') {
    // ---- STAR: flattened multi-point star — thin elongated boxes radiate
    //      from a low central hub at one height; dome on the hub; one light
    //      near each point (8 points → 8 lights).
    add(g, cylGeo(0.95, 1.1, 0.34, 10), hullLow, 0, 0.17, 0);    // hub underside
    const hub = add(g, cylGeo(1.0, 0.95, 0.4, 10), hullTop, 0, 0.5, 0);
    hub.castShadow = false;
    const points = 8;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * PI2;
      // Elongated tapered arm pointing outward at hull height.
      const arm = box(g, 0.42, 0.34, 2.0, i % 2 ? hullTop : hullLow,
        Math.cos(a) * 1.15, 0.5, Math.sin(a) * 1.15);
      arm.rotation.y = -a + Math.PI / 2;
    }
    // Rim ring: one light out near each point tip.
    ring.position.y = 0.5;
    ringTorus = add(ring, torusGeo(2.1, 0.1, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI2;
      const bm = new THREE.MeshLambertMaterial({
        color: lightHex, emissive: lightHex, emissiveIntensity: 1.0, flatShading: true,
      });
      const b = add(ring, sphGeo(0.16, 6, 4), bm,
        Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2);
      b.castShadow = false;
      lights.push(b);
    }
    // Dome on the hub center.
    add(g, cylGeo(0.78, 0.9, 0.14, 10), greeble, 0, 0.74, 0);    // dome collar
    dome = add(g, domeGeo(0.74, 10, 5), domeMat, 0, 0.8, 0);
    dome.scale.set(1, 0.85, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 0.72, 0.34);
    _ufoAntenna(g, greeble, 0.5, 1.1, -0.34);

  } else if (shape === 'tripod') {
    // ---- TRIPOD: domed central pod (sphere) standing on three angled leg
    //      struts splayed to the ground; dome on the pod top; rim lights
    //      around the pod equator.
    // Three splayed legs reaching from the pod down to the ground.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI2 + Math.PI / 6;
      const leg = box(g, 0.16, 1.7, 0.22, greeble,
        Math.cos(a) * 0.85, 0.82, Math.sin(a) * 0.85);
      leg.rotation.y = -a;
      leg.rotation.x = Math.cos(a) * 0.42;
      leg.rotation.z = -Math.sin(a) * 0.42;
      // Foot pad on the ground.
      box(g, 0.34, 0.12, 0.34, hullLow, Math.cos(a) * 1.55, 0.06, Math.sin(a) * 1.55);
    }
    // Central pod sphere lifted on the legs.
    const pod = add(g, sphGeo(1.2, 12, 9), hullLow, 0, 1.7, 0);
    pod.scale.set(1, 0.92, 1);
    const podCap = add(g, sphGeo(1.1, 12, 8), hullTop, 0, 1.86, 0);
    podCap.scale.set(1, 0.6, 1);
    // Greeble band around the pod waist.
    add(g, cylGeo(1.16, 1.16, 0.18, 12), greeble, 0, 1.6, 0);
    // Rim ring around the pod equator.
    ring.position.y = 1.6;
    ringTorus = add(ring, torusGeo(1.36, 0.12, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(1.42, 0);
    // Dome on top of the pod.
    add(g, cylGeo(0.82, 0.94, 0.14, 10), greeble, 0, 2.2, 0);    // dome collar
    dome = add(g, domeGeo(0.78, 10, 5), domeMat, 0, 2.26, 0);
    dome.scale.set(1, 0.85, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 2.12, 0.34);
    _ufoAntenna(g, greeble, 0.5, 2.45, -0.34);

  } else if (shape === 'cube') {
    // ---- CUBE: boxy/blocky craft — a main cuboid body with chamfer detail
    //      boxes and corner greebles; small dome on top; rim lights along the
    //      bottom edges (2 per side ≈ 8).
    box(g, 2.6, 1.7, 2.6, hullTop, 0, 1.05, 0);                  // main body cube
    box(g, 2.8, 0.4, 2.8, hullLow, 0, 0.32, 0);                 // wider base slab
    box(g, 2.3, 0.3, 2.3, greeble, 0, 1.95, 0);                // top trim slab
    // Chamfer / panel detail boxes on the four vertical faces.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI2;
      const panel = box(g, 1.4, 1.0, 0.14, i % 2 ? greeble : hullLow,
        Math.cos(a) * 1.34, 1.05, Math.sin(a) * 1.34);
      panel.rotation.y = -a;
    }
    // Corner greeble nubs at the eight cube corners.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 0.34, 1.8, 0.34, greeble, sx * 1.28, 1.05, sz * 1.28);
    }
    // Rim ring: lights along the bottom edges, 2 per side.
    ring.position.y = 0.34;
    ringTorus = add(ring, torusGeo(1.9, 0.1, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    const cubeEdge = [
      [-0.8, 1.3], [0.8, 1.3], [1.3, 0.8], [1.3, -0.8],
      [0.8, -1.3], [-0.8, -1.3], [-1.3, -0.8], [-1.3, 0.8],
    ];
    for (let i = 0; i < 8; i++) {
      const [lx, lz] = cubeEdge[i];
      const bm = new THREE.MeshLambertMaterial({
        color: lightHex, emissive: lightHex, emissiveIntensity: 1.0, flatShading: true,
      });
      const b = add(ring, sphGeo(0.15, 6, 4), bm, lx, 0, lz);
      b.castShadow = false;
      lights.push(b);
    }
    // Small dome on top.
    add(g, cylGeo(0.7, 0.82, 0.14, 10), greeble, 0, 2.16, 0);    // dome collar
    dome = add(g, domeGeo(0.66, 10, 5), domeMat, 0, 2.22, 0);
    dome.scale.set(1, 0.85, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 2.08, 0.4);
    _ufoAntenna(g, greeble, 0.6, 2.4, -0.4);

  } else if (shape === 'bell') {
    // ---- BELL: smooth bell/teardrop hull — a flared cone body capped by a
    //      rounded sphere; small dome on top; rim lights around the flared
    //      base.
    add(g, cylGeo(2.1, 2.2, 0.18, 16), hullLow, 0, 0.09, 0);    // base lip
    // Flared bell body (wide at the bottom, narrow at the top).
    add(g, cylGeo(0.8, 2.1, 1.8, 16), hullTop, 0, 1.05, 0);
    // Rounded sphere cap blending the bell's shoulder.
    const bellCap = add(g, sphGeo(0.95, 12, 8), hullTop, 0, 2.0, 0);
    bellCap.scale.set(1, 0.78, 1);
    // Vertical flute ribs around the bell flare.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI2;
      const rib = box(g, 0.1, 1.7, 0.12, greeble,
        Math.cos(a) * 1.5, 1.05, Math.sin(a) * 1.5);
      rib.rotation.y = -a;
    }
    // Rim ring around the flared base.
    ring.position.y = 0.3;
    ringTorus = add(ring, torusGeo(2.16, 0.12, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(2.2, 0);
    // Small dome on top.
    add(g, cylGeo(0.6, 0.72, 0.12, 10), greeble, 0, 2.42, 0);    // dome collar
    dome = add(g, domeGeo(0.56, 10, 5), domeMat, 0, 2.48, 0);
    dome.scale.set(1, 0.9, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 2.0, 0.5);
    _ufoAntenna(g, greeble, 0.55, 2.65, -0.4);

  } else if (shape === 'manta') {
    // ---- MANTA: wide flat stingray wing — a broad shallow ellipsoid body,
    //      swept wing tips, a short tail box; low cockpit dome near the front;
    //      8 lights spread along the wing leading edges (manual placement).
    add(g, cylGeo(1.1, 0.8, 0.34, 10), hullLow, 0, 0.17, 0);    // belly pedestal
    // Broad shallow body: a flattened, wide ellipsoid.
    const body = add(g, sphGeo(1.6, 14, 9), hullTop, 0, 0.74, 0.1);
    body.scale.set(1.7, 0.34, 1.25);
    const bodyLow = add(g, sphGeo(1.55, 14, 8), hullLow, 0, 0.62, 0.1);
    bodyLow.scale.set(1.65, 0.3, 1.2);
    // Swept wing tips angled up off each side.
    for (const s of [-1, 1]) {
      const wing = box(g, 1.5, 0.18, 1.6, hullTop, s * 2.0, 0.86, -0.1);
      wing.rotation.z = -s * 0.32;
      wing.rotation.y = s * 0.3;
    }
    // Short tail box trailing at the back.
    const mantaTail = box(g, 0.22, 0.18, 1.4, greeble, 0, 0.78, -1.7);
    mantaTail.rotation.x = -0.12;
    // Cephalic head fins at the front.
    for (const s of [-1, 1]) {
      box(g, 0.3, 0.16, 0.6, greeble, s * 0.5, 0.78, 1.5).rotation.x = 0.2;
    }
    // Rim ring; lights run along the swept leading edges, not a circle.
    ring.position.y = 0.8;
    ringTorus = add(ring, torusGeo(2.2, 0.12, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    ringTorus.scale.set(1.25, 0.95, 1);                          // stretch out the wings
    const mantaEdge = [
      [0, 1.5], [1.2, 0.9], [2.2, 0.1], [1.6, -1.0],
      [-1.6, -1.0], [-2.2, 0.1], [-1.2, 0.9], [0, 1.5],
    ];
    for (let i = 0; i < 8; i++) {
      const [lx, lz] = mantaEdge[i];
      const bm = new THREE.MeshLambertMaterial({
        color: lightHex, emissive: lightHex, emissiveIntensity: 1.0, flatShading: true,
      });
      const b = add(ring, sphGeo(0.15, 6, 4), bm, lx, 0, lz);
      b.castShadow = false;
      lights.push(b);
    }
    // Low cockpit dome near the front of the body.
    add(g, cylGeo(0.62, 0.74, 0.12, 10), greeble, 0, 0.92, 0.7);
    dome = add(g, domeGeo(0.58, 10, 5), domeMat, 0, 0.98, 0.7);
    dome.scale.set(1, 0.7, 1.2);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 0.9, 1.0);
    _ufoAntenna(g, greeble, 0.0, 1.15, -1.4);

  } else if (shape === 'spinner') {
    // ---- SPINNER: twin-disc gyro — two stacked thin discs separated by a
    //      slim core, with a ring of vertical greeble fins between them; dome
    //      on top; rim lights around the upper disc edge.
    add(g, cylGeo(0.7, 0.9, 0.3, 12), hullLow, 0, 0.15, 0);     // foot
    // Lower disc.
    add(g, cylGeo(2.3, 2.3, 0.26, 16), hullLow, 0, 0.55, 0);
    add(g, cylGeo(2.34, 2.1, 0.12, 16), greeble, 0, 0.4, 0);    // lower rim trim
    // Slim core between the discs.
    add(g, cylGeo(0.9, 0.9, 0.7, 12), greeble, 0, 1.05, 0);
    // Ring of vertical fins between the discs.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI2;
      const fin = box(g, 0.1, 0.6, 0.4, i % 2 ? hullTop : greeble,
        Math.cos(a) * 1.4, 1.05, Math.sin(a) * 1.4);
      fin.rotation.y = -a;
    }
    // Upper disc.
    add(g, cylGeo(2.0, 2.0, 0.26, 16), hullTop, 0, 1.55, 0);
    add(g, cylGeo(1.84, 2.04, 0.12, 16), greeble, 0, 1.7, 0);   // upper rim trim
    // Rim ring around the upper disc edge.
    ring.position.y = 1.55;
    ringTorus = add(ring, torusGeo(2.08, 0.12, 6, 16), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(2.08, 0);
    // Dome on top.
    add(g, cylGeo(0.78, 0.9, 0.14, 10), greeble, 0, 1.78, 0);   // dome collar
    dome = add(g, domeGeo(0.74, 10, 5), domeMat, 0, 1.84, 0);
    dome.scale.set(1, 0.82, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.74, 0.4);
    _ufoAntenna(g, greeble, 0.6, 2.05, -0.4);

  } else if (shape === 'jelly') {
    // ---- JELLY: jellyfish craft — a smooth translucent-looking domed BELL is
    //      the main body (a hemisphere hull, wider at the bottom rim) with thin
    //      tapering tentacle strands dangling below the rim; the glass dome is a
    //      small bump at the very top; rim lights around the bell's lower rim.
    // Big domed bell body (a flattened-ish hemisphere) — the hull.
    const bell = add(g, domeGeo(2.4, 14, 7), hullTop, 0, 0.95, 0);
    bell.scale.set(1, 0.78, 1);                                 // dome top ≈ y 2.82
    const bellLow = add(g, domeGeo(2.42, 14, 6), hullLow, 0, 0.9, 0);
    bellLow.scale.set(1, 0.42, 1);                              // darker lower bell
    // Flared lower rim lip the tentacles hang from.
    add(g, cylGeo(2.46, 2.2, 0.22, 18), hullLow, 0, 0.96, 0);
    // Scalloped greeble nubs around the bell waist.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI2 + 0.2;
      const sc = add(g, sphGeo(0.22, 6, 4), greeble,
        Math.cos(a) * 2.0, 1.5, Math.sin(a) * 2.0);
      sc.scale.set(1, 0.6, 1);
    }
    // Six tapering tentacle strands dangling BELOW the rim (stacked boxes).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI2 + 0.1;
      const tx = Math.cos(a) * 1.95, tz = Math.sin(a) * 1.95;
      const segs = 4, top = 0.86;
      for (let k = 0; k < segs; k++) {
        const w = 0.26 - k * 0.05;                              // taper toward the tip
        const sy = top - k * 0.22;
        const strand = box(g, w, 0.2, w, k % 2 ? hullLow : greeble, tx, sy, tz);
        strand.castShadow = false;
      }
    }
    // Rim ring around the bell's lower rim.
    ring.position.y = 0.96;
    ringTorus = add(ring, torusGeo(2.4, 0.12, 6, 18), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(2.46, 0.04);
    // Small glass dome bump at the very top of the bell.
    add(g, cylGeo(0.5, 0.6, 0.1, 10), greeble, 0, 2.66, 0);     // dome collar
    dome = add(g, domeGeo(0.48, 10, 5), domeMat, 0, 2.72, 0);
    dome.scale.set(1, 0.9, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.7, 0.4);
    _ufoAntenna(g, greeble, 0.5, 2.9, -0.4);

  } else if (shape === 'beetle') {
    // ---- BEETLE: ladybug craft — a rounded domed carapace SPLIT down the
    //      middle into two shell halves with a seam ridge between them, a head
    //      bump at the front (+Z), short side leg-nubs; the cockpit dome peeks
    //      where the shells meet near the front; rim lights around the carapace.
    add(g, cylGeo(2.1, 2.3, 0.3, 16), hullLow, 0, 0.15, 0);     // belly underside
    // Two carapace shell halves: flattened half-domes either side of the seam.
    for (const s of [-1, 1]) {
      const shell = add(g, domeGeo(2.15, 14, 7), hullTop, s * 0.46, 0.4, -0.1);
      shell.scale.set(0.92, 0.92, 1.15);                        // long, slightly flat
      // Darker shell underskirt so the silhouette reads from below.
      const skirt = add(g, domeGeo(2.1, 12, 5), hullLow, s * 0.46, 0.32, -0.1);
      skirt.scale.set(0.9, 0.42, 1.1);
      // A couple of ladybug spots dotted on each shell.
      for (let k = 0; k < 2; k++) {
        const sp = add(g, sphGeo(0.26, 6, 4), greeble,
          s * (0.85 + k * 0.45), 1.55 - k * 0.35, -0.4 + k * 0.9);
        sp.scale.set(1, 0.5, 1);
      }
    }
    // Central seam ridge running front-to-back over the carapace gap.
    const seam = box(g, 0.2, 0.4, 3.4, greeble, 0, 1.55, -0.1);
    seam.rotation.x = -0.04;
    // Rounded head bump at the front (+Z).
    const head = add(g, sphGeo(0.95, 12, 8), greeble, 0, 1.0, 2.0);
    head.scale.set(1.1, 0.78, 0.8);
    // Short side leg-nubs splayed out low (kept clear of the ground at y0).
    for (const s of [-1, 1]) for (const lz of [1.1, -0.3, -1.4]) {
      const leg = box(g, 0.66, 0.16, 0.18, greeble, s * 2.12, 0.62, lz);
      leg.rotation.z = -s * 0.18;
    }
    // Rim ring around the carapace edge.
    ring.position.y = 0.5;
    ringTorus = add(ring, torusGeo(2.4, 0.12, 6, 18), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    ringTorus.scale.set(1, 1.12, 1);                            // stretch front-to-back
    addRimLights(2.42, 0);
    // Cockpit dome peeking where the shells meet, near the front.
    add(g, cylGeo(0.66, 0.78, 0.12, 10), greeble, 0, 1.62, 0.95);
    dome = add(g, domeGeo(0.62, 10, 5), domeMat, 0, 1.68, 0.95);
    dome.scale.set(1, 0.82, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.58, 1.3);
    _ufoAntenna(g, greeble, 0.0, 1.85, 2.2);

  } else if (shape === 'donut') {
    // ---- DONUT: torus craft — the dominant body is a big fat horizontal torus
    //      you can see the hole through, with a small central cockpit pod
    //      suspended in the middle on thin spokes; rim lights set INTO the torus
    //      around its top. Distinct from 'ringed': here the torus IS the body.
    // Dominant fat horizontal torus body (you can see through the hole).
    const tube = add(g, torusGeo(1.65, 0.95, 12, 20), hullTop, 0, 1.05, 0);
    tube.rotation.x = Math.PI / 2;
    // Darker lower half-tube to ground the silhouette.
    const tubeLow = add(g, torusGeo(1.65, 0.86, 10, 20), hullLow, 0, 0.9, 0);
    tubeLow.rotation.x = Math.PI / 2;
    tubeLow.scale.set(1, 1, 0.6);
    // Greeble panel ribs wrapping over the torus top.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI2 + 0.2;
      const rib = box(g, 0.16, 0.5, 0.9, greeble,
        Math.cos(a) * 1.65, 1.4, Math.sin(a) * 1.65);
      rib.rotation.y = -a;
    }
    // Small central cockpit pod suspended in the hole on thin spokes.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI2 + Math.PI / 4;
      const spoke = box(g, 1.4, 0.1, 0.1, greeble,
        Math.cos(a) * 0.78, 1.05, Math.sin(a) * 0.78);
      spoke.rotation.y = -a;
    }
    const pod = add(g, sphGeo(0.72, 12, 8), hullLow, 0, 1.05, 0);
    pod.scale.set(1, 0.92, 1);
    add(g, cylGeo(0.6, 0.7, 0.12, 10), greeble, 0, 0.66, 0);    // pod skirt
    // Rim ring set INTO the torus around its top.
    ring.position.y = 1.4;
    ringTorus = add(ring, torusGeo(1.65, 0.1, 6, 18), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(1.65, 0.1);
    // Glass dome capping the central pod.
    add(g, cylGeo(0.56, 0.66, 0.12, 10), greeble, 0, 1.46, 0);  // dome collar
    dome = add(g, domeGeo(0.52, 10, 5), domeMat, 0, 1.52, 0);
    dome.scale.set(1, 0.9, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.42, 0.32);
    _ufoAntenna(g, greeble, 0.4, 1.7, -0.32);

  } else {
    // ---- SAUCER (classic, default): flattened two-tone lens. EXACT.
    add(g, cylGeo(1.42, 0.66, 0.55, 10), hullLow, 0, 0.5, 0);    // hub cone
    add(g, cylGeo(1.46, 1.34, 0.1, 12), greeble, 0, 0.31, 0);    // inner ring
    add(g, cylGeo(1.98, 1.88, 0.14, 12), hullLow, 0, 0.46, 0);   // outer ring
    for (let i = 0; i < 4; i++) {                                 // greeble pods
      const a = (i / 4) * PI2 + 0.4;
      box(g, 0.34, 0.22, 0.3, i % 2 ? greeble : hullLow,
        Math.cos(a) * 1.55, 0.5, Math.sin(a) * 1.55).rotation.y = -a;
    }
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
    // Rim ring carrying 8 light bulbs.
    ringTorus = add(ring, torusGeo(2.55, 0.18, 6, 14), mat(ringHex, true), 0, 0, 0);
    ringTorus.rotation.x = Math.PI / 2;
    addRimLights(lightR, lightY);
    // Dome collar + dome.
    add(g, cylGeo(1.24, 1.34, 0.16, 10), greeble, 0, 1.5, 0);
    dome = add(g, domeGeo(1.15, 10, 5), domeMat, 0, 1.35, 0);
    dome.scale.set(1, 0.8, 1);
    dome.castShadow = false;
    _ufoConsole(g, greeble, 1.45, 0.42);
    _ufoAntenna(g, greeble, 0.78, 1.9, -0.55);
  }

  // Beam anchor at the bottom center (under the craft).
  const beamAnchor = new THREE.Object3D();
  beamAnchor.position.set(0, 0.08, 0);
  g.add(beamAnchor);

  g.userData = { dome, ring, lights, beamAnchor };
  return g;
}

// Multiply an 0xRRGGBB colour by a factor per channel (clamped) — used to
// derive light cap / dark belly / greeble tones from a single hull colour.
function _tint(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const gC = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (gC << 8) | b;
}

// Shared alien-free cockpit console (desk + panel + two blinking lights).
// Parented onto the craft at the given y; faces +Z by `front` z offset.
function _ufoConsole(g, greeble, y, front) {
  const console_ = pivot(g, 0, y, 0);
  box(console_, 0.56, 0.14, 0.3, greeble, 0, 0.16, front);
  box(console_, 0.46, 0.18, 0.16, mat(0x44506a, true), 0, 0.27, front + 0.04);
  const bl1 = box(console_, 0.1, 0.07, 0.06, emat(0xff5252, 0xff1744, 1.0), -0.14, 0.34, front + 0.04);
  bl1.castShadow = false;
  const bl2 = box(console_, 0.1, 0.07, 0.06, emat(0x7ce8ff, 0x00b8d4, 1.0), 0.14, 0.34, front + 0.04);
  bl2.castShadow = false;
}

// Shared little antenna with an emissive pink tip.
function _ufoAntenna(g, greeble, x, y, z) {
  box(g, 0.04, 0.5, 0.04, greeble, x, y - 0.28, z);
  const antTip = add(g, sphGeo(0.07, 5, 4), emat(0xff6b9d, 0xff2d78, 1.0, true), x, y, z);
  antTip.castShadow = false;
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
 *  createDog — "Astro" the border collie sheepdog. ~1.4 long, ~0.9 tall.
 *  Origin at the BOTTOM-CENTER; faces +Z like every character.
 *  userData: { legs: [FL, FR, BL, BR], tail, head }
 *  legs pivot at the hips (rotation.x = run cycle), tail pivots at the base
 *  (rotation.y wag / rotation.x stream), head pivots at the neck (bark bob).
 *  Classic black-and-white collie: white base coat with black saddle/face
 *  patches, a folded-tip perky ear pair, a snout, a fluffy plumed tail, and
 *  a RED BANDANNA around the neck. ≤ ~30 meshes; geometry/material shared.
 * ------------------------------------------------------------------ */

export function createDog() {
  const g = new THREE.Group();
  const white = mat(0xf5f5f0);          // collie white coat
  const black = mat(0x232323);          // black collie patches
  const pink = mat(COLORS.cowPink);     // tongue / inner ear
  const nose = mat(0x14110e);           // nose + eyes
  const bandana = mat(0xc62828);        // red neck bandanna

  // Body — white barrel with a black saddle patch over the back, lower chest.
  box(g, 0.46, 0.42, 0.92, white, 0, 0.56, -0.02);          // main torso
  box(g, 0.4, 0.16, 0.62, white, 0, 0.34, 0.02);            // lower belly/chest
  box(g, 0.48, 0.34, 0.5, black, 0, 0.62, -0.18);           // black back saddle
  box(g, 0.3, 0.12, 0.2, black, 0.1, 0.66, 0.22);           // small shoulder fleck
  box(g, 0.4, 0.26, 0.2, white, 0, 0.46, 0.4);              // white chest blaze

  // Legs — pivot at the hip (y = 0.42). Order: FL, FR, BL, BR. White socks.
  const legs = [];
  for (const [lx, lz] of [[0.16, 0.32], [-0.16, 0.32], [0.16, -0.34], [-0.16, -0.34]]) {
    const hip = pivot(g, lx, 0.42, lz);
    box(hip, 0.15, 0.34, 0.16, white, 0, -0.18, 0);          // leg
    box(hip, 0.17, 0.1, 0.2, white, 0, -0.36, 0.02);         // white paw/sock
    legs.push(hip);
  }

  // Tail — pivot at the base; fluffy plume that streams when running.
  const tail = pivot(g, 0, 0.62, -0.48);
  const tailSeg = box(tail, 0.13, 0.13, 0.34, white, 0, 0.02, -0.16);
  tailSeg.rotation.x = -0.5;                                  // lifts up at rest
  const tailTip = box(tail, 0.16, 0.16, 0.18, white, 0, 0.16, -0.34);
  tailTip.rotation.x = -0.5;
  box(tail, 0.1, 0.1, 0.12, black, 0, 0.06, -0.22).rotation.x = -0.5; // dark mid-band

  // Red bandanna around the neck (knot at the front).
  const band = box(g, 0.42, 0.16, 0.3, bandana, 0, 0.62, 0.34);
  band.rotation.x = 0.3;
  box(g, 0.12, 0.14, 0.1, bandana, 0, 0.5, 0.5);             // bandanna knot

  // Head — pivot at the neck; bobs down with rotation.x for the bark.
  const head = pivot(g, 0, 0.72, 0.4);
  box(head, 0.34, 0.32, 0.32, white, 0, 0.06, 0.06);         // white skull
  box(head, 0.36, 0.2, 0.18, black, 0, 0.16, -0.02);         // black crown/mask top
  box(head, 0.16, 0.26, 0.16, black, -0.1, 0.04, 0.08);      // left face patch (split mask)
  // Snout + black nose + pink tongue.
  box(head, 0.18, 0.16, 0.24, white, 0, -0.02, 0.26);        // muzzle
  box(head, 0.1, 0.08, 0.06, nose, 0, 0.04, 0.4);            // nose
  const tongue = box(head, 0.08, 0.04, 0.12, pink, 0, -0.08, 0.34);
  tongue.rotation.x = 0.4;                                    // lolling tongue
  // Eyes.
  box(head, 0.06, 0.08, 0.04, nose, -0.1, 0.12, 0.21);
  box(head, 0.06, 0.08, 0.04, nose, 0.1, 0.12, 0.21);
  // Ears — perky base with a folded-over collie tip.
  for (const s of [-1, 1]) {
    const ear = box(head, 0.1, 0.18, 0.07, black, s * 0.16, 0.28, 0.0);
    ear.rotation.z = s * 0.2;
    const fold = box(head, 0.1, 0.07, 0.08, white, s * 0.17, 0.36, 0.04); // folded tip
    fold.rotation.set(0.5, 0, s * 0.2);
    box(head, 0.05, 0.1, 0.04, pink, s * 0.15, 0.27, 0.02);  // pink inner ear
  }

  g.userData = { legs, tail, head };
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

  // Walls: lower box + a single gambrel-PRISM gable mass whose cross-section
  // traces the gambrel roofline itself — eave(z=±5,y=4.85) → knuckle(z=±4,
  // y=7.0) → ridge(z=0,y=8.5) — so the steep lower and shallow upper roof
  // panels sit flush on angled faces and the gable end reads as one clean
  // gambrel silhouette instead of two stacked rectangular blocks. Length
  // inset to 9.92 to avoid z-fighting the front/back wall planes.
  box(g, 12, 4.3, 10, red, 0, 2.7, 0);                 // main wall (eave at 4.85)
  add(g, prismXGeo([
    [4.85, -5], [7.0, -4.0], [8.5, 0], [7.0, 4.0], [4.85, 5],
  ], 9.92), red, 0, 0, 0);                             // gambrel gable mass

  // Gambrel roof: steep LOWER panels (eave→knuckle) + shallow UPPER
  // panels (knuckle→ridge) that meet cleanly under a single ridge cap.
  // Profile per side: eave(6,4.85) → knuckle(4.0,7.0) → ridge(0,8.5).
  for (const s of [-1, 1]) {
    const lower = box(g, 2.95, 0.16, 10.8, roof, s * 5.0, 5.93, 0);
    lower.rotation.z = -s * 0.821;
    const upper = box(g, 4.3, 0.16, 10.8, roof, s * 2.0, 7.75, 0);
    upper.rotation.z = -s * 0.359;
  }
  box(g, 0.55, 0.3, 11.0, mat(0x553b32), 0, 8.55, 0);  // ridge cap

  // White trim: corner boards + eave bands + raking gable trim.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(g, 0.33, 4.3, 0.33, trim, sx * 5.97, 2.7, sz * 4.97);
    }
  }
  box(g, 12.4, 0.26, 0.26, trim, 0, 4.86, 5.01);       // eave bands (front/back)
  box(g, 12.4, 0.26, 0.26, trim, 0, 4.86, -5.01);
  box(g, 0.26, 0.26, 10.4, trim, 6.02, 4.86, 0);       // eave bands (sides)
  box(g, 0.26, 0.26, 10.4, trim, -6.02, 4.86, 0);

  // Big X-braced SLIDING door, flush on its overhead track. Door panel
  // top (y=4.25) tucks just under the track; rollers bridge the gap.
  box(g, 5.0, 0.16, 0.22, dark, 0, 4.5, 5.07);                        // track bar
  box(g, 0.22, 0.28, 0.16, mat(0x55606a), -1.0, 4.36, 5.14);          // roller L
  box(g, 0.22, 0.28, 0.16, mat(0x55606a), 1.0, 4.36, 5.14);           // roller R
  const doorPanel = box(g, 3.4, 3.6, 0.12, mat(COLORS.woodDark, false, 'door'), 0, 2.4, 5.07);
  void doorPanel;
  box(g, 3.5, 0.16, 0.06, trim, 0, 4.18, 5.14);                       // top rail
  box(g, 3.5, 0.16, 0.06, trim, 0, 0.66, 5.14);                       // bottom rail
  box(g, 0.16, 3.6, 0.06, trim, -1.66, 2.4, 5.14);                    // door stiles
  box(g, 0.16, 3.6, 0.06, trim, 1.66, 2.4, 5.14);
  for (const d of [-1, 1]) {                                           // the big X
    const brace = box(g, 0.18, 4.3, 0.05, trim, 0, 2.4, 5.15);
    brace.rotation.z = d * 0.72;
  }
  box(g, 0.1, 0.46, 0.09, mat(0x55606a), -0.3, 2.3, 5.16);            // pull handles
  box(g, 0.1, 0.46, 0.09, mat(0x55606a), 0.3, 2.3, 5.16);

  // Hayloft opening + hoist beam, hanging rope and pulley, hay spilling out.
  box(g, 1.9, 1.9, 0.12, trim, 0, 6.35, 5.0);                         // frame
  box(g, 1.5, 1.5, 0.1, mat(0x2a1f18), 0, 6.35, 5.04);               // dark opening
  box(g, 1.2, 0.5, 0.5, mat(COLORS.straw), 0, 5.75, 5.2);            // loft hay (in opening)
  box(g, 0.9, 0.34, 0.42, mat(0xd9b24a), 0, 6.05, 5.28);            // more hay
  box(g, 0.22, 0.22, 1.5, mat(COLORS.woodDark), 0, 7.5, 5.4);        // hoist beam
  box(g, 0.05, 0.85, 0.05, dark, 0, 7.0, 6.05);                      // rope
  box(g, 0.18, 0.16, 0.18, mat(0x55606a), 0, 6.5, 6.05);             // pulley block
  box(g, 0.08, 0.12, 0.08, mat(0x37474f), 0, 6.38, 6.05);            // hook

  // Two small framed windows flanking the sliding door (inset panes).
  for (const s of [-1, 1]) {
    box(g, 1.0, 1.0, 0.12, trim, s * 3.9, 2.9, 5.0);
    box(g, 0.72, 0.72, 0.06, mat(0x2c3550), s * 3.9, 2.9, 5.05);
    box(g, 0.08, 0.72, 0.07, trim, s * 3.9, 2.9, 5.07);              // mullion V
    box(g, 0.72, 0.08, 0.07, trim, s * 3.9, 2.9, 5.07);             // mullion H
    box(g, 1.15, 0.12, 0.2, trim, s * 3.9, 2.34, 5.04);             // sill
  }

  // Cupola on the ridge: louvred box + little hipped roof, weather vane on top.
  box(g, 1.0, 0.9, 1.0, red, 0, 9.15, 0);                            // cupola body
  for (const s of [-1, 1]) {                                          // louvre slats (front)
    box(g, 0.84, 0.12, 0.06, trim, 0, 9.0 + s * 0.22, 0.5);
    box(g, 0.06, 0.84, 0.84, trim, s * 0.5, 9.15, 0);               // side louvre faces
  }
  box(g, 0.84, 0.12, 0.06, trim, 0, 9.15, 0.5);
  for (const s of [-1, 1]) {                                          // cupola hip roof
    const r = box(g, 0.85, 0.1, 1.2, mat(0x553b32), s * 0.3, 9.78, 0);
    r.rotation.z = -s * 0.5;
  }
  box(g, 0.07, 0.7, 0.07, dark, 0, 10.1, 0);                         // vane post
  box(g, 0.9, 0.05, 0.05, dark, 0, 10.42, 0);                        // arrow shaft
  box(g, 0.14, 0.12, 0.05, dark, 0.48, 10.42, 0);                    // arrow head
  box(g, 0.1, 0.16, 0.05, dark, -0.44, 10.42, 0);                    // arrow tail fin
  box(g, 0.05, 0.24, 0.2, dark, 0, 10.65, 0);                        // rooster body
  box(g, 0.05, 0.12, 0.09, dark, 0, 10.73, 0.13);                    // rooster head
  box(g, 0.05, 0.1, 0.05, mat(0xe53935), 0, 10.83, 0.13);           // comb

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

  // Main walls + a single TRIANGULAR-PRISM gable mass. The prism's
  // cross-section is the gable triangle itself (eaves z=±3.5,y=4.6 →
  // ridge z=0,y=6.5), so its two faces lie flush under the roof slabs and
  // its end caps form clean triangles — no rectangular block pokes out
  // beneath the pitched roof. Inset 0.04 in length/depth to avoid z-fighting.
  box(g, 10, 4.6, 7, wall, 0, 2.3, 0);
  add(g, prismXGeo([[4.6, -3.46], [4.6, 3.46], [6.5, 0]], 9.92), wall, 0, 0, 0);

  // Gable roof: ridge along X at y=6.5, eaves at (z=±3.5, y=4.6). Slope
  // run 3.5, rise 1.9 → angle atan(1.9/3.5)=0.497. Slabs sized to give a
  // clean even overhang on all four edges; matching ridge cap on top.
  const rAng = Math.atan2(1.9, 3.5);                   // ≈ 0.497
  const slabLen = Math.hypot(3.5, 1.9) + 0.55;         // slope length + eave overhang
  for (const s of [-1, 1]) {
    const slab = box(g, 11, 0.2, slabLen, roof, 0, 5.55, s * 1.7);
    slab.rotation.x = s * rAng;
  }
  box(g, 11.0, 0.3, 0.55, mat(0x553b32), 0, 6.6, 0);   // ridge cap (square overhang)

  // Brick chimney rising through the rear slope (square to the wall),
  // with corbel cap + dark flue.
  box(g, 0.85, 3.6, 0.85, mat(0xb46a55, false, 'brick'), 3.0, 5.6, -1.4);
  box(g, 1.1, 0.22, 1.1, mat(0x8a8a8a), 3.0, 7.5, -1.4);   // corbel cap
  box(g, 0.5, 0.16, 0.5, mat(0x2b2b2b), 3.0, 7.66, -1.4);  // flue

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
  windowAt(-3.0, 2.2, 3.52);
  windowAt(3.0, 2.2, 3.52);
  windowAt(-1.6, 4.0, 3.52);
  windowAt(1.6, 4.0, 3.52);

  // A little dormer window on the front roof slope.
  const dormer = pivot(g, 0, 5.45, 2.55);
  box(dormer, 1.4, 1.0, 0.9, wall, 0, 0, 0);                          // dormer box
  for (const s of [-1, 1]) {                                           // dormer roof
    const dr = box(dormer, 0.85, 0.1, 0.7, roof, s * 0.3, 0.55, 0);
    dr.rotation.z = -s * 0.6;
  }
  box(dormer, 0.6, 0.55, 0.1, white, 0, 0.05, 0.46);                // dormer frame
  const dpane = box(dormer, 0.42, 0.4, 0.06, glow, 0, 0.05, 0.5);   // dormer pane
  dpane.castShadow = false;

  // Paneled front door with a little lit window + brass knob.
  box(g, 1.4, 2.4, 0.1, white, 0, 1.6, 3.52);
  box(g, 1.1, 2.2, 0.12, mat(0x6e4435, false, 'door'), 0, 1.55, 3.56);
  const doorWin = box(g, 0.5, 0.36, 0.05, glow, 0, 2.25, 3.63);
  doorWin.castShadow = false;
  box(g, 0.09, 0.09, 0.07, emat(COLORS.gold, 0xc79a1e, 0.3), 0.38, 1.5, 3.63);

  // Hanging porch lantern: bracket chain + glowing body (with a cap top).
  box(g, 0.04, 0.3, 0.04, mat(0x3b3b42), 1.0, 2.6, 3.7);
  const lantern = box(g, 0.2, 0.3, 0.16, emat(0xffd98c, 0xffa040, 1.0), 1.0, 2.32, 3.7);
  lantern.castShadow = false;

  // Porch: floor + two steps centered on the door (x=0).
  box(g, 7.2, 0.3, 2.6, wood, 0, 0.3, 4.7);
  box(g, 2.2, 0.18, 0.5, wood, 0, 0.3, 6.15);                          // step 1 (centered)
  box(g, 2.2, 0.18, 0.5, wood, 0, 0.13, 6.6);                          // step 2 (centered)

  // Porch roof first (so we can land the posts exactly on its underside).
  // Roof underside at the post line (z=5.7) ≈ y 2.65 with the slight tilt.
  const proof = box(g, 7.8, 0.16, 3.0, roof, 0, 2.78, 4.7);
  proof.rotation.x = 0.1;

  // Four turned posts reaching from the porch floor UP to the roof.
  for (const x of [-3.3, -1.15, 1.15, 3.3]) {
    box(g, 0.26, 0.2, 0.26, white, x, 0.55, 5.7);                      // base block
    box(g, 0.15, 2.05, 0.15, white, x, 1.62, 5.7);                     // shaft (to roof)
    box(g, 0.24, 0.14, 0.24, white, x, 2.66, 5.7);                     // capital under roof
  }

  // Railing with balusters (gap at the door for the gate).
  for (const s of [-1, 1]) {
    box(g, 2.7, 0.1, 0.1, white, s * 2.1, 1.05, 5.72);                // top rail
    for (const x of [-3.0, -2.2, -1.4, 1.4, 2.2, 3.0]) {
      if (Math.sign(x) === s) box(g, 0.07, 0.5, 0.07, white, x, 0.78, 5.72);
    }
    box(g, 0.1, 0.1, 2.2, white, s * 3.45, 1.05, 4.75);                // side rails
  }
  // Little porch-rail gate across the step opening (top + bottom rail + 2 bars).
  box(g, 1.5, 0.09, 0.08, woodD, 0, 0.95, 5.74);                      // gate top rail
  box(g, 1.5, 0.08, 0.07, woodD, 0, 0.55, 5.74);                      // gate bottom rail
  for (const x of [-0.4, 0.4]) box(g, 0.06, 0.42, 0.06, woodD, x, 0.74, 5.74);

  // A little porch bench by the window.
  box(g, 1.5, 0.1, 0.45, woodD, -2.3, 0.85, 4.35);
  box(g, 1.5, 0.5, 0.1, woodD, -2.3, 1.2, 4.14);

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
  // Evenly spaced hoop bands.
  for (const y of [2, 4, 6, 8]) {
    add(g, cylGeo(2.56, 2.56, 0.16, 12), band, 0, y, 0);
  }
  // Vertical seam ribs (panel joints) around the body.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI2;
    const seam = box(g, 0.1, 9.8, 0.1, band, Math.cos(a) * 2.5, 5, Math.sin(a) * 2.5);
    seam.rotation.y = -a;
  }
  // Eave ring where the cap lands, then a domed cap that sits flush.
  add(g, cylGeo(2.6, 2.6, 0.22, 12), band, 0, 10, 0);
  const cap = add(g, domeGeo(2.5, 12, 6), mat(COLORS.ufoBody, true), 0, 10.05, 0);
  cap.scale.set(1, 0.82, 1);
  // Top vent: collar + little cone hat, flush on the dome.
  add(g, cylGeo(0.3, 0.3, 0.5, 6), band, 0, 11.95, 0);
  add(g, coneGeo(0.46, 0.42, 6), mat(0x78909c, true), 0, 12.4, 0);
  // Ladder up the front with a safety hoop near the top.
  for (const s of [-1, 1]) {
    box(g, 0.07, 9.2, 0.07, mat(0x6f7d92), s * 0.32, 4.7, 2.48);
  }
  for (let i = 0; i < 8; i++) {
    box(g, 0.7, 0.06, 0.06, mat(0x6f7d92), 0, 1.1 + i * 1.1, 2.48);
  }
  const hoop = add(g, torusGeo(0.5, 0.04, 5, 10), mat(0x6f7d92, true), 0, 8.6, 2.5);
  hoop.rotation.x = Math.PI / 2;
  // Hatch door at the base + filler chute on the barn side (-X face,
  // angling down toward the neighbouring barn).
  box(g, 0.9, 1.3, 0.15, mat(0x55606a), 0, 0.7, 2.42);
  const chute = box(g, 0.55, 3.4, 0.5, mat(0x8794a1, false, 'metal'), -2.55, 4.2, 0);
  chute.rotation.z = 0.18;
  box(g, 0.7, 0.5, 0.6, band, -2.75, 2.5, 0);                         // chute outlet hopper
  return g;
}

/* ------------------------------------------------------------------ *
 *  createWindmill — ~11 tall lattice tower (truncated pyramid).
 *  userData: { blades }
 *  Right-side-up: 4 legs sit on a WIDE square (half-width B=1.5) at the
 *  ground and lean INWARD as they rise to a SMALL top square (half-width
 *  T=0.45) at H=8. Girdles + X-braces are computed from hw(y) so every
 *  endpoint lands on a leg. Platform + gear head + roof + tail vane sit
 *  ON TOP; the 6-sail blade wheel hangs at the front of the hub.
 *  blades Group sits at the hub; spin with blades.rotation.z.
 * ------------------------------------------------------------------ */

export function createWindmill() {
  const g = new THREE.Group();
  const steel = mat(0x8e9aa6);
  const light = mat(0xd7dee6);

  // --- Tower geometry: wide base, narrow top (truncated pyramid). ---
  const B = 1.5;          // base half-width (footprint at y=0)
  const T = 0.45;         // top half-width (at the platform)
  const H = 8.0;          // tower height to the platform underside
  // Half-width of the square cross-section at any height y.
  const hw = (y) => B + (T - B) * (y / H);          // hw(0)=1.5, hw(8)=0.45
  // Inward lean angle of each leg from vertical.
  const theta = Math.atan((B - T) / H);             // ≈ atan(1.05/8) = 0.1305
  const legLen = Math.hypot(H, B - T) + 0.2;        // full leg incl. ground stub

  // Four legs. Each pivots about its own center; +Y tilts inward toward
  // the axis. rotation.z = sx*theta drops the top toward -sx (inward);
  // rotation.x = -sz*theta drops the top toward -sz (inward).
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = sx * (B + T) / 2;                     // x of leg mid-height
    const cz = sz * (B + T) / 2;
    const leg = box(g, 0.2, legLen, 0.2, steel, cx, H / 2, cz);
    leg.rotation.order = 'ZXY';
    leg.rotation.z = sx * theta;
    leg.rotation.x = -sz * theta;
  }

  // --- Horizontal girdles at 3 heights; each ring's half-width is hw(y)
  //     so the rails actually touch the legs at that height. ---
  const girderY = [1.4, 3.9, 6.4];
  for (const y of girderY) {
    const w = hw(y);
    const span = 2 * w + 0.2;
    box(g, span, 0.1, 0.1, steel, 0, y, w);          // +Z rail
    box(g, span, 0.1, 0.1, steel, 0, y, -w);         // -Z rail
    box(g, 0.1, 0.1, span, steel, w, y, 0);          // +X rail
    box(g, 0.1, 0.1, span, steel, -w, y, 0);         // -X rail
  }

  // --- Single diagonal brace per face, per bay, alternating direction
  //     bay-to-bay so the four faces read as a continuous zig-zag lattice
  //     whose endpoints land on the legs. (8 braces total.) ---
  const bays = [[girderY[0], girderY[1]], [girderY[1], girderY[2]]];
  bays.forEach(([y0, y1], bi) => {
    const ym = (y0 + y1) / 2;
    const wm = hw(ym);
    const dy = y1 - y0;
    const run = 2 * wm;                              // full face width at mid
    const len = Math.hypot(dy, run);                 // diagonal length
    const tilt = Math.atan2(run, dy);                // from vertical
    const d = bi % 2 ? 1 : -1;                       // alternate lean per bay
    for (const sz of [1, -1]) {                      // +Z / -Z faces
      const br = box(g, 0.07, len, 0.07, steel, 0, ym, sz * wm);
      br.rotation.z = d * tilt;
    }
    for (const sx of [1, -1]) {                      // +X / -X faces
      const br = box(g, 0.07, len, 0.07, steel, sx * wm, ym, 0);
      br.rotation.x = d * tilt;
    }
  });

  // --- Ladder up the +Z face, hugging the inward-leaning leg line. ---
  for (let i = 0; i <= 6; i++) {
    const y = 0.6 + i * 1.1;
    const w = hw(y) - 0.06;
    box(g, 0.46, 0.05, 0.05, light, 0, y, w + 0.12);     // rung
  }
  // Two ladder stiles following the taper (slightly tilted inward).
  for (const s of [-1, 1]) {
    const st = box(g, 0.05, 7.0, 0.05, light, s * 0.22, 3.6, hw(3.6) + 0.14);
    st.rotation.x = -theta * 0.7;
  }

  // --- Platform + gear head + roof on TOP. ---
  box(g, 1.7, 0.18, 1.7, mat(COLORS.wood, false, 'planks'), 0, H + 0.09, 0);
  box(g, 0.8, 0.85, 1.1, steel, 0, H + 0.62, 0);       // gear-head housing
  for (const s of [-1, 1]) {                            // pitched roof halves
    const slab = box(g, 0.62, 0.12, 1.2, light, s * 0.24, H + 1.12, 0);
    slab.rotation.z = -s * 0.5;
  }
  box(g, 0.14, 0.18, 1.24, mat(0x55606a), 0, H + 1.32, 0);   // ridge cap

  // --- Tail boom + red vane behind the gear head. ---
  box(g, 0.09, 0.09, 1.5, steel, 0, H + 0.62, -1.15);
  box(g, 0.06, 0.78, 0.95, mat(0xe05348), 0, H + 0.7, -1.85);

  // --- Blade wheel at the FRONT of the hub: 6 sails, spar + frame + cloth.
  const hubZ = 0.72;
  const blades = pivot(g, 0, H + 0.62, hubZ);
  add(blades, cylZGeo(0.2, 0.34, 8), mat(0x55606a, true), 0, 0, 0);   // hub
  for (let i = 0; i < 6; i++) {
    const sail = pivot(blades, 0, 0, 0);
    sail.rotation.z = (i / 6) * PI2;
    box(sail, 0.09, 2.2, 0.06, steel, 0, 1.1, 0);                     // spar
    box(sail, 0.52, 0.07, 0.06, steel, 0, 2.05, 0.04);               // outer frame bar
    const cloth = box(sail, 0.46, 1.55, 0.04, light, 0.06, 1.2, 0.07);
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

  // Solid stone drum (guarantees a closed ring) + capstone + water.
  add(g, cylGeo(0.9, 0.96, 0.86, 12), mat(0x8c8c8c, false, 'stone'), 0, 0.43, 0);
  add(g, cylGeo(0.94, 0.94, 0.12, 12), mat(0xb4b4b4, true), 0, 0.92, 0);   // capstone rim
  const water = add(g, cylGeo(0.66, 0.66, 0.06, 12), mat(COLORS.waterDeep, true), 0, 0.62, 0);
  water.castShadow = false;
  // One course of stone blocks proud of the drum — 10 blocks overlap to
  // form a clean CLOSED ring (arc per block ≈ 0.52 < block width 0.58).
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI2;
    const s = box(g, 0.58, 0.7, 0.22, i % 2 ? mat(COLORS.stone) : mat(0xb4b4b4),
      Math.cos(a) * 0.88, 0.45, Math.sin(a) * 0.88);
    s.rotation.y = -a + Math.PI / 2;
  }

  // Symmetric wooden A-frame: two posts + two mirrored diagonal braces.
  for (const s of [-1, 1]) {
    box(g, 0.15, 1.6, 0.15, mat(COLORS.woodDark), s * 0.85, 1.35, 0);
    const brace = box(g, 0.1, 0.75, 0.1, mat(COLORS.wood), s * 0.7, 0.95, 0.32);
    brace.rotation.x = -0.5;
    const brace2 = box(g, 0.1, 0.75, 0.1, mat(COLORS.wood), s * 0.7, 0.95, -0.32);
    brace2.rotation.x = 0.5;                                           // mirror (symmetric)
  }
  // Shingled mini-roof CENTERED over the well (ridge at x=0), + ridge cap.
  for (const s of [-1, 1]) {
    const slab = box(g, 2.3, 0.1, 1.05, mat(COLORS.roof, false, 'shingles'), 0, 2.32, s * 0.4);
    slab.rotation.x = s * 0.55;
  }
  box(g, 2.4, 0.14, 0.22, mat(0x553b32), 0, 2.58, 0);

  // Crank: axle at y=1.62, wound rope coil, crank arm + handle.
  add(g, cylXGeo(0.07, 1.9, 6), mat(COLORS.woodDark), 0, 1.62, 0);
  add(g, cylXGeo(0.12, 0.5, 6), rope, -0.1, 1.62, 0);                  // rope coil on axle
  box(g, 0.07, 0.3, 0.07, mat(COLORS.woodDark), 0.99, 1.5, 0);         // crank arm
  box(g, 0.07, 0.07, 0.3, mat(0x4e342e), 0.99, 1.36, 0.12);            // crank handle
  // Rope hangs FROM the axle (y=1.62) DOWN to the bucket (top y≈1.05):
  // span 1.05→1.62 = 0.57, centered at 1.335.
  box(g, 0.05, 0.57, 0.05, rope, 0.1, 1.335, 0);
  box(g, 0.3, 0.26, 0.3, mat(COLORS.wood), 0.1, 0.92, 0);              // bucket body
  box(g, 0.34, 0.06, 0.34, mat(0x55606a), 0.1, 1.05, 0);              // bucket steel rim
  const handle = add(g, torusGeo(0.16, 0.02, 4, 8), mat(0x55606a, true), 0.1, 1.08, 0);
  handle.rotation.x = Math.PI / 2;                                     // bucket bail handle
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
  // Straw hat: wider floppy brim (two tones) + crown + hat band.
  box(g, 0.74, 0.05, 0.68, straw, 0, 2.23, 0);                        // broad brim
  const brimTip = box(g, 0.3, 0.05, 0.2, mat(0xcaa84e), 0, 2.21, 0.36);
  brimTip.rotation.x = -0.2;                                          // drooping front brim
  box(g, 0.34, 0.2, 0.32, straw, 0, 2.36, 0);                         // crown
  box(g, 0.36, 0.06, 0.34, mat(0x8a6d2e), 0, 2.3, 0);                 // hat band
  // A cheeky crow perched on the arm, now with a second tail feather.
  box(g, 0.14, 0.13, 0.2, mat(0x1c1c22), 0.62, 1.82, -0.05);          // body
  box(g, 0.1, 0.1, 0.09, mat(0x1c1c22), 0.62, 1.93, 0.05);           // head
  box(g, 0.04, 0.04, 0.07, mat(0xffa726), 0.62, 1.92, 0.12);         // beak
  const crowTail = box(g, 0.05, 0.04, 0.12, mat(0x1c1c22), 0.62, 1.86, -0.18);
  crowTail.rotation.x = -0.4;                                         // tail feather 1
  const crowTail2 = box(g, 0.05, 0.04, 0.1, mat(0x2b2b33), 0.66, 1.84, -0.17);
  crowTail2.rotation.set(-0.4, 0.3, 0);                               // tail feather 2
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
  // Roll-over protection bar (ROPS) behind the seat.
  for (const s of [-1, 1]) box(g, 0.08, 1.0, 0.08, dark, s * 0.32, 2.05, -1.06);
  box(g, 0.72, 0.08, 0.08, dark, 0, 2.5, -1.06);                      // roll-bar top
  // Pedals on the floor in front of the seat.
  box(g, 0.12, 0.04, 0.12, mat(0x55606a), -0.16, 1.06, -0.28);
  box(g, 0.12, 0.04, 0.12, mat(0x55606a), 0.16, 1.06, -0.28);
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
 *  createFenceSection — posts + three rails, height ~1.1. Runs along +X
 *  from the origin (x in [0, length]). TILES SEAMLESSLY: a post sits at
 *  local x=0 (start) but NOT at x=length, so a section at offset X and
 *  the next at X+length share the boundary post position with no double
 *  post and no gap. Rails span the FULL length (0 → length) so there is
 *  no hole. e.g. length=8 → posts at world x 0,2,4,6 then next section
 *  8,10,12,14: clean spacing of 2 across the seam, no overlap.
 * ------------------------------------------------------------------ */

export function createFenceSection(length = 8) {
  const g = new THREE.Group();
  const postM = mat(COLORS.woodDark);
  const railM = mat(COLORS.wood);

  // Even spacing that divides length so the gap from the last interior
  // post to the next section's start post equals the interior spacing.
  const bays = Math.max(1, Math.round(length / 2));
  const spacing = length / bays;
  // Posts at x = 0, spacing, 2*spacing, ... up to (but NOT including) length.
  for (let i = 0; i < bays; i++) {
    const x = i * spacing;
    box(g, 0.18, 1.1, 0.18, postM, x, 0.55, 0);
    box(g, 0.24, 0.09, 0.24, postM, x, 1.14, 0);                      // beveled cap
  }

  // Three rails spanning the FULL length (centered, so they reach x=length).
  box(g, length, 0.13, 0.08, railM, length / 2, 0.95, 0.1);          // top rail
  box(g, length, 0.12, 0.08, railM, length / 2, 0.62, 0.1);          // mid rail
  const low = box(g, length, 0.12, 0.08, railM, length / 2, 0.3, 0.1);
  low.rotation.z = 0.012;                                            // faint sag
  // A couple of knot dots on the rails for grain.
  box(g, 0.05, 0.07, 0.04, postM, length * 0.3, 0.96, 0.15);
  box(g, 0.05, 0.06, 0.04, postM, length * 0.72, 0.63, 0.15);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBridge — COMPLETE flat-deck crossing. Deck spans local x in
 *  [0, length], centered on z, base near y=0 (world places it bank to
 *  bank). A continuous solid deck base + overlapping planks (no holes),
 *  ramp lips at BOTH ends, full-length railings (top rail + posts + kick
 *  rail) on BOTH sides, and trestle pylons descending to y≈-2.5 at 4
 *  points so it visibly stands in the river.
 * ------------------------------------------------------------------ */

export function createBridge(length = 14, width = 4) {
  const g = new THREE.Group();
  const deckY = 0.5;                       // flat deck top surface height
  const hw = width / 2;
  const woodD = mat(COLORS.woodDark);
  const beam = mat(0x4a3327);
  const jr = makeRng(91);                  // deterministic plank jitter

  // --- Continuous solid deck base (guarantees NO see-through holes). ---
  box(g, length, 0.18, width, beam, length / 2, deckY - 0.09, 0);

  // --- Overlapping cross-planks laid edge to edge over the base. Each
  //     plank is wider than its step so they always visually overlap. ---
  const n = Math.max(8, Math.round(length / 0.62));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * step;
    const plank = box(g, step + 0.06, 0.12, width - 0.08,
      i % 2 ? mat(0x99756a) : mat(COLORS.wood),
      x, deckY + 0.02 + (jr() - 0.5) * 0.02, 0);
    plank.rotation.z = (jr() - 0.5) * 0.012;        // faint hand-laid jitter
  }

  // --- Ramp lips at BOTH ends so the deck meets the banks flush. ---
  for (const ex of [0, length]) {
    const dir = ex === 0 ? 1 : -1;                  // ramp slopes down to bank
    const lip = box(g, 1.1, 0.16, width, mat(COLORS.wood),
      ex + dir * 0.45, deckY - 0.12, 0);
    lip.rotation.z = dir * 0.22;
  }

  // --- Side stringer beams running the full length under the deck. ---
  for (const s of [-1, 1]) {
    box(g, length, 0.26, 0.26, woodD, length / 2, deckY - 0.24, s * (hw - 0.22));
  }

  // --- Trestle pylons at 4 stations descending well below the deck. ---
  const stations = [length * 0.12, length * 0.38, length * 0.62, length * 0.88];
  for (const px of stations) {
    for (const s of [-1, 1]) {
      const sx = s * (hw - 0.3);
      box(g, 0.28, 3.0, 0.28, woodD, px, deckY - 0.18 - 1.5, sx);   // post to y≈-2.5
    }
    // Cross brace tying the two posts together below the deck.
    box(g, 0.2, 0.2, width - 0.4, woodD, px, deckY - 1.6, 0);
    // Diagonal kicker for that built look.
    const kick = box(g, 0.18, 1.8, 0.18, beam, px, deckY - 1.0, 0);
    kick.rotation.x = 0.5;
  }

  // --- Full-length railings on BOTH sides: top rail + kick rail + posts. ---
  const railY = deckY + 0.78;
  const kickY = deckY + 0.32;
  for (const s of [-1, 1]) {
    const rz = s * (hw - 0.12);
    box(g, length, 0.1, 0.1, mat(COLORS.wood), length / 2, railY, rz);   // top rail
    box(g, length, 0.08, 0.08, woodD, length / 2, kickY, rz);            // kick rail
    for (let x = 0; x <= length + 0.01; x += 2) {                        // posts every 2
      box(g, 0.14, 0.95, 0.14, woodD, Math.min(x, length), deckY + 0.42, rz);
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
  // SQUARE pophole door: white frame + dark opening + a little threshold.
  box(g, 0.62, 0.74, 0.08, trim, -0.6, 0.85, 1.1);                    // frame
  box(g, 0.44, 0.58, 0.08, mat(0x3a2a22), -0.6, 0.85, 1.13);          // dark opening
  box(g, 0.5, 0.06, 0.14, trim, -0.6, 0.52, 1.13);                    // threshold/sill
  // Tiny ventilation window (slatted) high on the front.
  box(g, 0.5, 0.4, 0.1, trim, 0.75, 1.55, 1.1);
  box(g, 0.36, 0.07, 0.12, mat(0x3a2a22), 0.75, 1.64, 1.12);
  box(g, 0.36, 0.07, 0.12, mat(0x3a2a22), 0.75, 1.52, 1.12);
  box(g, 0.36, 0.07, 0.12, mat(0x3a2a22), 0.75, 1.4, 1.12);
  // Ramp with cleats: starts at the pophole sill (y≈0.55, z=1.13) and
  // runs down to meet the GROUND (y=0). Drop 0.55 over a 1.5 board with
  // rotation.x=0.38 → board far end y = 0.55 - 1.5*sin(0.38) ≈ 0.0.
  const ramp = pivot(g, -0.6, 0.55, 1.13);
  ramp.rotation.x = 0.38;
  box(ramp, 0.55, 0.07, 1.5, mat(COLORS.wood), 0, 0, 0.78);
  for (const z of [0.4, 0.82, 1.24]) {
    box(ramp, 0.55, 0.06, 0.09, mat(COLORS.woodDark), 0, 0.06, z);
  }
  for (const s of [-1, 1]) box(ramp, 0.05, 0.1, 1.5, mat(COLORS.woodDark), s * 0.27, 0.02, 0.78); // ramp edge rails
  // Side nesting-box bump, flush against the -X wall (wall face at x=-1.5).
  box(g, 0.7, 0.7, 1.0, red, -1.83, 1.05, -0.3);                      // box (inner edge at x=-1.48)
  const lid = box(g, 0.85, 0.08, 1.12, trim, -1.86, 1.45, -0.3);     // slanted lid
  lid.rotation.z = 0.2;
  box(g, 0.72, 0.34, 0.05, mat(0x3a2a22), -2.19, 1.0, -0.3);         // egg-access flap
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
  box(g, 0.18, 0.12, 0.18, mat(0x2c2c33), 0, 0.28, 0);                // base collar
  box(g, 0.16, 2.7, 0.16, mat(COLORS.woodDark), 0, 1.45, 0);
  // Decorative cross-bar near the top + a finial cap on the post.
  box(g, 0.6, 0.07, 0.07, dark, 0, 2.62, 0);                          // cross-bar
  box(g, 0.12, 0.1, 0.12, dark, 0, 2.88, 0);                          // post finial base
  add(g, coneGeo(0.1, 0.16, 6), dark, 0, 3.02, 0);                    // finial spike
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
  box(g, 0.36, 0.04, 0.62, mat(0x32599e), 0, 1.0, 0);                 // seam line under lid
  // Flag UP, on a little pivot mount bolted to the box side.
  box(g, 0.05, 0.07, 0.07, mat(0xd9d9d9), 0.19, 1.18, -0.1);          // flag pivot mount
  box(g, 0.03, 0.32, 0.04, mat(0xe53935), 0.21, 1.36, -0.1);          // flag pole
  box(g, 0.03, 0.13, 0.16, mat(0xe53935), 0.21, 1.49, -0.02);         // flag
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
  box(g, 1.8, 0.42, 0.12, paint, 0, 1.22, -1.94);                    // tailgate
  box(g, 1.7, 0.05, 0.06, paintD, 0, 1.32, -2.0);                    // tailgate seam line
  box(g, 0.18, 0.05, 0.05, gray, 0, 1.12, -2.01);                    // tailgate latch
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

/* ------------------------------------------------------------------ *
 *  createWaterMill — ~3 wide x ~3.5 tall stone/plank mill house with a
 *  big vertical water wheel on the -X side. Front faces +Z.
 *  userData: { wheel } — a pivot Group centered on the wheel's axle;
 *  spin it with wheel.rotation.x. The wheel is a hub + 8 spokes + outer
 *  rim (8 arc segments) + 8 paddle boards. A plank sluice/chute pours
 *  over the top of the wheel. ≤ ~45 meshes.
 * ------------------------------------------------------------------ */

export function createWaterMill() {
  const g = new THREE.Group();
  const stone = mat(COLORS.stone, false, 'stone');
  const plank = mat(COLORS.wood, false, 'planks');
  const woodD = mat(COLORS.woodDark);
  const roof = mat(COLORS.roof, false, 'shingles');
  const trim = mat(COLORS.barnTrim);

  // Stone base + plank upper storey, ridge along Z so the wheel clears it.
  box(g, 2.6, 1.4, 2.6, stone, 0, 0.7, 0);                  // stone ground floor
  box(g, 2.4, 1.1, 2.4, plank, 0, 1.95, 0);                 // plank upper storey
  box(g, 2.0, 0.6, 2.4, plank, 0, 2.75, 0);                 // gable fill (to ridge)

  // Pitched shingle roof, ridge along Z at y≈3.4. Slope run 1.2, rise 0.9.
  for (const s of [-1, 1]) {
    const slab = box(g, 1.7, 0.14, 2.7, roof, s * 0.7, 2.95, 0);
    slab.rotation.z = -s * 0.64;
  }
  box(g, 0.3, 0.16, 2.8, mat(0x553b32), 0, 3.42, 0);        // ridge cap

  // Door on the +Z face + a small shuttered window beside it.
  box(g, 0.62, 1.2, 0.1, woodD, 0.5, 0.6, 1.31);            // door panel
  box(g, 0.66, 0.08, 0.12, trim, 0.5, 1.18, 1.33);          // door lintel
  box(g, 0.06, 0.06, 0.04, mat(0xd9d9d9), 0.7, 0.6, 1.37);  // door knob
  box(g, 0.5, 0.5, 0.1, trim, -0.55, 0.8, 1.31);            // window frame
  box(g, 0.36, 0.36, 0.06, emat(0xffd98c, 0xff9d3c, 0.7), -0.55, 0.8, 1.35); // warm pane
  box(g, 0.36, 0.07, 0.07, woodD, -0.55, 0.8, 1.38);        // window mullion H

  // Wheel axle support beams jutting from the -X wall.
  for (const sz of [-1, 1]) {
    box(g, 0.6, 0.16, 0.16, woodD, -1.55, 1.5, sz * 0.55);
  }

  // ---- The water wheel — a pivot Group on the axle (x = -1.85, y = 1.5).
  //      Spin with wheel.rotation.x. Built in the wheel's local Y-Z plane.
  const wheel = pivot(g, -1.85, 1.5, 0);
  const R = 1.15;                                            // outer radius
  const wgrey = mat(0x6f5a47);
  // Axle through the hub (axis along X) + hub disc.
  add(wheel, cylXGeo(0.12, 0.7, 8), mat(0x4a3a30, true), 0, 0, 0);
  add(wheel, cylXGeo(0.28, 0.32, 8), wgrey, 0, 0, 0);       // hub
  // 8 spokes radiating out in the Y-Z plane.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2;
    const spoke = box(wheel, 0.16, R, 0.1, woodD, 0, Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
    spoke.rotation.x = -a;
  }
  // Outer rim: 8 arc segments forming the wheel ring.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2 + Math.PI / 8;
    const seg = box(wheel, 0.16, 0.16, 0.96, wgrey, 0, Math.cos(a) * R, Math.sin(a) * R);
    seg.rotation.x = -a;
  }
  // 8 paddle boards on the rim (slightly proud, catch the water).
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI2;
    const paddle = box(wheel, 0.8, 0.06, 0.34, plank, 0, Math.cos(a) * (R + 0.04), Math.sin(a) * (R + 0.04));
    paddle.rotation.x = -a;
  }

  // ---- Wooden sluice / chute pouring over the TOP of the wheel.
  const chute = box(g, 0.7, 0.12, 1.3, plank, -1.85, 2.85, 0.4);
  chute.rotation.x = 0.4;                                    // sloped down toward the wheel
  for (const sz of [-1, 1]) {                                // chute side boards
    const side = box(g, 0.06, 0.3, 1.3, woodD, -1.85, 2.95, 0.4);
    side.position.x = -1.85 + sz * 0.34;
    side.rotation.x = 0.4;
  }
  box(g, 0.66, 0.2, 0.3, woodD, -1.85, 2.45, -0.2);         // chute spout over the wheel top

  g.userData = { wheel };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createDock — wooden jetty/pier ~6 long (+X) x ~2 wide. Plank deck at
 *  y≈0.6 on 6 piling posts that descend to y≈-2 (so it stands in water).
 *  Side posts carry a rope rail; a fat mooring post stands at the far end.
 *  ≤ ~30 meshes.
 * ------------------------------------------------------------------ */

export function createDock() {
  const g = new THREE.Group();
  const plank = mat(COLORS.wood, false, 'planks');
  const woodD = mat(COLORS.woodDark);
  const post = mat(0x4a3327);
  const rope = mat(0x9c7a4f);
  const deckY = 0.6;
  const len = 6, wid = 2, hw = wid / 2;

  // Six pilings (two rows of three) descending below the waterline.
  const pileX = [0.5, len / 2, len - 0.5];
  for (const px of pileX) {
    for (const s of [-1, 1]) {
      box(g, 0.24, 2.7, 0.24, post, px, deckY - 1.35, s * (hw - 0.25));
    }
  }

  // Solid deck base + lengthwise stringer beams under the planks.
  box(g, len, 0.16, wid, woodD, len / 2, deckY - 0.08, 0);
  for (const s of [-1, 1]) {
    box(g, len, 0.18, 0.18, woodD, len / 2, deckY - 0.16, s * (hw - 0.22));
  }
  // Cross-plank deck boards laid edge to edge along the length.
  const n = 9, step = len / n;
  for (let i = 0; i < n; i++) {
    box(g, step + 0.04, 0.1, wid - 0.06, i % 2 ? plank : mat(0x99756a),
      (i + 0.5) * step, deckY + 0.03, 0);
  }

  // Rail posts down both sides + a top rope rail strung between them.
  const railPostX = [0.5, len / 2, len - 0.5];
  for (const s of [-1, 1]) {
    const rz = s * (hw - 0.18);
    for (const px of railPostX) {
      box(g, 0.1, 0.85, 0.1, woodD, px, deckY + 0.42, rz);
    }
    // Rope rail (two slack spans, faint sag).
    const rA = box(g, len / 2, 0.06, 0.06, rope, len * 0.25, deckY + 0.72, rz);
    rA.rotation.z = -0.04;
    const rB = box(g, len / 2, 0.06, 0.06, rope, len * 0.75, deckY + 0.72, rz);
    rB.rotation.z = 0.04;
  }

  // Fat mooring post at the far end with a coiled rope ring.
  box(g, 0.3, 1.3, 0.3, post, len - 0.5, deckY + 0.55, 0);
  const ring = add(g, torusGeo(0.16, 0.04, 5, 10), rope, len - 0.5, deckY + 0.95, 0.16);
  ring.rotation.x = Math.PI / 2;

  g.userData = {};
  return g;
}

/* ------------------------------------------------------------------ *
 *  createLog — a single floating tree log ~2.6 long lying along +X,
 *  ~0.45 diameter. Centered at the waterline (origin near y=0 so the log
 *  floats half-submerged). Brown bark, darker end-rings, a knot/branch
 *  stub and a patch of moss. ≤ ~10 meshes.
 * ------------------------------------------------------------------ */

export function createLog() {
  const g = new THREE.Group();
  const bark = mat(0x6d4c41, true);
  const ring = mat(0x4a3327, true);
  const moss = mat(0x6aa84f);
  const r = 0.225;

  // Main log barrel lying along X, centered on the waterline.
  add(g, cylXGeo(r, 2.6, 10), bark, 0, 0.04, 0);
  // Darker end-ring caps at both ends.
  for (const s of [-1, 1]) {
    add(g, cylXGeo(r * 0.98, 0.1, 10), ring, s * 1.3, 0.04, 0);
  }
  // A broken branch stub angling up off the side.
  const stub = add(g, cylXGeo(0.09, 0.5, 6), bark, 0.45, 0.18, 0.12);
  stub.rotation.z = -0.7;
  add(g, cylXGeo(0.092, 0.07, 6), ring, 0.6, 0.36, 0.12);   // stub end-ring
  // A small knot on the bark + a moss patch on top.
  box(g, 0.1, 0.1, 0.08, ring, -0.5, 0.18, 0.14);           // knot
  const patch = box(g, 0.7, 0.05, 0.26, moss, 0.1, 0.24, -0.02);
  patch.castShadow = false;

  return g;
}

/* ------------------------------------------------------------------ *
 *  createStable — horse stable / barn, ~6 wide. Front gable faces +Z.
 *  Plank-textured walls + a single TRIANGULAR-PRISM gable mass (same
 *  technique as createBarn / createFarmhouse) so the shingle roof slabs
 *  sit FLUSH on the gable faces with no rectangular block poking out.
 *  Two Dutch half-doors (the top halves swung open), a small fenced
 *  paddock hint to one side, two hay bales, and a horseshoe over the
 *  door for luck. Bottom-center origin. ≤ ~70 meshes.
 * ------------------------------------------------------------------ */

export function createStable() {
  const g = new THREE.Group();
  const wall = mat(COLORS.wood, false, 'planks');          // warm timber plank walls
  const trim = mat(COLORS.barnTrim);
  const roof = mat(COLORS.roof, false, 'shingles');
  const woodD = mat(COLORS.woodDark);
  const dark = mat(0x2a1f18);

  // Stone footing strip under the walls.
  box(g, 6.3, 0.4, 5.3, mat(COLORS.stone, false, 'stone'), 0, 0.2, 0);

  // Main wall box + a single gable prism. Eaves at (z=±2.5, y=3.0), ridge
  // at (z=0, y=4.4). The prism's two faces lie flush under the roof slabs;
  // its end caps form the clean front/back gable triangles. Length inset
  // to 5.92 to avoid z-fighting the front/back wall planes.
  box(g, 6, 2.6, 5, wall, 0, 1.5, 0);                       // walls (eave at 2.8)
  add(g, prismXGeo([[2.8, -2.46], [2.8, 2.46], [4.4, 0]], 5.92), wall, 0, 0, 0);

  // Gable roof: ridge along X at y=4.4, eaves at (z=±2.5, y=2.8). Slope run
  // 2.5, rise 1.6 → angle atan(1.6/2.5)=0.569. Slabs sized for an even
  // overhang on all four edges; matching ridge cap on top.
  const rAng = Math.atan2(1.6, 2.5);                        // ≈ 0.569
  const slabLen = Math.hypot(2.5, 1.6) + 0.5;               // slope length + overhang
  for (const s of [-1, 1]) {
    const slab = box(g, 6.7, 0.18, slabLen, roof, 0, 3.6, s * 1.25);
    slab.rotation.x = s * rAng;
  }
  box(g, 6.8, 0.26, 0.5, mat(0x553b32), 0, 4.46, 0);        // ridge cap

  // White corner boards + eave bands.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(g, 0.28, 2.6, 0.28, trim, sx * 2.98, 1.5, sz * 2.48);
    }
  }
  box(g, 6.4, 0.22, 0.22, trim, 0, 2.82, 2.52);             // eave band (front)
  box(g, 6.4, 0.22, 0.22, trim, 0, 2.82, -2.52);            // eave band (back)

  // ---- Two Dutch half-doors on the +Z face (top halves swung outward).
  // Each opening is 1.4 wide; doorways centered at x = ±1.0.
  for (const dx of [-1.0, 1.0]) {
    // Door frame + dark stall interior behind it.
    box(g, 1.6, 2.3, 0.14, trim, dx, 1.2, 2.5);             // frame
    box(g, 1.4, 2.1, 0.1, dark, dx, 1.2, 2.52);             // dark stall opening
    // Bottom half-door (closed): a plank panel with a Z-brace + iron strap.
    box(g, 1.34, 1.0, 0.1, mat(COLORS.woodDark, false, 'door'), dx, 0.65, 2.56);
    box(g, 1.3, 0.1, 0.06, woodD, dx, 1.08, 2.62);          // top rail
    const brace = box(g, 0.12, 1.3, 0.05, woodD, dx, 0.65, 2.63);
    brace.rotation.z = 0.62;                                // diagonal Z-brace
    box(g, 0.16, 0.1, 0.06, mat(0x37474f), dx + 0.5, 0.65, 2.63); // latch
    // Top half-door swung OPEN (hinged on the outer edge, angled outward).
    const hinge = dx < 0 ? -1 : 1;
    const topDoor = pivot(g, dx + hinge * 0.67, 1.75, 2.55);
    topDoor.rotation.y = hinge * 1.0;                        // swung open
    box(topDoor, 1.34, 1.0, 0.1, mat(COLORS.woodDark, false, 'door'), -hinge * 0.67, 0, 0.04);
    const tbr = box(topDoor, 0.12, 1.3, 0.05, woodD, -hinge * 0.67, 0, 0.1);
    tbr.rotation.z = 0.62;
  }

  // ---- Horseshoe over the doors (open end UP for luck): a U of short iron
  //      bar segments swept around the lower arc, with a couple of nail dots.
  const iron = mat(0x9aa0a6, true);
  const nail = mat(0x3a3a3a);
  const shoeY = 2.55, shoeR = 0.3;
  // Sweep from ~200° round the bottom to ~340° (the open ends point UP).
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 1.12 + (i / 6) * Math.PI * 0.76;
    const seg = box(g, 0.12, 0.16, 0.05, iron, Math.cos(a) * shoeR, shoeY + Math.sin(a) * shoeR, 2.58);
    seg.rotation.z = a + Math.PI / 2;                       // align the bar to the arc
  }
  box(g, 0.05, 0.05, 0.03, nail, -0.18, shoeY - 0.12, 2.61); // nail dots
  box(g, 0.05, 0.05, 0.03, nail, 0.18, shoeY - 0.12, 2.61);

  // ---- Hayloft vent window high on the front gable.
  box(g, 1.0, 0.8, 0.1, trim, 0, 3.55, 2.0);               // frame
  box(g, 0.74, 0.56, 0.06, dark, 0, 3.55, 2.04);           // dark opening
  box(g, 0.08, 0.56, 0.07, trim, 0, 3.55, 2.07);           // mullion V

  // ---- Two stall windows flanking — small framed openings on the sides.
  for (const sz of [-1, 1]) {
    box(g, 0.1, 0.8, 0.9, trim, 3.0, 1.7, sz * 1.1);        // +X side window frame
    box(g, 0.06, 0.56, 0.64, dark, 3.04, 1.7, sz * 1.1);    // dark pane
  }

  // ---- Small fenced PADDOCK hint off the -X side: 3 posts + 2 rails
  //      forming an L corner of a rail fence (charming, not a full pen).
  //      Kept compact and tucked against the stable wall (x=-3).
  const px0 = -3.3;
  const postXs = [px0, px0 - 1.3, px0 - 2.6];
  for (const x of postXs) {
    box(g, 0.16, 1.0, 0.16, woodD, x, 0.5, 2.2);            // post
    box(g, 0.2, 0.08, 0.2, woodD, x, 1.0, 2.2);             // post cap
  }
  // Two rails spanning the run (top + mid).
  box(g, 2.6, 0.1, 0.07, mat(COLORS.wood), px0 - 1.3, 0.85, 2.2);
  box(g, 2.6, 0.1, 0.07, mat(COLORS.wood), px0 - 1.3, 0.55, 2.2);
  // A return corner post + short rail turning toward the stable (the L).
  box(g, 0.16, 1.0, 0.16, woodD, px0, 0.5, 0.9);            // corner-return post
  box(g, 0.07, 0.1, 1.3, mat(COLORS.wood), px0, 0.85, 1.55); // return rail
  box(g, 0.07, 0.1, 1.3, mat(COLORS.wood), px0, 0.55, 1.55);

  // ---- Two hay bales tucked into the paddock corner (square bales).
  for (const [hx, hz] of [[px0 - 1.0, 1.35], [px0 - 1.7, 1.45]]) {
    box(g, 0.8, 0.66, 0.8, mat(COLORS.straw), hx, 0.43, hz);   // bale body
    box(g, 0.82, 0.1, 0.82, mat(0xd9b24a), hx, 0.63, hz);      // top straw cap
    box(g, 0.84, 0.06, 0.28, woodD, hx, 0.43, hz);             // baling twine
  }
  // A single bale stacked on top of the first for height.
  box(g, 0.7, 0.56, 0.7, mat(COLORS.straw), px0 - 1.0, 1.04, 1.35);
  box(g, 0.72, 0.08, 0.72, mat(0xd9b24a), px0 - 1.0, 1.28, 1.35);

  return g;
}

/* ------------------------------------------------------------------ *
 *  createHorse — voxel horse, ~2 long, ~1.8 tall. Faces +Z.
 *  variant: 'bay' (default) | 'brown' | 'white'. Origin at BOTTOM-CENTER.
 *  userData: { head, legs: [FL, FR, BL, BR], tail }
 *    head — pivot Group at the neck base; rotate.x to graze / startle.
 *    legs — 4 pivot Groups at the hips/shoulders; rotate.x for the gait.
 *    tail — pivot Group at the dock; swishes with rotation.
 *  Body, arched neck, head with muzzle + ears, darker mane + tail, four
 *  legs with hooves. ≤ ~30 meshes; geometry/material shared.
 * ------------------------------------------------------------------ */

export function createHorse(variant = 'bay') {
  const g = new THREE.Group();
  const v = variant === 'brown' ? 'brown' : variant === 'white' ? 'white' : 'bay';
  // Coat / mane (mane + tail run darker) / muzzle palettes per variant.
  const coatHex = v === 'white' ? 0xe9e6df : v === 'brown' ? 0x8d5a3b : 0x9c5a2b;
  const maneHex = v === 'white' ? 0xb6afa0 : v === 'brown' ? 0x4a2f1d : 0x2b1c12;
  const coat = mat(coatHex);
  const coatLt = mat(v === 'white' ? 0xf3f0e9 : _tint(coatHex, 1.12)); // belly / muzzle highlight
  const mane = mat(maneHex);
  const hoof = mat(0x2e2722);
  const muzzle = mat(v === 'white' ? 0xc9b9b0 : 0x5a3a26);
  const eye = mat(0x14110e);

  // ---- Barrel body: deep chest tapering to a leaner rump (bottom-center
  //      origin; the legs below reach down to y=0 so it stands ON the ground).
  box(g, 0.74, 0.86, 1.5, coat, 0, 1.18, 0);               // main barrel
  box(g, 0.7, 0.78, 0.4, coat, 0, 1.22, 0.74);             // deep chest, forward + high
  box(g, 0.64, 0.62, 0.34, coat, 0, 1.12, -0.76);          // rump, a touch lower
  box(g, 0.66, 0.26, 1.18, coatLt, 0, 0.82, -0.02);        // lighter underbelly
  // Withers/back ridge (slight two-tone) — purely cosmetic.
  box(g, 0.62, 0.1, 1.28, mat(v === 'white' ? 0xd8d3c8 : _tint(coatHex, 0.86)), 0, 1.62, 0);

  // ---- Legs: long and slim, pivot at the shoulder/hip (y=0.94). The stack
  //      reaches DOWN so the hoof bottom lands exactly on the ground (y=0):
  //      thigh, then cannon, then a hoof whose base sits at -0.94 = world 0.
  //      Order: FL, FR, BL, BR (front legs forward, hinds back).
  const legs = [];
  for (const [lx, lz] of [[0.26, 0.54], [-0.26, 0.54], [0.26, -0.56], [-0.26, -0.56]]) {
    const hip = pivot(g, lx, 0.94, lz);
    box(hip, 0.24, 0.46, 0.28, coat, 0, -0.2, 0.01);        // shoulder / thigh
    box(hip, 0.15, 0.46, 0.17, coat, 0, -0.58, 0);          // cannon
    box(hip, 0.16, 0.1, 0.18, coat, 0, -0.78, 0.01);        // fetlock
    box(hip, 0.19, 0.13, 0.21, hoof, 0, -0.875, 0.01);      // hoof (base = world 0)
    legs.push(hip);
  }

  // ---- Tail: pivot at the dock high on the rump; long flowing dark hair
  //      that sweeps down and slightly back. rotation.y flicks it side to side.
  const tail = pivot(g, 0, 1.42, -0.92);
  const tailTop = box(tail, 0.18, 0.4, 0.18, mane, 0, -0.18, -0.05);
  tailTop.rotation.x = 0.22;
  const tailMid = box(tail, 0.15, 0.4, 0.15, mane, 0, -0.5, -0.16);
  tailMid.rotation.x = 0.34;
  box(tail, 0.12, 0.22, 0.12, mane, 0, -0.74, -0.26);       // wispy tip

  // ---- Head: pivot at the neck base; nods/grazes on rotation.x. An arched
  //      neck rises forward+up, then the skull tilts back down to the muzzle.
  const head = pivot(g, 0, 1.5, 0.66);
  // Arched neck rising forward + up.
  const neck = box(head, 0.34, 0.84, 0.42, coat, 0, 0.34, 0.18);
  neck.rotation.x = -0.42;
  const throat = box(head, 0.26, 0.5, 0.24, coatLt, 0, 0.18, 0.36); // lighter throatlatch
  throat.rotation.x = -0.42;
  // Flowing mane crest running down the neck (darker, sits proud at the back).
  const crest = box(head, 0.13, 0.82, 0.2, mane, 0, 0.36, 0.0);
  crest.rotation.x = -0.42;
  const crestLow = box(head, 0.12, 0.34, 0.16, mane, 0, 0.02, -0.12);
  crestLow.rotation.x = -0.42;
  // Skull + long tapering muzzle, tilted forward at the top of the neck.
  const skull = pivot(head, 0, 0.72, 0.46);
  skull.rotation.x = 0.4;
  box(skull, 0.3, 0.36, 0.4, coat, 0, 0.06, 0.16);          // cheeks / jaw
  box(skull, 0.23, 0.26, 0.34, coat, 0, -0.02, 0.44);       // muzzle bridge
  box(skull, 0.21, 0.18, 0.16, muzzle, 0, -0.08, 0.62);     // soft nose
  box(skull, 0.04, 0.05, 0.04, eye, -0.07, -0.04, 0.68);    // nostrils
  box(skull, 0.04, 0.05, 0.04, eye, 0.07, -0.04, 0.68);
  box(skull, 0.05, 0.08, 0.05, eye, -0.17, 0.14, 0.28);     // eyes (set wide)
  box(skull, 0.05, 0.08, 0.05, eye, 0.17, 0.14, 0.28);
  // Forelock tuft falling between the ears.
  box(skull, 0.16, 0.13, 0.1, mane, 0, 0.26, 0.12);
  // Ears (pricked forward + slightly out) with darker inner channel.
  for (const s of [-1, 1]) {
    const ear = box(skull, 0.1, 0.2, 0.09, coat, s * 0.13, 0.32, 0.05);
    ear.rotation.z = s * 0.28;
    const inner = box(skull, 0.05, 0.13, 0.05, mane, s * 0.135, 0.31, 0.08);
    inner.rotation.z = s * 0.28;
  }

  g.userData = { head, legs, tail };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createPig — variant 'pink' | 'spotted'. A cute, round, ~0.7×-cow pig:
 *  fat barrel body, short stubby legs, a flat snout with two nostrils,
 *  perky ears, beady eyes and a little kinked curly tail. 'spotted' adds
 *  darker dappled patches over the pink coat.
 *  userData: { head, legs:[FL,FR,BL,BR], tail } — same animation contract
 *  as createCow (head nods on X, legs swing on X, tail flicks on Y).
 * ------------------------------------------------------------------ */

export function createPig(variant = 'pink') {
  const g = new THREE.Group();
  const spotted = variant === 'spotted';
  const skinHex = 0xf2a8a8;                                 // bright piggy pink
  const skin = mat(skinHex);
  const skinLt = mat(_tint(skinHex, 1.08));                 // belly / snout highlight
  const patch = mat(0x7a4a44);                              // dappled spots (spotted)
  const snoutM = mat(0xe28b8b);                             // snout disc
  const hoof = mat(0x3a302a);
  const eye = mat(0x14110e);

  // ---- Round barrel body: a fat slab plus chest + rump lumps for a plump,
  //      sausage silhouette. Bottom-center origin; stubby legs reach to y=0.
  box(g, 0.72, 0.66, 0.96, skin, 0, 0.62, 0);              // main barrel
  box(g, 0.62, 0.58, 0.3, skin, 0, 0.62, 0.52);           // chest
  box(g, 0.66, 0.6, 0.3, skin, 0, 0.6, -0.5);             // big round rump
  box(g, 0.56, 0.2, 0.78, skinLt, 0, 0.34, -0.02);        // lighter underbelly

  // Spotted variant: a few darker dapples proud of the body, per side.
  if (spotted) {
    box(g, 0.42, 0.3, 0.06, patch, 0, 0.74, 0.49);         // chest blotch
    box(g, 0.06, 0.34, 0.4, patch, 0.37, 0.66, -0.18);     // right flank
    box(g, 0.06, 0.26, 0.3, patch, -0.37, 0.58, 0.24);     // left flank
    box(g, 0.36, 0.06, 0.34, patch, -0.1, 0.95, -0.3);     // back saddle spot
  }

  // ---- Legs: short + stubby, pivot at the hip (y=0.42) so they swing on X.
  //      Stack reaches DOWN to the ground: shank then trotter, base at world 0.
  //      Order: FL, FR, BL, BR.
  const legs = [];
  for (const [lx, lz] of [[0.24, 0.32], [-0.24, 0.32], [0.24, -0.34], [-0.24, -0.34]]) {
    const hip = pivot(g, lx, 0.42, lz);
    box(hip, 0.2, 0.28, 0.22, skin, 0, -0.15, 0);          // stubby leg
    box(hip, 0.21, 0.12, 0.23, hoof, 0, -0.36, 0.01);      // trotter (base = world 0)
    legs.push(hip);
  }

  // ---- Tail: a little kinked, curly tail. pivot at the base so rotation.y
  //      gives it a happy wiggle; built from short offset segments for a curl.
  const tail = pivot(g, 0, 0.78, -0.66);
  const t1 = box(tail, 0.08, 0.08, 0.16, skin, 0, 0.02, -0.06);
  t1.rotation.x = -0.5;
  const t2 = box(tail, 0.07, 0.16, 0.07, skin, 0.06, 0.1, -0.12);
  t2.rotation.x = 0.4;
  box(tail, 0.06, 0.1, 0.06, skin, -0.04, 0.16, -0.08);    // curl tip

  // ---- Head: pivot at the neck; nods/grazes on rotation.x. Big blocky head
  //      with a flat round snout, two nostrils, beady eyes and perky ears.
  const head = pivot(g, 0, 0.66, 0.46);
  box(head, 0.5, 0.46, 0.42, skin, 0, 0.04, 0.1);          // head/jowls
  if (spotted) box(head, 0.2, 0.22, 0.05, patch, 0.16, 0.12, 0.31); // cheek patch
  // Snout: a stubby nose with a flat round disc + two nostrils.
  box(head, 0.3, 0.24, 0.18, skin, 0, -0.04, 0.36);        // snout block
  box(head, 0.26, 0.2, 0.06, snoutM, 0, -0.04, 0.47);      // flat snout disc
  box(head, 0.05, 0.07, 0.04, eye, -0.07, -0.04, 0.5);     // nostrils
  box(head, 0.05, 0.07, 0.04, eye, 0.07, -0.04, 0.5);
  // Beady little eyes.
  box(head, 0.06, 0.08, 0.04, eye, -0.15, 0.14, 0.31);
  box(head, 0.06, 0.08, 0.04, eye, 0.15, 0.14, 0.31);
  // Perky triangular ears tipping forward, with a darker inner channel.
  for (const s of [-1, 1]) {
    const ear = box(head, 0.16, 0.18, 0.1, skin, s * 0.21, 0.3, 0.04);
    ear.rotation.z = s * 0.4;
    ear.rotation.x = -0.25;
    const inner = box(head, 0.08, 0.1, 0.06, snoutM, s * 0.21, 0.29, 0.07);
    inner.rotation.z = s * 0.4;
    inner.rotation.x = -0.25;
  }

  g.userData = { head, legs, tail };
  return g;
}

/* ================================================================== *
 *  BEACH MAP — new low-poly voxel models (Agent M, beach pass).
 *  Abductable creatures expose userData { head, legs, tail } for the
 *  critter animator (js/cows.js): head nods on X, every entry of the
 *  legs array swings on X, tail rotates on Y. Ambient creatures &
 *  props just return a Group. Bottom-center origin, faces +Z, unless a
 *  comment notes a deliberate center origin for a flyer / swimmer.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 *  createCrab — 'red' | 'blue'. The STAR beach creature. ~0.8× cow,
 *  so ~1.5 wide. A cute, wide, flat rounded carapace on six little
 *  legs, two oversized front claws, and two eye stalks.
 *  userData: { head, legs:[L0,L1,L2,R0,R1,R2], tail }
 *    head — the eye-stalk pivot (nods on X)
 *    legs — six hip pivots (3 left, 3 right) that swing on X (skitter)
 *    tail — the right claw pivot (a "wave"/snap on Y reads as charm)
 * ------------------------------------------------------------------ */

export function createCrab(variant = 'red') {
  const g = new THREE.Group();
  const blue = variant === 'blue';
  const shellHex = blue ? 0x4f86d6 : 0xe2452f;
  const shell = mat(shellHex);
  const shellLt = mat(_tint(shellHex, 1.18));         // top dome highlight
  const shellDk = mat(_tint(shellHex, 0.78));         // belly / claw shade
  const clawM = mat(_tint(shellHex, 1.06));
  const legM = mat(_tint(shellHex, 0.9));
  const eye = mat(0x14110e);
  const white = mat(0xf6f6f2);

  // ---- Carapace: a wide, flat, rounded shell. A squashed dome on top of
  //      a low slab so it reads round but sits low to the ground.
  box(g, 1.18, 0.34, 0.82, shell, 0, 0.46, 0);                   // main slab
  const dome = add(g, domeGeo(0.66, 12, 6), shellLt, 0, 0.46, 0);
  dome.scale.set(1.62, 0.7, 1.0);                                 // wide flat carapace
  box(g, 1.0, 0.2, 0.6, shellDk, 0, 0.32, 0.02);                 // shaded underbelly rim
  // A couple of bumpy shell ridges for character.
  box(g, 0.5, 0.12, 0.14, shellDk, 0, 0.62, -0.16);
  box(g, 0.16, 0.1, 0.16, shellDk, -0.34, 0.58, 0.1);
  box(g, 0.16, 0.1, 0.16, shellDk, 0.34, 0.58, 0.1);
  // Little frothy mouth bubbles + mandible line at the front.
  box(g, 0.34, 0.08, 0.06, white, 0, 0.34, 0.42);
  box(g, 0.05, 0.05, 0.05, white, -0.1, 0.3, 0.45).castShadow = false;
  box(g, 0.05, 0.05, 0.05, white, 0.12, 0.31, 0.45).castShadow = false;

  // ---- Six walking legs, pivoting at the hip just under the shell (y=0.4)
  //      so each swings on X. Three per side, fanned fore→aft. Built as a
  //      short upper segment + a kinked, pointed foot reaching to y≈0.
  const legs = [];
  const legZ = [0.28, 0.0, -0.3];                  // fore / mid / aft
  for (const s of [-1, 1]) {                       // left (-X) then right (+X)
    for (const lz of legZ) {
      const hip = pivot(g, s * 0.56, 0.4, lz);
      const upper = box(hip, 0.34, 0.1, 0.1, legM, s * 0.16, -0.04, 0);
      upper.rotation.z = s * -0.5;                 // splay outward + down
      const foot = box(hip, 0.1, 0.3, 0.1, legM, s * 0.3, -0.22, 0);
      foot.rotation.z = s * 0.18;                  // kink down to a point
      legs.push(hip);
    }
  }

  // ---- Two big front claws on pivots. Left claw is static-ish; the RIGHT
  //      claw is exposed as `tail` so the animator's tail.rotation.y reads
  //      as a friendly snap/wave. Each: an arm, a fat pincer + a thumb.
  const makeClaw = (s) => {
    const claw = pivot(g, s * 0.7, 0.44, 0.42);
    const arm = box(claw, 0.18, 0.16, 0.4, clawM, s * 0.05, 0, 0.18);
    arm.rotation.y = s * -0.35;
    const pincer = box(claw, 0.42, 0.34, 0.34, clawM, s * 0.26, 0.04, 0.46);
    pincer.rotation.y = s * -0.35;
    // Upper + lower jaw of the pincer (a wedge gap between them).
    const jawU = box(claw, 0.3, 0.12, 0.22, shellDk, s * 0.4, 0.14, 0.62);
    jawU.rotation.y = s * -0.35;
    const jawL = box(claw, 0.3, 0.12, 0.22, shellDk, s * 0.4, -0.06, 0.62);
    jawL.rotation.y = s * -0.35;
    return claw;
  };
  makeClaw(-1);
  const clawR = makeClaw(1);
  const tail = clawR;                               // right claw = "tail" joint

  // ---- Eye stalks on a pivot exposed as `head`. Two short stalks rising
  //      from the shell front, each capped with a white+black eye. Nodding
  //      (head.rotation.x) bobs the eyes adorably.
  const head = pivot(g, 0, 0.6, 0.26);
  for (const s of [-1, 1]) {
    box(head, 0.07, 0.26, 0.07, legM, s * 0.16, 0.13, 0.04);   // stalk
    add(head, sphGeo(0.11, 6, 5), white, s * 0.16, 0.3, 0.05); // eyeball
    box(head, 0.06, 0.07, 0.05, eye, s * 0.16, 0.32, 0.13);    // pupil
  }
  // A tiny smile between the stalks.
  box(head, 0.18, 0.04, 0.04, eye, 0, 0.04, 0.1);

  g.userData = { head, legs, tail };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBeachgoer — 'a' | 'b' | 'c'. A low-poly human in swimwear.
 *  ~1.9 tall, bottom-center origin, faces +Z.
 *  userData: { head, legs:[legL, legR], tail }
 *    head — neck pivot (nods on X)
 *    legs — two hip pivots (swing on X for a walk cycle)
 *    tail — a tiny null-safe pivot (no real tail; animator-safe)
 *  Variants differ by swimwear / skin / hair colour.
 * ------------------------------------------------------------------ */

export function createBeachgoer(variant = 'a') {
  const g = new THREE.Group();
  const v = variant === 'b' ? 1 : variant === 'c' ? 2 : 0;
  const skinHex = [0xe8b88a, 0x8d5a3b, 0xf3c7a3][v];
  const suitHex = [0xe53935, 0x26a69a, 0xffb300][v];   // trunks / one-piece
  const topHex = [0x1e88e5, 0xff7043, 0xab47bc][v];    // top / bikini
  const hairHex = [0x3e2723, 0x212121, 0xfff176][v];
  const skin = mat(skinHex);
  const suit = mat(suitHex);
  const top = mat(topHex);
  const hair = mat(hairHex);
  const eye = mat(0x14110e);

  // ---- Legs: pivot at the hips (y=0.92). Bare legs + simple flip-flops.
  const legs = [];
  for (const s of [1, -1]) {                          // left(+X), right(-X)
    const hip = pivot(g, s * 0.15, 0.92, 0);
    box(hip, 0.22, 0.7, 0.24, skin, 0, -0.4, 0);      // leg
    box(hip, 0.24, 0.08, 0.34, mat(0x37474f), 0, -0.8, 0.04); // flip-flop sole
    box(hip, 0.05, 0.06, 0.22, suit, 0, -0.72, 0.04); // sandal strap
    legs.push(hip);
  }
  const [legL, legR] = legs;

  // ---- Hips + torso in swimwear.
  box(g, 0.5, 0.22, 0.3, suit, 0, 1.0, 0);            // swim trunks / brief
  box(g, 0.54, 0.66, 0.34, skin, 0, 1.42, 0);         // torso
  // Top: a tank/bikini band across the chest (a bit of swimwear colour).
  box(g, 0.56, 0.2, 0.36, top, 0, 1.62, 0);
  if (v === 2) box(g, 0.58, 0.12, 0.37, top, 0, 1.4, 0); // extra band, variant c

  // ---- Arms: pivot at the shoulders, hanging relaxed.
  for (const s of [1, -1]) {
    const arm = pivot(g, s * 0.36, 1.66, 0);
    box(arm, 0.16, 0.5, 0.18, skin, 0, -0.26, 0);     // arm
    box(arm, 0.16, 0.14, 0.18, skin, 0, -0.52, 0);    // hand
  }

  // ---- Head: pivot at the neck. Face + hair.
  const head = pivot(g, 0, 1.74, 0);
  box(head, 0.4, 0.4, 0.4, skin, 0, 0.2, 0);
  box(head, 0.06, 0.09, 0.04, eye, -0.1, 0.24, 0.205);
  box(head, 0.06, 0.09, 0.04, eye, 0.1, 0.24, 0.205);
  box(head, 0.1, 0.05, 0.05, mat(_tint(suitHex, 0.8)), 0, 0.12, 0.21); // little smile
  // Hair cap + a fringe (sunglasses on variant b).
  box(head, 0.44, 0.2, 0.44, hair, 0, 0.36, -0.02);
  box(head, 0.44, 0.1, 0.12, hair, 0, 0.28, 0.18);
  if (v === 1) {
    box(head, 0.36, 0.1, 0.05, mat(0x14110e), 0, 0.26, 0.21); // sunglasses
  }

  // ---- Tail: a tiny null-safe pivot (humans have no tail; satisfies the
  //      animator's tail.rotation.y access harmlessly).
  const tail = pivot(g, 0, 1.0, -0.18);

  g.userData = { head, legs: [legL, legR], tail };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createFish — 'orange' | 'blue'. A small fish, ~0.7 long. Origin at
 *  bottom-center (min.y ≈ 0). Faces +Z.
 *  userData: { head, legs:[], tail }
 *    legs — empty array (fish have no legs; animator loops harmlessly)
 *    head — a head pivot at the front (gentle nod on X)
 *    tail — the tail-fin pivot (wiggles on Y)
 * ------------------------------------------------------------------ */

export function createFish(variant = 'orange') {
  const g = new THREE.Group();
  const blue = variant === 'blue';
  const bodyHex = blue ? 0x29b6f6 : 0xff8f3c;
  const bodyM = mat(bodyHex);
  const bellyM = mat(_tint(bodyHex, 1.22));
  const finM = mat(_tint(bodyHex, 0.86));
  const stripe = mat(0xf6f6f2);
  const eyeW = mat(0xf6f6f2);
  const eye = mat(0x14110e);

  // ---- Body: a rounded teardrop. Center the mass around y≈0.3 so the
  //      lowest fin/belly sits at y≈0.
  const body = add(g, sphGeo(0.3, 10, 8), bodyM, 0, 0.32, 0.05);
  body.scale.set(1.0, 0.92, 1.5);                     // stretched along Z (forward)
  add(g, sphGeo(0.2, 8, 6), bellyM, 0, 0.2, 0.12).scale.set(0.9, 0.7, 1.4); // pale belly
  // A vertical stripe band (clownfish-ish on orange, accent on blue).
  box(g, 0.04, 0.4, 0.22, stripe, 0, 0.32, 0.16);
  box(g, 0.04, 0.34, 0.18, stripe, 0, 0.3, -0.16);

  // ---- Tail fin: pivot at the rear (z≈-0.4); a flat triangular-ish fin
  //      that wiggles on Y.
  const tail = pivot(g, 0, 0.34, -0.42);
  box(tail, 0.06, 0.34, 0.3, finM, 0, 0, -0.16);
  box(tail, 0.05, 0.46, 0.16, finM, 0, 0, -0.3);      // wide fan tip

  // ---- Side (pectoral) fins + a top dorsal.
  for (const s of [-1, 1]) {
    const sf = box(g, 0.04, 0.16, 0.24, finM, s * 0.22, 0.28, 0.06);
    sf.rotation.y = s * 0.5;
  }
  const dorsal = box(g, 0.05, 0.22, 0.3, finM, 0, 0.58, 0.0);
  dorsal.rotation.x = 0.2;

  // ---- Head: pivot at the front (z≈0.4) carrying the eyes + lips.
  const head = pivot(g, 0, 0.34, 0.4);
  add(head, sphGeo(0.22, 8, 6), bodyM, 0, 0, 0.05).scale.set(1.0, 0.95, 0.9);
  for (const s of [-1, 1]) {
    add(head, sphGeo(0.08, 6, 5), eyeW, s * 0.15, 0.05, 0.1);
    box(head, 0.05, 0.06, 0.04, eye, s * 0.16, 0.05, 0.17);
  }
  box(head, 0.16, 0.07, 0.06, mat(_tint(bodyHex, 0.7)), 0, -0.1, 0.2); // lips

  g.userData = { head, legs: [], tail };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createLifeguard — the THREAT. A buff lifeguard standing, holding a
 *  chunky WATER GUN in both hands, red/orange swim shorts + whistle.
 *  ~2.0 tall, bottom-center origin, faces +Z.
 *  userData: { head, legs:[legL, legR], tail, arms:[armL, armR], gun, gunTip }
 *    head — neck pivot (nods on X)
 *    legs — two hip pivots (swing on X)
 *    tail — tiny null-safe pivot
 *    gun  — water-gun prop parented to the right arm (also usable by AI)
 * ------------------------------------------------------------------ */

export function createLifeguard() {
  const g = new THREE.Group();
  const skin = mat(0xd99b6c);                         // tanned
  const skinDk = mat(0xc48354);                       // muscle shade
  const shorts = mat(0xe53935);                       // red/orange swim shorts
  const shortsTrim = mat(0xffb300);
  const eye = mat(0x14110e);
  const hair = mat(0x4e342e);
  const white = mat(0xf6f6f2);

  // ---- Legs: pivot at the hips (y=1.02). Big quads + bare feet.
  const legs = [];
  for (const s of [1, -1]) {
    const hip = pivot(g, s * 0.2, 1.02, 0);
    box(hip, 0.3, 0.5, 0.34, shorts, 0, -0.22, 0);    // shorts on the thigh
    box(hip, 0.28, 0.46, 0.3, skin, 0, -0.66, 0);     // lower leg
    box(hip, 0.3, 0.1, 0.4, skin, 0, -0.9, 0.05);     // foot
    legs.push(hip);
  }
  const [legL, legR] = legs;

  // ---- Hips + buff torso.
  box(g, 0.62, 0.24, 0.4, shorts, 0, 1.12, 0);        // waistband
  box(g, 0.66, 0.06, 0.42, shortsTrim, 0, 1.02, 0);   // lower shorts trim
  box(g, 0.74, 0.7, 0.42, skin, 0, 1.56, 0);          // big chest
  box(g, 0.3, 0.4, 0.06, skinDk, -0.18, 1.58, 0.22);  // pec shadow L
  box(g, 0.3, 0.4, 0.06, skinDk, 0.18, 1.58, 0.22);   // pec shadow R
  box(g, 0.2, 0.34, 0.05, skinDk, 0, 1.42, 0.23);     // abs centre line
  // Lifeguard cross emblem on the chest.
  box(g, 0.2, 0.07, 0.05, white, 0, 1.66, 0.24).castShadow = false;
  box(g, 0.07, 0.2, 0.05, white, 0, 1.66, 0.24).castShadow = false;

  // ---- Whistle on a lanyard around the neck.
  box(g, 0.04, 0.34, 0.04, white, 0.1, 1.7, 0.2).rotation.z = 0.2; // lanyard
  add(g, sphGeo(0.07, 6, 5), shortsTrim, 0.16, 1.5, 0.25).castShadow = false; // whistle

  // ---- Arms: pivot at the shoulders. Raised forward to grip the water gun.
  const arms = [];
  for (const s of [1, -1]) {
    const arm = pivot(g, s * 0.46, 1.78, 0);
    arm.rotation.x = -0.9;                             // arms forward, gripping
    box(arm, 0.22, 0.4, 0.24, skin, 0, -0.2, 0);       // upper arm (biceps)
    box(arm, 0.2, 0.34, 0.22, skin, 0, -0.5, 0);       // forearm
    box(arm, 0.2, 0.14, 0.2, skin, 0, -0.7, 0);        // fist
    arms.push(arm);
  }
  const [armL, armR] = arms;

  // ---- WATER GUN: a chunky squirt gun built pointing +Z, parented to the
  //      right hand. Bright translucent-look tank, fat barrel + nozzle, a
  //      grip and a pump handle — reads unmistakably as a water gun.
  const gun = pivot(armR, 0.0, -0.72, 0.12);
  gun.rotation.x = Math.PI / 2;                        // lay it along the forward arm
  const gunBody = mat(0xffd54f);                       // bright yellow toy gun
  const gunBlue = mat(0x29b6f6);
  const gunOrange = mat(0xff7043);
  const tankM = mat(0x4fc3f7);
  box(gun, 0.18, 0.2, 0.5, gunBody, 0, 0.04, 0.0);     // receiver / pump body
  box(gun, 0.14, 0.26, 0.16, gunBody, 0, -0.16, -0.18); // grip (down + back)
  box(gun, 0.13, 0.13, 0.46, gunBlue, 0, 0.08, 0.42);  // fat barrel
  box(gun, 0.16, 0.16, 0.12, gunOrange, 0, 0.08, 0.68); // nozzle ring
  box(gun, 0.07, 0.07, 0.1, mat(0x0277bd), 0, 0.08, 0.76); // dark muzzle hole
  // Big water reservoir on top.
  add(gun, cylZGeo(0.16, 0.4, 10), tankM, 0, 0.26, 0.12);
  box(gun, 0.14, 0.06, 0.16, gunOrange, 0, 0.36, 0.12); // tank cap
  // Pump handle under the barrel.
  box(gun, 0.1, 0.1, 0.2, gunOrange, 0, -0.04, 0.5);
  const gunTip = new THREE.Object3D();
  gunTip.position.set(0, 0.08, 0.82);
  gun.add(gunTip);

  // ---- Head: pivot at the neck. Square jaw, sunglasses, lifeguard cap.
  const head = pivot(g, 0, 1.92, 0);
  box(head, 0.42, 0.44, 0.42, skin, 0, 0.22, 0);
  box(head, 0.4, 0.1, 0.06, mat(0x263238), 0, 0.26, 0.21); // sunglasses bar
  box(head, 0.12, 0.09, 0.05, eye, -0.1, 0.26, 0.215).castShadow = false;
  box(head, 0.12, 0.09, 0.05, eye, 0.1, 0.26, 0.215).castShadow = false;
  box(head, 0.18, 0.07, 0.06, skinDk, 0, 0.08, 0.21);  // strong jaw / chin
  // Hair + a red lifeguard cap.
  box(head, 0.46, 0.16, 0.46, hair, 0, 0.4, -0.02);
  box(head, 0.48, 0.12, 0.48, shorts, 0, 0.5, 0);      // cap crown
  box(head, 0.4, 0.05, 0.24, shorts, 0, 0.46, 0.28);   // cap bill

  // ---- Tail: tiny null-safe pivot for the animator contract.
  const tail = pivot(g, 0, 1.1, -0.2);

  g.userData = { head, legs: [legL, legR], tail, arms: [armL, armR], gun, gunTip };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createShark — ambient. A grey shark with a prominent dorsal fin
 *  (cruises just under the surface), tail fin + body. ~3.2 long.
 *  Center origin (vertical center near y=0); animated by world position.
 * ------------------------------------------------------------------ */

export function createShark() {
  const g = new THREE.Group();
  const grey = mat(0x6b7a86);
  const greyLt = mat(0xb9c4cc);                        // pale belly
  const greyDk = mat(0x4a5660);                        // fin edge
  const white = mat(0xf6f6f2);
  const eye = mat(0x14110e);

  // ---- Body: a long torpedo. Sphere stretched far along Z, tapering to a
  //      lean tail. Center origin so it sits at the requested vertical 0.
  const body = add(g, sphGeo(0.6, 12, 8), grey, 0, 0, 0.1);
  body.scale.set(1.0, 0.92, 2.6);
  add(g, sphGeo(0.46, 10, 7), greyLt, 0, -0.18, 0.1).scale.set(0.94, 0.6, 2.4); // belly
  // Lean tail stalk reaching back.
  box(g, 0.34, 0.34, 0.7, grey, 0, 0.0, -1.4);

  // ---- Snout / head, pointed forward with gills + a toothy mouth.
  const snout = add(g, sphGeo(0.4, 8, 6), grey, 0, 0.02, 1.5);
  snout.scale.set(0.9, 0.8, 1.3);
  for (const s of [-1, 1]) {
    add(g, sphGeo(0.09, 6, 5), eye, s * 0.28, 0.12, 1.7); // eyes
    for (let i = 0; i < 3; i++) box(g, 0.04, 0.18, 0.04, greyDk, s * 0.34, 0.0, 1.2 - i * 0.12); // gill slits
  }
  box(g, 0.5, 0.1, 0.18, white, 0, -0.2, 1.8);          // toothy mouth
  for (let i = 0; i < 5; i++) box(g, 0.05, 0.08, 0.04, greyDk, -0.2 + i * 0.1, -0.16, 1.88); // teeth

  // ---- Prominent dorsal fin (the iconic triangle) on top.
  const dorsal = box(g, 0.1, 0.62, 0.5, grey, 0, 0.62, 0.0);
  dorsal.rotation.x = -0.3;                              // rakes back
  box(g, 0.08, 0.3, 0.22, greyDk, 0, 0.86, -0.1).rotation.x = -0.3; // tip
  // Pectoral fins angled out + down.
  for (const s of [-1, 1]) {
    const pec = box(g, 0.5, 0.08, 0.3, grey, s * 0.5, -0.2, 0.5);
    pec.rotation.z = s * -0.5;
    pec.rotation.y = s * 0.3;
  }
  // Small second dorsal + pelvic fin.
  box(g, 0.08, 0.22, 0.18, grey, 0, 0.4, -1.1).rotation.x = -0.3;

  // ---- Tail fin: big upper lobe + small lower lobe (heterocercal).
  const tailTop = box(g, 0.1, 0.7, 0.4, grey, 0, 0.3, -1.85);
  tailTop.rotation.x = 0.5;
  const tailBot = box(g, 0.1, 0.4, 0.3, grey, 0, -0.2, -1.8);
  tailBot.rotation.x = -0.4;

  return g;
}

/* ------------------------------------------------------------------ *
 *  createDolphin — ambient. A smooth grey/blue dolphin posed mid-leap
 *  in a gentle arc (body, dorsal fin, tail fluke, beak). ~2.6 long.
 *  Center origin; animated by world position along its jump.
 * ------------------------------------------------------------------ */

export function createDolphin() {
  const g = new THREE.Group();
  const grey = mat(0x7c8fa6);                           // grey-blue back
  const belly = mat(0xeef3f8);                          // pale belly
  const fin = mat(0x6b7d94);
  const eye = mat(0x14110e);

  // Pose the whole dolphin in a shallow leaping arc (nose up, tail down).
  const arc = pivot(g, 0, 0, 0);
  arc.rotation.x = -0.35;                               // tilt nose-up

  // ---- Body: smooth fusiform. Sphere stretched along Z, tapering.
  const body = add(arc, sphGeo(0.5, 12, 8), grey, 0, 0, 0.1);
  body.scale.set(1.0, 0.94, 2.4);
  add(arc, sphGeo(0.4, 10, 7), belly, 0, -0.16, 0.1).scale.set(0.94, 0.62, 2.2); // pale belly
  box(arc, 0.34, 0.34, 0.7, grey, 0, -0.02, -1.25);     // tail stalk

  // ---- Head with the classic beak (rostrum) + melon forehead.
  const headBlob = add(arc, sphGeo(0.42, 10, 7), grey, 0, 0.06, 1.2);
  headBlob.scale.set(0.95, 0.95, 1.1);
  box(arc, 0.26, 0.2, 0.4, grey, 0, -0.04, 1.6);        // beak base
  box(arc, 0.18, 0.13, 0.26, belly, 0, -0.06, 1.86);    // beak tip
  add(arc, sphGeo(0.06, 6, 5), eye, -0.26, 0.1, 1.32);  // eyes
  add(arc, sphGeo(0.06, 6, 5), eye, 0.26, 0.1, 1.32);
  box(arc, 0.34, 0.06, 0.1, mat(0x556074), 0, -0.1, 1.7); // smile mouth line

  // ---- Curved dorsal fin (swept back).
  const dorsal = box(arc, 0.08, 0.46, 0.4, fin, 0, 0.5, 0.0);
  dorsal.rotation.x = -0.5;
  // Pectoral flippers angled down.
  for (const s of [-1, 1]) {
    const pec = box(arc, 0.4, 0.08, 0.24, fin, s * 0.42, -0.18, 0.6);
    pec.rotation.z = s * -0.6;
  }

  // ---- Tail fluke (horizontal, at the back) — two lobes.
  const fluke = pivot(arc, 0, -0.1, -1.65);
  fluke.rotation.x = 0.4;
  box(fluke, 0.7, 0.08, 0.34, fin, 0, 0, -0.16);
  for (const s of [-1, 1]) box(fluke, 0.3, 0.07, 0.26, fin, s * 0.4, 0, -0.22);

  return g;
}

/* ------------------------------------------------------------------ *
 *  createSeagull — ambient flyer. Small white/grey gull. Center origin.
 *  userData: { wings: [wingL, wingR] } — two pivot Groups at the
 *  shoulders so the world can flap them (rotation.z).
 * ------------------------------------------------------------------ */

export function createSeagull() {
  const g = new THREE.Group();
  const white = mat(0xf6f6f2);
  const greyWing = mat(0x9aa7b2);
  const greyDk = mat(0x5a6670);
  const beakM = mat(0xffb300);
  const eye = mat(0x14110e);

  // ---- Body + head (white), small grey-capped back.
  const body = add(g, sphGeo(0.26, 10, 7), white, 0, 0, 0);
  body.scale.set(1.0, 0.9, 1.5);
  add(g, sphGeo(0.2, 8, 6), white, 0, 0.16, 0.3);       // head/neck
  // Short tail.
  box(g, 0.24, 0.08, 0.26, white, 0, 0.02, -0.34);
  box(g, 0.2, 0.06, 0.16, greyDk, 0, 0.02, -0.46);      // dark tail tip

  // ---- Beak + eyes.
  box(g, 0.07, 0.07, 0.18, beakM, 0, 0.14, 0.5);
  box(g, 0.05, 0.05, 0.06, mat(0xe53935), 0, 0.12, 0.56); // gull beak red dot
  add(g, sphGeo(0.04, 5, 4), eye, -0.1, 0.2, 0.42);
  add(g, sphGeo(0.04, 5, 4), eye, 0.1, 0.2, 0.42);

  // ---- Wings: pivot at each shoulder so the world flaps them on Z.
  //      Each wing is a long swept plank with a grey leading edge + dark tips.
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = pivot(g, s * 0.18, 0.1, 0.05);
    const inner = box(wing, 0.6, 0.06, 0.32, white, s * 0.32, 0, -0.02);
    inner.rotation.z = s * 0.05;
    const outer = box(wing, 0.6, 0.06, 0.24, greyWing, s * 0.86, 0.02, -0.06);
    outer.rotation.z = s * 0.05;
    box(wing, 0.26, 0.05, 0.16, greyDk, s * 1.1, 0.03, -0.1); // dark wing tip
    wings.push(wing);
  }
  const [wingL, wingR] = wings;

  g.userData = { wings: [wingL, wingR] };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createUmbrella — a tilted beach umbrella: pole + wide striped canopy
 *  (two alternating colours) + a small shadow base. Bottom-center origin.
 *  ~3.4 tall, canopy ~3.2 across.
 * ------------------------------------------------------------------ */

export function createUmbrella() {
  const g = new THREE.Group();
  const poleM = mat(0xcfd8dc);
  const sandBase = mat(COLORS.sand);
  const cA = mat(0xe53935);                             // stripe colour A (red)
  const cB = mat(0xf6f6f2);                             // stripe colour B (white)
  const ribM = mat(0xb0bec5);

  // Tilt the whole umbrella for a relaxed lean. The lean pivot sits ON the
  // ground; everything else hangs off it so the lowest point stays at y≈0.
  const lean = pivot(g, 0, 0.02, 0);
  lean.rotation.z = 0.16;

  // ---- Pole pushed into the sand, with a little mound at the base.
  add(g, sphGeo(0.5, 8, 5), sandBase, 0, 0.17, 0).scale.set(1.4, 0.34, 1.4); // sand mound
  add(lean, cylGeo(0.06, 0.06, 3.0, 8), poleM, 0, 1.5, 0);
  add(lean, sphGeo(0.08, 6, 5), poleM, 0, 3.0, 0);      // pole finial

  // ---- Canopy: a shallow cone built from alternating-colour radial gore
  //      panels. Each gore is a flat box whose WIDTH is set directly (no
  //      scaling of a rotated object), tilted down to the rim so the panels
  //      slope from the hub (high) to the rim (low) like real umbrella cloth.
  const segs = 10, R = 1.55, ringY = 2.62, rimDrop = 0.5;
  const goreW = 2 * R * Math.sin(Math.PI / segs) + 0.02;  // chord width of one gore
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * PI2;
    // Gore pivot at the hub, rotated to face its slice, panel slung outward.
    const gore = pivot(lean, 0, ringY, 0);
    gore.rotation.y = -a;
    const panel = box(gore, goreW, 0.05, R, i % 2 ? cA : cB, 0, 0, R * 0.5);
    panel.rotation.x = Math.atan2(rimDrop, R);          // slope down to the rim
  }
  // A small solid hub cone tops the gores off where they meet.
  add(lean, coneGeo(0.28, 0.34, segs), mat(0xb71c1c), 0, ringY + 0.18, 0);
  // Rim ribs / scalloped edge tips around the canopy edge.
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * PI2;
    const tip = box(lean, 0.12, 0.06, 0.12, ribM,
      Math.cos(a) * R, ringY - rimDrop, Math.sin(a) * R);
    tip.rotation.y = -a;
  }

  return g;
}

/* ------------------------------------------------------------------ *
 *  createLifeguardTower — classic raised hut on stilts with a ladder,
 *  railed deck, and a little pitched roof. Red/white. Bottom-center
 *  origin; ~4.2 tall.
 * ------------------------------------------------------------------ */

export function createLifeguardTower() {
  const g = new THREE.Group();
  const wood = mat(COLORS.wood, false, 'planks');
  const post = mat(COLORS.woodDark);
  const red = mat(0xe53935);
  const white = mat(0xf6f6f2);
  const railM = mat(0xfdf5e6);
  const glass = mat(0x80d8ff);

  const deckY = 2.2;                                    // deck height
  const hw = 1.1;                                       // half-width of the hut

  // ---- Four stilts splaying slightly outward at the base for stability.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = box(g, 0.16, deckY + 0.2, 0.16, post, sx * (hw - 0.1), (deckY) / 2, sz * (hw - 0.1));
    leg.rotation.z = -sx * 0.05;
    leg.rotation.x = sz * 0.05;
  }
  // Cross-brace X's on two faces.
  for (const sz of [1, -1]) {
    const b1 = box(g, 0.08, 2.0, 0.08, post, 0, deckY / 2, sz * (hw - 0.1));
    b1.rotation.z = 0.7;
    const b2 = box(g, 0.08, 2.0, 0.08, post, 0, deckY / 2, sz * (hw - 0.1));
    b2.rotation.z = -0.7;
  }

  // ---- Deck platform.
  box(g, hw * 2 + 0.3, 0.16, hw * 2 + 0.3, wood, 0, deckY, 0);
  // Railing posts + top rail around the deck (open front).
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    box(g, 0.08, 0.5, 0.08, railM, sx * hw, deckY + 0.35, sz * hw);
  }
  box(g, hw * 2, 0.07, 0.07, railM, 0, deckY + 0.55, -hw);   // back rail
  box(g, 0.07, 0.07, hw * 2, railM, hw, deckY + 0.55, 0);    // side rails
  box(g, 0.07, 0.07, hw * 2, railM, -hw, deckY + 0.55, 0);

  // ---- Hut: white walls + a big red front opening (the lookout window).
  box(g, hw * 2, 1.1, hw * 2, white, 0, deckY + 0.7, 0);
  box(g, hw * 2 + 0.04, 0.2, hw * 2 + 0.04, red, 0, deckY + 0.3, 0); // red skirt band
  box(g, 1.7, 0.7, 0.06, glass, 0, deckY + 0.8, hw + 0.01);          // front window
  // Side windows.
  for (const s of [-1, 1]) box(g, 0.06, 0.6, 0.9, glass, s * (hw + 0.01), deckY + 0.8, 0);

  // ---- Pitched roof (red), overhanging.
  for (const s of [-1, 1]) {
    const slab = box(g, hw * 2 + 0.5, 0.12, hw + 0.5, red, 0, deckY + 1.5, s * (hw / 2 + 0.1));
    slab.rotation.x = s * 0.5;
  }
  box(g, hw * 2 + 0.5, 0.1, 0.14, post, 0, deckY + 1.72, 0);         // ridge cap

  // ---- Ladder up the front (+Z front side).
  for (const s of [-1, 1]) box(g, 0.07, deckY, 0.07, post, s * 0.35, deckY / 2 + 0.1, hw + 0.18);
  for (let i = 0; i < 5; i++) box(g, 0.78, 0.06, 0.06, post, 0, 0.4 + i * 0.42, hw + 0.18);

  // ---- "LIFEGUARD" flag pole on the roof.
  add(g, cylGeo(0.04, 0.04, 0.8, 6), post, 0, deckY + 2.1, 0);
  box(g, 0.5, 0.3, 0.04, red, 0.26, deckY + 2.35, 0);

  return g;
}

/* ------------------------------------------------------------------ *
 *  createBeachBarrel — a real 3D barrel: cylinder body with a bulged
 *  midsection, two hoop bands, top + bottom rims, and stave seams.
 *  Washed-up wooden look. Bottom-center origin; ~1.4 tall.
 * ------------------------------------------------------------------ */

export function createBeachBarrel() {
  const g = new THREE.Group();
  const wood = mat(0xa9733f, false, 'planks');
  const woodDk = mat(0x7a4f29);
  const hoop = mat(0x5b6670, true);                     // dark metal bands
  const rim = mat(0x8a8f96, true);

  const H = 1.3, r = 0.5, rBulge = 0.56;

  // ---- Body: a slightly bulged barrel built from three stacked cylinders
  //      (narrow / wide / narrow) so it has the classic barrel curve.
  add(g, cylGeo(rBulge, r, H * 0.36, 12), wood, 0, H * 0.18, 0);          // lower taper
  add(g, cylGeo(rBulge, rBulge, H * 0.3, 12), wood, 0, H * 0.5, 0);        // belly
  add(g, cylGeo(r, rBulge, H * 0.36, 12), wood, 0, H * 0.82, 0);          // upper taper

  // ---- Stave seams: thin vertical dark ribs around the belly.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI2;
    const seam = box(g, 0.03, H, 0.04, woodDk, Math.cos(a) * rBulge, H / 2, Math.sin(a) * rBulge);
    seam.rotation.y = -a;
  }

  // ---- Two hoop bands around the body + top/bottom rims.
  add(g, cylGeo(rBulge + 0.03, rBulge + 0.03, 0.1, 12), hoop, 0, H * 0.32, 0);
  add(g, cylGeo(rBulge + 0.03, rBulge + 0.03, 0.1, 12), hoop, 0, H * 0.68, 0);
  add(g, cylGeo(r + 0.04, r + 0.04, 0.08, 12), rim, 0, H - 0.02, 0);       // top rim
  add(g, cylGeo(r + 0.04, r + 0.04, 0.08, 12), rim, 0, 0.04, 0);          // bottom rim

  // ---- Top + bottom lids.
  add(g, cylGeo(r - 0.02, r - 0.02, 0.06, 12), woodDk, 0, H - 0.01, 0);
  add(g, cylGeo(r - 0.02, r - 0.02, 0.06, 12), woodDk, 0, 0.02, 0);
  // A little bung plug on top.
  add(g, cylGeo(0.07, 0.07, 0.06, 6), hoop, 0, H + 0.02, 0.2);

  return g;
}

/* ------------------------------------------------------------------ *
 *  createSandcastle — stacked sandy blocks/turrets with a flag on top
 *  and a little moat ring. Bottom-center origin; ~2.5 tall.
 * ------------------------------------------------------------------ */

export function createSandcastle() {
  const g = new THREE.Group();
  const sand = mat(COLORS.sand);
  const sandDk = mat(_tint(COLORS.sand, 0.82));
  const sandLt = mat(_tint(COLORS.sand, 1.1));
  const flagM = mat(0xe53935);
  const water = mat(COLORS.water);

  // ---- Moat ring (a thin water torus around the base).
  const moat = add(g, torusGeo(1.5, 0.18, 6, 16), water, 0, 0.06, 0);
  moat.rotation.x = Math.PI / 2;

  // ---- Base keep: a wide block with a darker rampart band.
  box(g, 1.5, 0.6, 1.5, sand, 0, 0.3, 0);
  box(g, 1.56, 0.12, 1.56, sandDk, 0, 0.56, 0);         // wall-top walkway
  // Crenellations along the top edges (little merlons).
  for (let i = -1; i <= 1; i++) {
    for (const sz of [-1, 1]) box(g, 0.2, 0.16, 0.2, sandLt, i * 0.5, 0.68, sz * 0.7);
    for (const sx of [-1, 1]) box(g, 0.2, 0.16, 0.2, sandLt, sx * 0.7, 0.68, i * 0.5);
  }
  // Arched doorway on the front.
  box(g, 0.34, 0.4, 0.06, sandDk, 0, 0.22, 0.76);

  // ---- Second tier (smaller block).
  box(g, 0.86, 0.5, 0.86, sand, 0, 0.85, 0);
  box(g, 0.9, 0.1, 0.9, sandDk, 0, 1.08, 0);

  // ---- Four corner turrets: cylinders capped with sandy cones.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tx = sx * 0.62, tz = sz * 0.62;
    add(g, cylGeo(0.18, 0.2, 0.9, 8), sandLt, tx, 0.45, tz);
    add(g, coneGeo(0.24, 0.3, 8), sandDk, tx, 0.95, tz);
  }
  // ---- Central tall turret + flag.
  add(g, cylGeo(0.22, 0.26, 0.7, 8), sandLt, 0, 1.4, 0);
  add(g, coneGeo(0.3, 0.34, 8), sandDk, 0, 1.85, 0);
  add(g, cylGeo(0.025, 0.025, 0.6, 6), mat(0x8d6e63), 0, 2.3, 0); // flag pole
  const flag = box(g, 0.34, 0.22, 0.03, flagM, 0.18, 2.45, 0);
  flag.castShadow = false;

  return g;
}

/* ------------------------------------------------------------------ *
 *  createBoat — a small fishing boat: hull + a small cabin + a mast.
 *  Bottom-center origin (keel at y≈0 so it floats with a little draft).
 *  ~3.4 long. Faces +Z (bow forward).
 * ------------------------------------------------------------------ */

export function createBoat() {
  const g = new THREE.Group();
  const hull = mat(0xb53f2e);                           // weathered red hull
  const hullLt = mat(0xd7e0e6);                         // white topside stripe
  const deck = mat(COLORS.wood, false, 'planks');
  const cabin = mat(0xf6f6f2);
  const trim = mat(0x1e88e5);
  const mastM = mat(COLORS.woodDark);

  // ---- Hull: a tapered box (pointed bow at +Z) + a sloped underside.
  box(g, 1.0, 0.5, 2.6, hull, 0, 0.35, -0.1);           // main hull
  box(g, 0.7, 0.5, 0.7, hull, 0, 0.35, 1.35);           // bow block
  box(g, 0.5, 0.4, 0.5, hull, 0, 0.28, 1.7);            // pointed bow tip
  box(g, 1.04, 0.12, 2.6, hullLt, 0, 0.56, -0.1);       // gunwale stripe
  // Deck floor inset.
  box(g, 0.8, 0.08, 2.2, deck, 0, 0.6, -0.1);

  // ---- Small cabin toward the stern.
  box(g, 0.7, 0.6, 0.8, cabin, 0, 0.92, -0.7);
  box(g, 0.74, 0.08, 0.84, trim, 0, 1.18, -0.7);        // cabin roof trim
  box(g, 0.4, 0.3, 0.05, mat(0x80d8ff), 0, 0.98, -0.28); // cabin window
  for (const s of [-1, 1]) box(g, 0.05, 0.3, 0.4, mat(0x80d8ff), s * 0.36, 0.98, -0.7); // side windows

  // ---- Mast + a small boom, with a tiny pennant.
  add(g, cylGeo(0.05, 0.06, 1.8, 6), mastM, 0, 1.5, 0.3);
  box(g, 0.05, 0.05, 0.9, mastM, 0, 1.9, 0.55);         // boom
  const flag = box(g, 0.04, 0.28, 0.4, trim, 0, 2.2, 0.2);
  flag.castShadow = false;

  // ---- A deck detail: a buoy ring.
  const buoy = add(g, torusGeo(0.16, 0.06, 5, 10), mat(0xffb300), 0.4, 0.7, 0.5);
  buoy.rotation.x = Math.PI / 2;

  return g;
}

/* ------------------------------------------------------------------ *
 *  createYacht — a sleeker, larger white yacht: long hull + multi-level
 *  cabin + railing. Bottom-center origin (waterline near y≈0). ~5.2 long.
 *  Faces +Z (bow forward).
 * ------------------------------------------------------------------ */

export function createYacht() {
  const g = new THREE.Group();
  const hull = mat(0xf6f6f2);                           // glossy white hull
  const hullDk = mat(0x37474f);                         // dark waterline / bottom
  const cabin = mat(0xeceff1);
  const glassM = mat(0x80d8ff);
  const trim = mat(0x1565c0);
  const teak = mat(COLORS.wood, false, 'planks');
  const railM = mat(0xcfd8dc);

  // ---- Long sleek hull: wide amidships, tapering to a sharp bow at +Z.
  box(g, 1.2, 0.4, 3.6, hullDk, 0, 0.25, -0.2);         // dark lower hull
  box(g, 1.24, 0.5, 3.6, hull, 0, 0.6, -0.2);           // white topsides
  box(g, 0.9, 0.5, 0.9, hull, 0, 0.6, 1.7);             // bow taper block
  box(g, 0.5, 0.5, 0.8, hull, 0, 0.56, 2.25);           // sharp bow
  box(g, 1.26, 0.1, 3.6, trim, 0, 0.5, -0.2);           // blue boot stripe

  // ---- Teak deck.
  box(g, 1.0, 0.08, 3.0, teak, 0, 0.86, -0.1);

  // ---- Multi-level superstructure (two stacked cabins) + a flybridge.
  box(g, 1.0, 0.6, 1.8, cabin, 0, 1.18, -0.4);          // main cabin
  box(g, 1.04, 0.34, 1.4, glassM, 0, 1.3, -0.3);        // wraparound windows
  box(g, 0.8, 0.5, 1.0, cabin, 0, 1.62, -0.6);          // upper deck
  box(g, 0.84, 0.28, 0.8, glassM, 0, 1.7, -0.5);        // upper windows
  box(g, 0.5, 0.3, 0.5, cabin, 0, 1.98, -0.7);          // flybridge helm
  // Radar arch + a small mast.
  for (const s of [-1, 1]) {
    const arch = box(g, 0.06, 0.5, 0.06, railM, s * 0.3, 2.2, -0.9);
    arch.rotation.z = s * -0.2;
  }
  box(g, 0.7, 0.06, 0.06, railM, 0, 2.42, -0.9);        // arch top
  add(g, cylGeo(0.04, 0.04, 0.6, 6), railM, 0, 2.7, -0.9); // antenna

  // ---- Bow railing (stanchions + a top rail) running forward.
  for (const z of [1.0, 1.4, 1.8]) {
    for (const s of [-1, 1]) box(g, 0.04, 0.34, 0.04, railM, s * 0.5, 1.0, z);
  }
  for (const s of [-1, 1]) box(g, 0.05, 0.05, 1.0, railM, s * 0.5, 1.16, 1.4);

  // ---- A little blue flag at the stern.
  add(g, cylGeo(0.035, 0.035, 0.7, 6), railM, 0, 1.2, -2.0);
  const flag = box(g, 0.04, 0.26, 0.4, trim, 0, 1.42, -2.18);
  flag.castShadow = false;

  return g;
}

/* ------------------------------------------------------------------ *
 *  createPalm — a palm tree: a gently curved trunk made of stacked
 *  ring segments, a crown of several drooping fronds, and a few
 *  coconuts. Bottom-center origin; ~5 tall.
 * ------------------------------------------------------------------ */

export function createPalm() {
  const g = new THREE.Group();
  const bark = mat(0xa6824c);
  const barkDk = mat(0x806035);
  const frond = mat(0x43a047);
  const frondDk = mat(0x2e7d32);
  const coco = mat(0x6d4c41);

  // ---- Curved trunk: stack short ring segments, each nudged in +Z and
  //      tilted a touch so the trunk leans/curves like a real palm. The
  //      crown pivot rides the top of the curve.
  const segH = 0.5, segs = 8;
  let cy = 0, cz = 0, lean = 0;
  let topY = 0, topZ = 0;
  for (let i = 0; i < segs; i++) {
    const r = 0.26 - i * 0.014;                         // taper upward
    const seg = add(g, cylGeo(r - 0.01, r, segH + 0.04, 8), i % 2 ? bark : barkDk,
      0, cy + segH / 2, cz);
    seg.rotation.x = -lean;                             // tilt forward (+Z)
    // Advance up the curve: more lean as we climb for the classic arc.
    lean += 0.06;
    cy += segH * Math.cos(lean);
    cz += segH * Math.sin(lean);
    topY = cy; topZ = cz;
  }

  // ---- Crown hub at the top of the trunk.
  const crown = pivot(g, 0, topY, topZ);
  add(crown, sphGeo(0.22, 8, 6), barkDk, 0, 0, 0);      // frond base knot

  // ---- Several drooping fronds radiating out + down.
  const nFronds = 7;
  for (let i = 0; i < nFronds; i++) {
    const a = (i / nFronds) * PI2;
    const frondG = pivot(crown, 0, 0, 0);
    frondG.rotation.y = a;
    frondG.rotation.x = 0.5;                            // droop downward
    // Each frond: a tapered midrib + a few leaflet blades.
    const midrib = box(frondG, 0.06, 0.06, 1.5, frondDk, 0, 0.0, 0.78);
    midrib.rotation.x = 0.25;
    for (let k = 1; k <= 4; k++) {
      const blade = box(frondG, 0.5 - k * 0.06, 0.03, 0.4, frond, 0, -0.05 * k, 0.35 * k);
      blade.rotation.x = 0.25;
    }
    // Drooping tip.
    box(frondG, 0.18, 0.03, 0.4, frond, 0, -0.32, 1.55).rotation.x = 0.7;
  }

  // ---- A small cluster of coconuts under the crown.
  for (const [dx, dz] of [[0.12, 0.12], [-0.12, 0.1], [0.02, -0.14]]) {
    add(crown, sphGeo(0.11, 6, 5), coco, dx, -0.18, dz);
  }

  return g;
}
