// MOO-FO — js/models.js (Agent M)
// Voxel model factories. Every factory returns a THREE.Group whose origin is at
// the BOTTOM-CENTER of the model (sits on the ground at position.y = 0).
// Characters face +Z. Animation joints are parent Groups positioned at the joint
// (hip / shoulder / neck) so rotating the userData object swings the limb.
// Materials are MeshLambertMaterial, bright + saturated — the night look comes
// from scene lighting, never from darkened materials.

import * as THREE from 'three';
import { CFG, COLORS, ENABLE_SHADOWS } from './config.js';

/* ------------------------------------------------------------------ *
 *  Shared cached materials & geometries
 * ------------------------------------------------------------------ */

const _matCache = new Map();

/** Cached MeshLambertMaterial by color (and flat-shading flag). */
export function mat(hex, flat = false) {
  const key = hex + (flat ? '|f' : '');
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: flat });
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
// Cylinder with its axis along X (for wheels, axles, hay bales).
function cylXGeo(r, h, seg = 8) {
  return _geo(`cx${r},${h},${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}
// Cylinder with its axis along Z (mailbox roof, windmill hub).
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
 *  createUFO — diameter ~5, height ~2.2
 *  userData: { dome, ring, lights: Mesh[], beamAnchor }
 * ------------------------------------------------------------------ */

export function createUFO() {
  const g = new THREE.Group();
  const metal = mat(COLORS.ufoBody, true);
  const metalDark = mat(0x6f7d92, true);

  // Beam emitter disc at the very bottom (glows).
  const emitter = add(g, cylGeo(0.7, 0.88, 0.18, 10),
    emat(COLORS.beam, COLORS.beam, 0.9, true), 0, 0.09, 0);
  emitter.castShadow = false;

  // Underside hub (inverted cone) + concentric detail rings + greebles.
  add(g, cylGeo(1.4, 0.62, 0.55, 10), metalDark, 0, 0.5, 0);
  add(g, cylGeo(1.95, 1.85, 0.14, 12), metalDark, 0, 0.45, 0);
  add(g, cylGeo(1.32, 1.2, 0.12, 10), metalDark, 0, 0.3, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    box(g, 0.32, 0.2, 0.32, i % 2 ? metalDark : mat(0x55607a),
      Math.cos(a) * 1.55, 0.48, Math.sin(a) * 1.55).rotation.y = -a;
  }

  // Saucer body — flattened low-poly sphere lens.
  const body = add(g, sphGeo(2.5, 10, 6), metal, 0, 1.0, 0);
  body.scale.set(1, 0.32, 1);

  // Rim ring (counter-rotated by ufo.js) carrying evenly spaced light bulbs.
  const ring = pivot(g, 0, 1.0, 0);
  const torus = add(ring, _geo('ufoTorus', () => new THREE.TorusGeometry(2.55, 0.18, 6, 14)),
    mat(0x7a8696, true), 0, 0, 0);
  torus.rotation.x = Math.PI / 2;
  const lights = [];
  const N_BULBS = 10;
  for (let i = 0; i < N_BULBS; i++) {
    const a = (i / N_BULBS) * Math.PI * 2;
    // Each bulb gets its OWN material so main.js can blink them individually.
    const bm = new THREE.MeshLambertMaterial({
      color: COLORS.ufoGlow,
      emissive: COLORS.ufoGlow,
      emissiveIntensity: 1.0,
      flatShading: true,
    });
    const b = add(ring, sphGeo(0.15, 6, 4), bm, Math.cos(a) * 2.62, -0.05, Math.sin(a) * 2.62);
    b.castShadow = false;
    lights.push(b);
  }

  // Dome collar trim.
  add(g, cylGeo(1.22, 1.32, 0.16, 10), metalDark, 0, 1.5, 0);

  // Tiny alien pilot silhouette inside the dome.
  const alien = pivot(g, 0, 1.45, 0);
  const green = mat(0x3a7d44, true);
  add(alien, cylGeo(0.16, 0.26, 0.3, 7), green, 0, 0.13, 0);            // body
  const aHead = add(alien, sphGeo(0.24, 7, 5), green, 0, 0.45, 0);      // big head
  aHead.scale.set(1, 1.15, 0.95);
  box(alien, 0.09, 0.13, 0.04, mat(0x101418), -0.1, 0.48, 0.21);        // left eye
  box(alien, 0.09, 0.13, 0.04, mat(0x101418), 0.1, 0.48, 0.21);        // right eye
  box(alien, 0.03, 0.16, 0.03, green, 0, 0.78, 0);                      // antenna
  const aTip = box(alien, 0.07, 0.07, 0.07, emat(COLORS.uiPurple, COLORS.uiPurple, 0.9), 0, 0.88, 0);
  aTip.rotation.set(0.6, 0.6, 0);
  aTip.castShadow = false;

  // Tinted, slightly transparent glass dome (unique material — ufo.js may pulse it).
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

  // Body.
  const body = box(g, 1.0, 0.74, 1.42, bodyMat, 0, 1.0, 0);
  box(g, 0.9, 0.6, 0.3, bodyMat, 0, 1.02, 0.78);   // chest
  box(g, 0.86, 0.56, 0.22, bodyMat, 0, 1.04, -0.78); // rump

  // Holstein / brown patch boxes (thin boxes proud of the body).
  if (!golden) {
    const patch = brown ? mat(0xa9714b) : darkMat;
    box(g, 0.08, 0.42, 0.52, patch, -0.5, 1.06, 0.18);
    box(g, 0.08, 0.36, 0.4, patch, -0.5, 0.92, -0.42);
    box(g, 0.08, 0.46, 0.6, patch, 0.5, 1.0, -0.12);
    box(g, 0.52, 0.08, 0.5, patch, 0.12, 1.38, -0.3);
    box(g, 0.4, 0.08, 0.34, patch, -0.18, 1.38, 0.4);
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

  // Tail — pivot at the base, hangs down, tuft at the end.
  const tail = pivot(g, 0, 1.32, -0.74);
  const tailSeg = box(tail, 0.09, 0.5, 0.09, bodyMat, 0, -0.24, -0.06);
  tailSeg.rotation.x = 0.18;
  box(tail, 0.15, 0.2, 0.15, darkMat, 0, -0.52, -0.12);

  // Head — pivot at the neck; nods with rotation.x.
  const head = pivot(g, 0, 1.25, 0.66);
  box(head, 0.62, 0.54, 0.5, bodyMat, 0, 0.12, 0.22);
  if (!golden && !brown) box(head, 0.24, 0.26, 0.05, darkMat, 0.17, 0.18, 0.455); // eye patch
  // Snout + nostrils.
  box(head, 0.46, 0.28, 0.24, pinkMat, 0, -0.06, 0.5);
  box(head, 0.06, 0.09, 0.05, mat(0x8c4a5a), -0.12, -0.04, 0.61);
  box(head, 0.06, 0.09, 0.05, mat(0x8c4a5a), 0.12, -0.04, 0.61);
  // Eyes.
  box(head, 0.07, 0.12, 0.05, mat(0x14110e), -0.19, 0.2, 0.46);
  box(head, 0.07, 0.12, 0.05, mat(0x14110e), 0.19, 0.2, 0.46);
  // Ears with pink inner ears.
  for (const s of [-1, 1]) {
    const ear = box(head, 0.26, 0.13, 0.18, bodyMat, s * 0.42, 0.3, 0.12);
    ear.rotation.z = s * 0.35;
    const inner = box(head, 0.16, 0.06, 0.11, pinkMat, s * 0.45, 0.27, 0.13);
    inner.rotation.z = s * 0.35;
  }
  // Horns.
  for (const s of [-1, 1]) {
    const horn = box(head, 0.1, 0.2, 0.1, hornMat, s * 0.2, 0.44, 0.1);
    horn.rotation.z = s * -0.35;
  }
  // Forelock tuft.
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
 *  createFarmer — variant 0|1|2 (shirt/hat colors). ~2 tall.
 *  userData: { head, arms: [l, r], legs: [l, r], gun, gunTip }
 *  Arms pivot at shoulders, legs at hips, head at neck. Gun is parented
 *  to the right arm; raising arms[1] (rotation.x = -PI/2) aims forward.
 * ------------------------------------------------------------------ */

export function createFarmer(variant = 0) {
  const g = new THREE.Group();
  const v = ((variant % 3) + 3) % 3;
  const shirtHex = [COLORS.shirt, 0x43a047, 0x7e57c2][v];
  const cuffHex = [0xef7c4a, 0x66bb6a, 0x9575cd][v];
  const hatHex = [COLORS.straw, 0x8d6e63, 0x546e7a][v];
  const beardHex = [0x6d4c41, 0x8d8d8d, 0x4e342e][v];
  const shirt = mat(shirtHex);
  const cuff = mat(cuffHex);
  const denim = mat(COLORS.denim);
  const skin = mat(COLORS.skin);
  const boot = mat(0x4e342e);

  // Legs — pivot at the hips. [left(+X), right(-X)]
  const legL = pivot(g, 0.17, 0.98, 0);
  const legR = pivot(g, -0.17, 0.98, 0);
  for (const leg of [legL, legR]) {
    box(leg, 0.27, 0.82, 0.29, denim, 0, -0.45, 0);
    box(leg, 0.3, 0.18, 0.42, boot, 0, -0.89, 0.05); // boot with toe
    box(leg, 0.32, 0.08, 0.3, boot, 0, -0.82, -0.02); // boot cuff
  }

  // Hips + torso.
  box(g, 0.72, 0.32, 0.46, denim, 0, 1.06, 0);
  box(g, 0.78, 0.62, 0.5, shirt, 0, 1.43, 0);
  // Overalls bib, straps, gold buttons.
  box(g, 0.5, 0.42, 0.1, denim, 0, 1.42, 0.26);
  for (const s of [-1, 1]) {
    const strap = box(g, 0.11, 0.38, 0.07, denim, s * 0.17, 1.63, 0.24);
    strap.rotation.x = -0.12;
    box(g, 0.11, 0.07, 0.34, denim, s * 0.17, 1.76, 0.05);            // over the shoulder
    const btn = box(g, 0.07, 0.07, 0.05, emat(COLORS.gold, 0xc79a1e, 0.25), s * 0.17, 1.56, 0.32);
    btn.castShadow = false;
  }

  // Arms — pivot at the shoulders. [left(+X), right(-X)]
  const arms = [];
  for (const s of [1, -1]) {
    const arm = pivot(g, s * 0.47, 1.66, 0);
    box(arm, 0.21, 0.36, 0.23, shirt, 0, -0.18, 0);   // upper arm (sleeve)
    box(arm, 0.25, 0.11, 0.27, cuff, 0, -0.38, 0);    // rolled cuff
    box(arm, 0.18, 0.3, 0.2, skin, 0, -0.58, 0);     // bare forearm
    box(arm, 0.2, 0.16, 0.2, skin, 0, -0.8, 0.02);  // hand
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
  box(gun, 0.13, 0.15, 0.34, mat(0x546e7a), 0, 0.02, 0);              // receiver
  box(gun, 0.1, 0.1, 0.26, mat(COLORS.wood), 0, -0.06, 0.32);        // fore-grip
  for (const s of [-1, 1]) {                                            // twin barrels
    const barrel = add(gun, cylGeo(0.045, 0.045, 0.72, 6), gunMetal, s * 0.05, 0.06, 0.5);
    barrel.rotation.x = Math.PI / 2;
  }
  box(gun, 0.17, 0.07, 0.07, gunMetal, 0, 0.06, 0.78);                // barrel band
  const gunTip = new THREE.Object3D();
  gunTip.position.set(0, 0.06, 0.88);
  gun.add(gunTip);

  // Head — pivot at the neck.
  const head = pivot(g, 0, 1.76, 0);
  box(head, 0.46, 0.42, 0.42, skin, 0, 0.23, 0);
  box(head, 0.07, 0.1, 0.04, mat(0x14110e), -0.11, 0.3, 0.215);       // eyes
  box(head, 0.07, 0.1, 0.04, mat(0x14110e), 0.11, 0.3, 0.215);
  box(head, 0.09, 0.1, 0.08, mat(0xdda575), 0, 0.22, 0.24);           // nose
  box(head, 0.38, 0.16, 0.12, mat(beardHex), 0, 0.08, 0.19);          // beard
  box(head, 0.3, 0.07, 0.06, mat(beardHex), 0, 0.17, 0.235);          // mustache
  // Brimmed hat.
  box(head, 0.68, 0.06, 0.64, mat(hatHex), 0, 0.46, 0);
  box(head, 0.38, 0.22, 0.36, mat(hatHex), 0, 0.58, 0);
  box(head, 0.4, 0.07, 0.38, mat(0x8a3324), 0, 0.51, 0);              // hat band

  g.userData = { head, arms: [armL, armR], legs: [legL, legR], gun, gunTip };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createChicken — ~0.55 tall. userData: { head, wings: [l, r] }
 * ------------------------------------------------------------------ */

export function createChicken() {
  const g = new THREE.Group();
  const white = mat(0xfafafa);
  const orange = mat(0xffa726);
  const red = mat(0xe53935);

  // Legs + feet.
  for (const s of [-1, 1]) {
    box(g, 0.05, 0.14, 0.05, orange, s * 0.06, 0.07, 0);
    box(g, 0.09, 0.03, 0.12, orange, s * 0.06, 0.015, 0.04);
  }

  // Body + breast + tail.
  box(g, 0.3, 0.25, 0.4, white, 0, 0.26, 0);
  box(g, 0.24, 0.17, 0.1, white, 0, 0.23, 0.23);
  const tail = box(g, 0.14, 0.21, 0.12, white, 0, 0.4, -0.21);
  tail.rotation.x = 0.5;

  // Wings — pivot at the top (shoulder), rotation.z flaps them out.
  const wings = [];
  for (const s of [1, -1]) {
    const wing = pivot(g, s * 0.16, 0.36, -0.02);
    box(wing, 0.05, 0.16, 0.26, white, s * 0.02, -0.09, 0);
    wings.push(wing);
  }

  // Head — pivot at the neck; pecks with rotation.x.
  const head = pivot(g, 0, 0.36, 0.14);
  box(head, 0.19, 0.21, 0.17, white, 0, 0.1, 0.04);
  box(head, 0.04, 0.06, 0.04, mat(0x14110e), -0.05, 0.13, 0.13);      // eyes
  box(head, 0.04, 0.06, 0.04, mat(0x14110e), 0.05, 0.13, 0.13);
  box(head, 0.06, 0.05, 0.11, orange, 0, 0.08, 0.17);                 // beak
  box(head, 0.04, 0.08, 0.04, red, 0, 0.0, 0.14);                     // wattle
  box(head, 0.04, 0.08, 0.09, red, 0, 0.24, 0.04);                    // comb
  box(head, 0.04, 0.06, 0.05, red, 0, 0.22, 0.11);

  g.userData = { head, wings };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createTree — 0 oak | 1 pine | 2 poplar. Distinct silhouettes.
 * ------------------------------------------------------------------ */

export function createTree(type = 0) {
  const g = new THREE.Group();
  const t = ((type % 3) + 3) % 3;
  if (t === 0) {
    // Oak — fat trunk, stacked rounded canopy.
    box(g, 0.55, 1.9, 0.55, mat(COLORS.wood), 0, 0.95, 0);
    box(g, 0.5, 0.3, 0.2, mat(COLORS.wood), 0.35, 1.6, 0).rotation.z = -0.5; // branch
    box(g, 2.6, 1.5, 2.6, mat(COLORS.grassB), 0, 2.6, 0);
    box(g, 2.0, 1.2, 2.0, mat(COLORS.grassC), 0, 3.75, 0);
    box(g, 1.2, 0.9, 1.2, mat(COLORS.grassA), 0, 4.7, 0);
  } else if (t === 1) {
    // Pine — stacked cones.
    box(g, 0.45, 1.4, 0.45, mat(COLORS.woodDark), 0, 0.7, 0);
    const pine = mat(0x2e7d32, true);
    add(g, coneGeo(1.9, 2.6, 7), pine, 0, 2.5, 0);
    add(g, coneGeo(1.45, 2.2, 7), pine, 0, 4.15, 0);
    add(g, coneGeo(0.95, 1.8, 7), mat(0x388e3c, true), 0, 5.6, 0);
    add(g, coneGeo(0.45, 1.0, 6), mat(0x43a047, true), 0, 6.8, 0);
  } else {
    // Poplar — tall and slim.
    box(g, 0.4, 1.5, 0.4, mat(COLORS.wood), 0, 0.75, 0);
    box(g, 1.35, 2.2, 1.35, mat(0x66bb6a), 0, 2.5, 0);
    box(g, 1.1, 2.2, 1.1, mat(COLORS.grassC), 0, 4.6, 0);
    box(g, 0.85, 1.9, 0.85, mat(0x66bb6a), 0, 6.5, 0);
    box(g, 0.5, 1.2, 0.5, mat(COLORS.grassA), 0, 7.9, 0);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBush — 0|1, ~0.8–1.4
 * ------------------------------------------------------------------ */

export function createBush(type = 0) {
  const g = new THREE.Group();
  if (((type % 2) + 2) % 2 === 0) {
    // Boxy berry bush cluster.
    box(g, 0.95, 0.7, 0.95, mat(COLORS.grassB), 0, 0.35, 0);
    box(g, 0.6, 0.5, 0.6, mat(COLORS.grassC), 0.42, 0.32, 0.26);
    box(g, 0.5, 0.45, 0.5, mat(COLORS.grassA), -0.36, 0.4, -0.2);
    box(g, 0.09, 0.09, 0.09, mat(0xe53935), 0.25, 0.68, 0.34);
    box(g, 0.08, 0.08, 0.08, mat(0xe53935), -0.2, 0.6, 0.42);
  } else {
    // Round flowering blob.
    const blob = add(g, sphGeo(0.7, 7, 5), mat(COLORS.grassC, true), 0, 0.6, 0);
    blob.scale.set(1, 0.85, 1);
    add(g, sphGeo(0.4, 6, 4), mat(COLORS.grassB, true), 0.5, 0.38, 0.2);
    box(g, 0.1, 0.1, 0.1, mat(0xffe082), -0.15, 1.12, 0.15);
    box(g, 0.09, 0.09, 0.09, mat(0xf48fb1), 0.3, 0.95, -0.28);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createRock — 0|1|2
 * ------------------------------------------------------------------ */

export function createRock(type = 0) {
  const g = new THREE.Group();
  const t = ((type % 3) + 3) % 3;
  const stone = mat(COLORS.stone, true);
  if (t === 0) {
    const a = box(g, 0.85, 0.55, 0.7, mat(COLORS.stone), 0, 0.26, 0);
    a.rotation.y = 0.4;
    const b = box(g, 0.45, 0.35, 0.4, mat(0xb4b4b4), 0.38, 0.17, 0.22);
    b.rotation.y = -0.3;
  } else if (t === 1) {
    const a = add(g, icoGeo(0.55), stone, 0, 0.4, 0);
    a.scale.set(1.1, 0.8, 1);
    a.rotation.set(0.3, 0.8, 0.1);
    add(g, icoGeo(0.28), mat(0xb4b4b4, true), -0.5, 0.2, 0.15).rotation.y = 1.2;
  } else {
    const a = box(g, 1.15, 0.32, 0.9, mat(COLORS.stone), 0, 0.16, 0);
    a.rotation.y = 0.25;
    const b = box(g, 0.7, 0.28, 0.6, mat(0xb4b4b4), 0.1, 0.43, -0.05);
    b.rotation.y = -0.35;
    box(g, 0.4, 0.07, 0.35, mat(0x6aa84f), -0.05, 0.6, 0.02); // mossy cap
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBarn — ~12 x 9 x 10 (w x h x d). Front gable faces +Z.
 * ------------------------------------------------------------------ */

export function createBarn() {
  const g = new THREE.Group();
  const red = mat(COLORS.barnRed);
  const trim = mat(COLORS.barnTrim);
  const roof = mat(COLORS.roof);
  const dark = mat(0x3a2a22);

  // Walls: lower + gambrel mid + upper stories (stepped under the roof).
  box(g, 12, 4.6, 10, red, 0, 2.3, 0);
  box(g, 9.2, 2.4, 10, red, 0, 5.7, 0);
  box(g, 4.0, 1.0, 10, red, 0, 7.4, 0);

  // Gambrel roof panels (steep lower, shallow upper) + ridge cap.
  for (const s of [-1, 1]) {
    const lower = box(g, 3.0, 0.18, 10.8, roof, s * 5.4, 5.75, 0);
    lower.rotation.z = -s * 0.99;
    const upper = box(g, 5.1, 0.18, 10.8, roof, s * 2.3, 7.9, 0);
    upper.rotation.z = -s * 0.382;
  }
  box(g, 0.6, 0.3, 11.0, roof, 0, 8.9, 0); // roof ridge

  // White trim: corner boards + horizontal band.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(g, 0.35, 4.6, 0.35, trim, sx * 5.95, 2.3, sz * 4.95);
    }
  }
  box(g, 12.3, 0.28, 0.28, trim, 0, 4.62, 5.0);
  box(g, 12.3, 0.28, 0.28, trim, 0, 4.62, -5.0);
  box(g, 0.28, 0.28, 10.3, trim, 6.0, 4.62, 0);
  box(g, 0.28, 0.28, 10.3, trim, -6.0, 4.62, 0);

  // Big double doors with white frame + X-braces.
  box(g, 4.1, 3.95, 0.16, trim, 0, 1.97, 5.0);
  for (const s of [-1, 1]) {
    box(g, 1.8, 3.6, 0.14, mat(COLORS.woodDark), s * 0.93, 1.8, 5.12);
    box(g, 1.8, 0.15, 0.06, trim, s * 0.93, 3.45, 5.21);
    box(g, 1.8, 0.15, 0.06, trim, s * 0.93, 0.2, 5.21);
    for (const d of [-1, 1]) {
      const brace = box(g, 0.16, 3.85, 0.06, trim, s * 0.93, 1.8, 5.2);
      brace.rotation.z = d * 0.464;
    }
  }

  // Hayloft window with frame, hay tuft and hoist beam + rope.
  box(g, 1.9, 1.9, 0.15, trim, 0, 6.2, 5.02);
  box(g, 1.45, 1.45, 0.16, dark, 0, 6.2, 5.06);
  box(g, 1.1, 0.32, 0.36, mat(COLORS.straw), 0, 5.5, 5.22);
  box(g, 0.22, 0.22, 1.5, mat(COLORS.woodDark), 0, 7.6, 5.4);
  box(g, 0.05, 0.9, 0.05, dark, 0, 7.1, 6.05);
  box(g, 0.18, 0.14, 0.18, mat(0x55606a), 0, 6.6, 6.05); // pulley block

  // Side windows (both sides, two each).
  for (const sx of [-1, 1]) {
    for (const z of [-2.6, 2.6]) {
      box(g, 0.16, 1.15, 1.15, trim, sx * 6.02, 3.0, z);
      box(g, 0.14, 0.88, 0.88, mat(0x2c3550), sx * 6.08, 3.0, z);
    }
  }

  // Weather vane on the ridge.
  box(g, 0.07, 0.85, 0.07, dark, 0, 9.45, 0);
  box(g, 0.75, 0.06, 0.06, dark, 0, 9.75, 0);
  box(g, 0.16, 0.22, 0.09, dark, 0, 9.92, 0);          // rooster body
  box(g, 0.05, 0.1, 0.05, mat(0xe53935), 0, 10.06, 0); // comb

  return g;
}

/* ------------------------------------------------------------------ *
 *  createFarmhouse — ~10 x 8 x 8 with porch, chimney, lit windows.
 *  Front (porch) faces +Z. Roof ridge runs along X.
 * ------------------------------------------------------------------ */

export function createFarmhouse() {
  const g = new THREE.Group();
  const wall = mat(COLORS.barnTrim);
  const white = mat(0xffffff);
  const roof = mat(COLORS.roof);
  const wood = mat(COLORS.wood);
  const woodD = mat(COLORS.woodDark);
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
  box(g, 11.2, 0.28, 0.6, roof, 0, 6.75, 0);

  // Chimney on the rear slope.
  box(g, 0.9, 2.9, 0.9, mat(COLORS.stone), 3.0, 6.5, -1.2);
  box(g, 1.15, 0.25, 1.15, mat(0x8a8a8a), 3.0, 8.0, -1.2);
  box(g, 0.5, 0.14, 0.5, mat(0x2b2b2b), 3.0, 8.12, -1.2);

  // Warm emissive windows with white frames + cross mullions.
  const windowAt = (x, y, z, ry = 0) => {
    const w = pivot(g, x, y, z);
    w.rotation.y = ry;
    box(w, 1.3, 1.5, 0.12, white, 0, 0, 0);
    const pane = box(w, 1.0, 1.2, 0.12, glow, 0, 0, 0.04);
    pane.castShadow = false;
    box(w, 0.09, 1.2, 0.1, white, 0, 0, 0.08);
    box(w, 1.0, 0.09, 0.1, white, 0, 0, 0.08);
    box(w, 1.5, 0.12, 0.2, white, 0, -0.81, 0.04); // sill
  };
  windowAt(-3.0, 2.0, 3.52);
  windowAt(3.0, 2.0, 3.52);
  windowAt(-2.2, 3.78, 3.52);
  windowAt(2.2, 3.78, 3.52);
  windowAt(-5.02, 2.2, 0, Math.PI / 2);
  windowAt(5.02, 2.2, 0, -Math.PI / 2);

  // Front door (sits on the porch floor) with frame + knob + porch lantern.
  box(g, 1.4, 2.4, 0.1, white, 0, 1.6, 3.52);
  box(g, 1.1, 2.2, 0.12, woodD, 0, 1.55, 3.56);
  box(g, 0.09, 0.09, 0.07, emat(COLORS.gold, 0xc79a1e, 0.3), 0.38, 1.5, 3.63);
  const lantern = box(g, 0.18, 0.26, 0.14, emat(0xffd98c, 0xffa040, 1.0), 1.0, 2.45, 3.6);
  lantern.castShadow = false;

  // Porch: floor, steps, posts, roof, railing with balusters.
  box(g, 7.2, 0.3, 2.6, wood, 0, 0.3, 4.7);
  box(g, 2.0, 0.18, 0.55, wood, 0, 0.26, 6.2);
  box(g, 2.0, 0.18, 0.55, wood, 0, 0.09, 6.7);
  for (const x of [-3.3, -1.15, 1.15, 3.3]) {
    box(g, 0.18, 2.2, 0.18, white, x, 1.55, 5.7);
  }
  const proof = box(g, 7.8, 0.16, 3.0, roof, 0, 2.78, 4.7);
  proof.rotation.x = 0.1;
  for (const s of [-1, 1]) {
    box(g, 2.7, 0.1, 0.1, white, s * 2.1, 1.05, 5.72); // top rails (door gap)
    for (const x of [-3.0, -2.2, -1.4, 1.4, 2.2, 3.0]) {
      if (Math.sign(x) === s) box(g, 0.07, 0.5, 0.07, white, x, 0.75, 5.72);
    }
    box(g, 0.1, 0.1, 2.2, white, s * 3.45, 1.05, 4.75); // side rails
  }

  return g;
}

/* ------------------------------------------------------------------ *
 *  createSilo — r ~2.5, h ~12, dome cap.
 * ------------------------------------------------------------------ */

export function createSilo() {
  const g = new THREE.Group();
  const body = mat(0xb9c4cf, true);
  const band = mat(0x93a0ad, true);

  add(g, cylGeo(2.5, 2.5, 10, 10), body, 0, 5, 0);
  for (const y of [2.5, 5, 7.5]) {
    add(g, cylGeo(2.56, 2.56, 0.18, 10), band, 0, y, 0);
  }
  const cap = add(g, domeGeo(2.5, 10, 5), mat(COLORS.ufoBody, true), 0, 10, 0);
  cap.scale.set(1, 0.72, 1);
  // Top vent.
  add(g, cylGeo(0.3, 0.3, 0.5, 6), band, 0, 11.9, 0);
  add(g, coneGeo(0.45, 0.4, 6), mat(0x78909c, true), 0, 12.3, 0);
  // Ladder up the front.
  for (const s of [-1, 1]) {
    box(g, 0.07, 9.2, 0.07, mat(0x6f7d92), s * 0.32, 4.7, 2.48);
  }
  for (let i = 0; i < 8; i++) {
    box(g, 0.7, 0.06, 0.06, mat(0x6f7d92), 0, 1.1 + i * 1.1, 2.48);
  }
  // Hatch door at the base.
  box(g, 0.9, 1.3, 0.15, mat(0x55606a), 0, 0.7, 2.42);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createWindmill — ~11 tall lattice windmill. userData: { blades }
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
  // Lattice girdles at two heights.
  for (const [y, hw] of [[3, 1.06], [6, 0.71]]) {
    box(g, hw * 2 + 0.2, 0.09, 0.09, steel, 0, y, hw);
    box(g, hw * 2 + 0.2, 0.09, 0.09, steel, 0, y, -hw);
    box(g, 0.09, 0.09, hw * 2 + 0.2, steel, hw, y, 0);
    box(g, 0.09, 0.09, hw * 2 + 0.2, steel, -hw, y, 0);
  }
  // Platform + gear head.
  box(g, 1.7, 0.16, 1.7, mat(COLORS.wood), 0, 9.05, 0);
  box(g, 0.8, 0.8, 1.05, steel, 0, 9.65, 0);
  box(g, 0.9, 0.14, 1.15, light, 0, 10.1, 0);
  // Tail vane.
  box(g, 0.08, 0.08, 1.4, steel, 0, 9.7, -1.1);
  box(g, 0.06, 0.75, 0.9, mat(0xe05348), 0, 9.85, -1.75);

  // Blade wheel at the hub (front), 6 sails.
  const blades = pivot(g, 0, 9.7, 0.68);
  add(blades, cylZGeo(0.2, 0.3, 8), mat(0x55606a, true), 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const sail = pivot(blades, 0, 0, 0);
    sail.rotation.z = (i / 6) * Math.PI * 2;
    box(sail, 0.09, 2.1, 0.06, steel, 0, 1.05, 0);
    const plate = box(sail, 0.42, 1.35, 0.05, light, 0, 1.5, 0.05);
    plate.rotation.y = 0.35;
  }

  g.userData = { blades };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createWell — stone ring + roof + crank.
 * ------------------------------------------------------------------ */

export function createWell() {
  const g = new THREE.Group();
  const stone = mat(COLORS.stone, true);
  const wood = mat(COLORS.wood);

  add(g, cylGeo(0.88, 0.98, 0.75, 8), stone, 0, 0.375, 0);
  const water = add(g, cylGeo(0.72, 0.72, 0.06, 8), mat(COLORS.waterDeep, true), 0, 0.72, 0);
  water.castShadow = false;
  // A few proud stones for texture.
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + 0.4;
    const s = box(g, 0.34, 0.26, 0.2, mat(0xb4b4b4), Math.cos(a) * 0.92, 0.3 + (i % 2) * 0.22, Math.sin(a) * 0.92);
    s.rotation.y = -a;
  }
  // Posts + little gable roof.
  for (const s of [-1, 1]) {
    box(g, 0.15, 1.55, 0.15, mat(COLORS.woodDark), s * 0.85, 1.35, 0);
  }
  for (const s of [-1, 1]) {
    const slab = box(g, 2.3, 0.1, 1.05, wood, 0, 2.3, s * 0.4);
    slab.rotation.x = s * 0.55;
  }
  box(g, 2.4, 0.14, 0.22, mat(COLORS.woodDark), 0, 2.56, 0);
  // Crank axle, handle, rope and bucket.
  add(g, cylXGeo(0.07, 1.9, 6), mat(COLORS.woodDark), 0, 1.62, 0);
  box(g, 0.07, 0.3, 0.07, mat(COLORS.woodDark), 0.99, 1.5, 0);
  box(g, 0.07, 0.07, 0.3, mat(0x4e342e), 0.99, 1.36, 0.12);
  box(g, 0.05, 0.55, 0.05, mat(0x6d5a45), 0, 1.35, 0);
  box(g, 0.28, 0.24, 0.28, wood, 0, 0.97, 0);
  box(g, 0.22, 0.05, 0.22, mat(0x3a2a22), 0, 1.1, 0);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createScarecrow — post + shirt + straw hat (+ resident crow).
 * ------------------------------------------------------------------ */

export function createScarecrow() {
  const g = new THREE.Group();
  const shirt = mat(0x7e57c2);
  const stripe = mat(0x9575cd);
  const straw = mat(COLORS.straw);

  box(g, 0.14, 1.6, 0.14, mat(COLORS.woodDark), 0, 0.8, 0);
  // Torso with stripes and a patch.
  box(g, 0.56, 0.62, 0.32, shirt, 0, 1.5, 0);
  box(g, 0.58, 0.08, 0.34, stripe, 0, 1.62, 0);
  box(g, 0.58, 0.08, 0.34, stripe, 0, 1.4, 0);
  box(g, 0.18, 0.18, 0.04, mat(COLORS.denim), 0.12, 1.45, 0.17);
  // Cross arms with straw poking out of the sleeves.
  for (const s of [-1, 1]) {
    box(g, 0.55, 0.18, 0.18, shirt, s * 0.55, 1.66, 0);
    const tuft = box(g, 0.13, 0.26, 0.13, straw, s * 0.86, 1.66, 0);
    tuft.rotation.z = s * 1.35;
  }
  // Straw skirt at the base of the torso.
  for (const [dx, rz] of [[-0.14, 0.25], [0.02, -0.1], [0.16, -0.3]]) {
    const wisp = box(g, 0.1, 0.34, 0.1, straw, dx, 1.1, 0.03);
    wisp.rotation.z = rz;
  }
  // Burlap head with stitched face.
  box(g, 0.4, 0.4, 0.36, mat(COLORS.sand), 0, 2.02, 0);
  box(g, 0.07, 0.07, 0.04, mat(0x3a2a22), -0.1, 2.08, 0.185);
  box(g, 0.07, 0.07, 0.04, mat(0x3a2a22), 0.1, 2.08, 0.185);
  box(g, 0.16, 0.04, 0.04, mat(0x3a2a22), 0, 1.92, 0.185);
  // Straw hat.
  box(g, 0.62, 0.06, 0.58, straw, 0, 2.24, 0);
  box(g, 0.34, 0.2, 0.32, straw, 0, 2.36, 0);
  // A cheeky crow perched on the arm.
  box(g, 0.14, 0.13, 0.2, mat(0x1c1c22), 0.62, 1.82, 0);
  box(g, 0.1, 0.1, 0.09, mat(0x1c1c22), 0.62, 1.93, 0.1);
  box(g, 0.04, 0.04, 0.07, mat(0xffa726), 0.62, 1.92, 0.17);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createTractor — ~3.5 long, faces +Z. userData: { wheels: Mesh[] }
 *  Wheel geometry axis is X — spin with wheel.rotation.x.
 * ------------------------------------------------------------------ */

export function createTractor() {
  const g = new THREE.Group();
  const green = mat(0x2f9e44);
  const dark = mat(0x263238);

  // Chassis + engine hood + grill + headlights.
  box(g, 1.1, 0.5, 2.6, green, 0, 0.95, 0);
  box(g, 0.9, 0.55, 1.3, green, 0, 1.32, 0.6);
  box(g, 0.8, 0.42, 0.12, mat(0x55606a), 0, 1.28, 1.28);
  for (const s of [-1, 1]) {
    const hl = box(g, 0.16, 0.14, 0.07, emat(0xffe3a1, 0xffb547, 0.8), s * 0.25, 1.36, 1.34);
    hl.castShadow = false;
  }
  // Exhaust stack with muffler.
  add(g, cylGeo(0.06, 0.06, 0.8, 6), dark, 0.28, 1.95, 0.5);
  add(g, cylGeo(0.1, 0.1, 0.22, 6), dark, 0.28, 2.3, 0.5);
  // Seat + backrest + steering wheel on a column.
  box(g, 0.5, 0.12, 0.5, dark, 0, 1.28, -0.72);
  box(g, 0.5, 0.5, 0.12, dark, 0, 1.56, -0.98);
  const column = box(g, 0.07, 0.4, 0.07, dark, 0, 1.42, -0.18);
  column.rotation.x = 0.5;
  const wheelRim = add(g, cylGeo(0.19, 0.19, 0.05, 8), dark, 0, 1.62, -0.28);
  wheelRim.rotation.x = 0.5;
  // Rear fenders.
  for (const s of [-1, 1]) {
    box(g, 0.3, 0.12, 1.15, green, s * 0.78, 1.52, -0.62);
  }
  // Wheels: two big rear, two small front (+ hub caps as children).
  const wheels = [];
  const wheelAt = (x, y, z, r, w) => {
    const m = add(g, cylXGeo(r, w, 10), mat(0x263238, true), x, y, z);
    const hub = new THREE.Mesh(cylXGeo(r * 0.42, w + 0.04, 8), emat(COLORS.gold, 0xc79a1e, 0.15, true));
    applyShadows(hub);
    m.add(hub);
    wheels.push(m);
    return m;
  };
  wheelAt(-0.78, 0.74, -0.62, 0.74, 0.4);
  wheelAt(0.78, 0.74, -0.62, 0.74, 0.4);
  wheelAt(-0.62, 0.42, 0.95, 0.42, 0.28);
  wheelAt(0.62, 0.42, 0.95, 0.42, 0.28);

  g.userData = { wheels };
  return g;
}

/* ------------------------------------------------------------------ *
 *  createHayBale — round bale lying on its side (axis along X).
 * ------------------------------------------------------------------ */

export function createHayBale() {
  const g = new THREE.Group();
  add(g, cylXGeo(0.7, 1.0, 10), mat(COLORS.straw, true), 0, 0.7, 0);
  add(g, cylXGeo(0.5, 1.06, 10), mat(0xc9a64e, true), 0, 0.7, 0);   // end swirl ring
  add(g, cylXGeo(0.2, 1.1, 8), mat(0xa8853c, true), 0, 0.7, 0);     // swirl core
  for (const x of [-0.26, 0.26]) {                                   // twine bands
    add(g, cylXGeo(0.715, 0.08, 10), mat(0xb38f3e, true), x, 0.7, 0);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 *  createFenceSection — posts every ~2 + two rails, height ~1.1.
 *  Runs along +X from the origin (x in [0, length]).
 * ------------------------------------------------------------------ */

export function createFenceSection(length = 8) {
  const g = new THREE.Group();
  const postM = mat(COLORS.woodDark);
  const railM = mat(COLORS.wood);
  for (let x = 0; x <= length + 0.001; x += 2) {
    box(g, 0.18, 1.15, 0.18, postM, Math.min(x, length), 0.575, 0);
  }
  if (length % 2 > 0.01) box(g, 0.18, 1.15, 0.18, postM, length, 0.575, 0);
  box(g, length, 0.13, 0.08, railM, length / 2, 0.92, 0.1);
  box(g, length, 0.13, 0.08, railM, length / 2, 0.52, 0.1);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createBridge — wooden plank bridge with a slight arch.
 *  Runs along +X, centered on the origin (x in [-length/2, length/2]).
 * ------------------------------------------------------------------ */

export function createBridge(length = 14, width = 4) {
  const g = new THREE.Group();
  const arch = Math.min(0.6, Math.max(0.15, length * 0.045));
  const deckY = (x) => 0.22 + arch * (1 - Math.pow((2 * x) / length, 2));
  const slopeAt = (x) => Math.atan((-8 * arch * x) / (length * length));

  // Deck planks (two alternating wood tones), following the arch.
  const n = Math.max(6, Math.round(length / 0.6));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (i + 0.5) * step;
    const plank = box(g, step * 0.94, 0.14, width, i % 2 ? mat(0x99756a) : mat(COLORS.wood), x, deckY(x), 0);
    plank.rotation.z = slopeAt(x);
  }
  // Long support beams + corner footing posts.
  for (const s of [-1, 1]) {
    box(g, length * 0.94, 0.18, 0.24, mat(COLORS.woodDark), 0, 0.12, s * (width / 2 - 0.3));
    for (const e of [-1, 1]) {
      box(g, 0.22, 0.5, 0.22, mat(COLORS.woodDark), e * (length / 2 - 0.25), 0.25, s * (width / 2 - 0.25));
    }
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
 *  createCoop — chicken coop ~3 x 2.5 x 2.5 with ramp. Front faces +Z.
 * ------------------------------------------------------------------ */

export function createCoop() {
  const g = new THREE.Group();
  const red = mat(COLORS.barnRed);
  const trim = mat(COLORS.barnTrim);

  // Stilts + body.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    box(g, 0.16, 0.42, 0.16, mat(COLORS.woodDark), sx * 1.3, 0.21, sz * 0.9);
  }
  box(g, 3, 1.5, 2.2, red, 0, 1.15, 0);
  // Slanted shed roof with a little vent.
  const roof = box(g, 3.5, 0.14, 2.8, mat(COLORS.woodDark), 0, 2.1, -0.1);
  roof.rotation.x = 0.16;
  box(g, 0.45, 0.3, 0.45, red, 0.9, 2.42, -0.5);
  box(g, 0.6, 0.1, 0.6, mat(COLORS.woodDark), 0.9, 2.6, -0.5);
  // Corner trim boards.
  for (const s of [-1, 1]) {
    box(g, 0.14, 1.5, 0.14, trim, s * 1.46, 1.15, 1.05);
  }
  // Pophole door with white frame.
  box(g, 0.85, 1.05, 0.1, trim, -0.6, 1.0, 1.1);
  box(g, 0.6, 0.85, 0.12, mat(0x3a2a22), -0.6, 0.95, 1.14);
  // Little window.
  box(g, 0.62, 0.62, 0.1, trim, 0.75, 1.35, 1.1);
  const pane = box(g, 0.44, 0.44, 0.12, emat(0xffd98c, 0xff9d3c, 0.7), 0.75, 1.35, 1.13);
  pane.castShadow = false;
  // Ramp with cleats (its own group so the cleats tilt with the board).
  const ramp = pivot(g, -0.6, 0.55, 1.12);
  ramp.rotation.x = 0.42;
  box(ramp, 0.55, 0.07, 1.5, mat(COLORS.wood), 0, 0, 0.7);
  for (const z of [0.35, 0.75, 1.15]) {
    box(ramp, 0.55, 0.06, 0.09, mat(COLORS.woodDark), 0, 0.05, z);
  }
  // Side nesting box with slanted lid.
  box(g, 0.6, 0.65, 0.9, red, 1.65, 1.1, -0.3);
  const lid = box(g, 0.75, 0.08, 1.0, trim, 1.68, 1.48, -0.3);
  lid.rotation.z = -0.18;
  return g;
}

/* ------------------------------------------------------------------ *
 *  createPumpkin — ~0.5 tall.
 * ------------------------------------------------------------------ */

export function createPumpkin() {
  const g = new THREE.Group();
  const a = add(g, sphGeo(0.3, 8, 5), mat(0xf28a1f, true), 0, 0.24, 0);
  a.scale.set(1, 0.8, 1);
  const b = add(g, sphGeo(0.285, 8, 5), mat(0xd9731f, true), 0, 0.24, 0);
  b.scale.set(0.92, 0.84, 0.92);
  b.rotation.y = Math.PI / 8;
  const stem = box(g, 0.07, 0.2, 0.07, mat(0x6d8f3a), 0.02, 0.52, 0);
  stem.rotation.z = 0.25;
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCornStalk — ~1.8 tall (instanced by world.js — few meshes).
 * ------------------------------------------------------------------ */

export function createCornStalk() {
  const g = new THREE.Group();
  const stalk = box(g, 0.1, 1.8, 0.1, mat(0x4f9e3d), 0, 0.9, 0);
  stalk.rotation.z = 0.04;
  const leafA = box(g, 0.7, 0.07, 0.16, mat(0x5db04a), 0.26, 0.95, 0);
  leafA.rotation.z = 0.5;
  const leafB = box(g, 0.62, 0.07, 0.16, mat(0x4f9e3d), -0.24, 1.25, 0.05);
  leafB.rotation.z = -0.55;
  const cob = box(g, 0.14, 0.34, 0.14, mat(0xe8c34a), 0.11, 1.05, 0.09);
  cob.rotation.z = 0.25;
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCattail — pond reed ~1.2.
 * ------------------------------------------------------------------ */

export function createCattail() {
  const g = new THREE.Group();
  const stem = box(g, 0.05, 1.1, 0.05, mat(0x5da244), 0, 0.55, 0);
  stem.rotation.z = 0.05;
  add(g, cylGeo(0.09, 0.09, 0.42, 6), mat(0x7a4a21, true), 0.03, 0.96, 0);
  box(g, 0.03, 0.2, 0.03, mat(COLORS.straw), 0.04, 1.27, 0);
  const blade = box(g, 0.04, 0.95, 0.14, mat(0x4f9e3d), 0.12, 0.5, 0.03);
  blade.rotation.set(0.1, 0.4, 0.18);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createSunflower — ~1.6 tall, face tilted up toward +Z.
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
  const petals = add(head, cylGeo(0.34, 0.34, 0.06, 8), emat(COLORS.gold, 0xc79a1e, 0.15, true), 0, 0, 0);
  petals.castShadow = false;
  add(head, cylGeo(0.17, 0.17, 0.09, 8), mat(0x6d4c41, true), 0, 0.04, 0);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createLanternPost — ~3 tall, warm emissive lamp head.
 * ------------------------------------------------------------------ */

export function createLanternPost() {
  const g = new THREE.Group();
  const dark = mat(0x3b3b42);
  box(g, 0.44, 0.22, 0.44, mat(COLORS.stone), 0, 0.11, 0);
  box(g, 0.16, 2.7, 0.16, mat(COLORS.woodDark), 0, 1.45, 0);
  box(g, 0.55, 0.1, 0.1, mat(COLORS.woodDark), 0.23, 2.72, 0);
  const brace = box(g, 0.4, 0.08, 0.08, mat(COLORS.woodDark), 0.16, 2.55, 0);
  brace.rotation.z = 0.7;
  box(g, 0.05, 0.16, 0.05, dark, 0.46, 2.6, 0);
  // Hanging lantern cage with glowing core.
  const lan = pivot(g, 0.46, 2.28, 0);
  box(lan, 0.32, 0.07, 0.32, dark, 0, 0.22, 0);
  box(lan, 0.28, 0.07, 0.28, dark, 0, -0.22, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    box(lan, 0.045, 0.42, 0.045, dark, sx * 0.12, 0, sz * 0.12);
  }
  const glowCore = box(lan, 0.17, 0.28, 0.17, emat(0xffe2a8, 0xffb74d, 1.0), 0, 0, 0);
  glowCore.castShadow = false;
  add(lan, coneGeo(0.26, 0.2, 4), dark, 0, 0.34, 0);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createMailbox — ~1.35 tall, little red flag up.
 * ------------------------------------------------------------------ */

export function createMailbox() {
  const g = new THREE.Group();
  box(g, 0.11, 1.0, 0.11, mat(COLORS.wood), 0, 0.5, 0);
  box(g, 0.3, 0.06, 0.2, mat(COLORS.wood), 0, 0.98, 0);
  // Box body with rounded top (half-buried cylinder).
  box(g, 0.36, 0.24, 0.6, mat(0x4a7fd6), 0, 1.13, 0);
  add(g, cylZGeo(0.18, 0.6, 8), mat(0x4a7fd6, true), 0, 1.25, 0);
  box(g, 0.3, 0.2, 0.05, mat(0x32599e), 0, 1.12, 0.31);   // door
  box(g, 0.08, 0.04, 0.04, mat(0xd9d9d9), 0, 1.05, 0.34); // latch
  // Flag up!
  box(g, 0.03, 0.3, 0.04, mat(0xe53935), 0.2, 1.36, -0.12);
  box(g, 0.03, 0.1, 0.16, mat(0xe53935), 0.2, 1.48, -0.05);
  return g;
}

/* ------------------------------------------------------------------ *
 *  createCar — parked pickup truck, ~4 long, faces +Z.
 * ------------------------------------------------------------------ */

export function createCar() {
  const g = new THREE.Group();
  const paint = mat(0x3ba7dd);
  const gray = mat(0x78909c);

  // Body slab + cab with poking-out window band (Crossy style).
  box(g, 1.8, 0.55, 4.0, paint, 0, 0.78, 0);
  box(g, 1.7, 0.75, 1.4, paint, 0, 1.4, 0.5);
  const glass = box(g, 1.74, 0.45, 1.1, emat(0x9fd8ff, 0x3a6a8a, 0.25), 0, 1.45, 0.55);
  glass.castShadow = false;
  // Open truck bed with a pile of hay.
  for (const s of [-1, 1]) {
    box(g, 0.12, 0.42, 1.7, paint, s * 0.84, 1.22, -1.1);
  }
  box(g, 1.8, 0.42, 0.12, paint, 0, 1.22, -1.94);
  box(g, 1.3, 0.32, 1.2, mat(COLORS.straw), 0, 1.18, -1.1);
  // Grill, lights, bumpers, mirrors, exhaust.
  box(g, 1.5, 0.3, 0.1, gray, 0, 0.78, 2.02);
  for (const s of [-1, 1]) {
    const hl = box(g, 0.24, 0.18, 0.08, emat(0xffe3a1, 0xffb547, 0.7), s * 0.62, 0.95, 2.04);
    hl.castShadow = false;
    box(g, 0.18, 0.14, 0.07, emat(0xff6b5e, 0xc62828, 0.5), s * 0.7, 0.95, -2.02);
    box(g, 0.06, 0.06, 0.18, gray, s * 0.92, 1.45, 1.05);            // mirror arms
    box(g, 0.04, 0.14, 0.12, mat(0xd9d9d9), s * 0.99, 1.45, 1.05);   // mirrors
  }
  box(g, 1.95, 0.16, 0.16, gray, 0, 0.5, 2.0);
  box(g, 1.95, 0.16, 0.16, gray, 0, 0.5, -2.0);
  add(g, cylXGeo(0.05, 0.25, 6), gray, 0.5, 0.35, -2.0);
  // Wheels with light hubs.
  for (const [x, z] of [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.25], [0.85, -1.25]]) {
    add(g, cylXGeo(0.42, 0.3, 10), mat(0x263238, true), x, 0.42, z);
    add(g, cylXGeo(0.18, 0.34, 8), mat(0xcfd8dc, true), x, 0.42, z);
  }
  return g;
}
