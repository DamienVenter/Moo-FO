// MOO-FO — shop / upgrade 3D services.
//
//   PreviewStage    — the big animated UFO + beam preview (one per screen).
//   ThumbStage      — static per-cell thumbnails of the REAL model (cached).
//   GalaxyBackdrop  — an animated three.js starfield behind the screens.
//
// All render the REAL in-game UFO model (models.js createUFO) and the real
// beam forms (beams.js), then blit into ordinary 2D <canvas> elements the UI
// already owns, so the shop/upgrade DOM stays simple.

import * as THREE from 'three';
import { createUFO } from './models.js';
import { buildBeam } from './beams.js';

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
    else if (m && m.dispose) m.dispose();
  });
}

// Studio lighting shared by the preview + thumbnail stages.
function studioLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x2a2440, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.75); key.position.set(6, 10, 8); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9ec5ff, 0.85); fill.position.set(-7, 3, 6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xa9ffd0, 0.6); rim.position.set(0, -4, -9); scene.add(rim);
}

// Build a recentred UFO + connected beam into `holder`. Returns metrics.
// The beam's TOP sits flush against the craft underside (no gap).
function assemble(holder, skin, beam) {
  const ufo = createUFO({ shape: skin.shape, hull: skin.hull, dome: skin.dome, light: skin.light });
  holder.add(ufo);
  const box = new THREE.Box3().setFromObject(ufo);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const center = sph.center.clone();
  ufo.position.set(-center.x, -center.y, -center.z);     // recenter on origin
  const radius = Math.max(1, sph.radius);
  const undersideY = box.min.y - center.y;               // recentred bottom

  const H = radius * 2.55;
  const beamObj = buildBeam(beam || {}, {
    radiusTop: Math.max(0.34, radius * 0.18),
    radiusBot: radius * 0.92,
    height: H,
  });
  beamObj.group.position.y = undersideY + radius * 0.10; // overlap into the hull
  holder.add(beamObj.group);

  const lights = (ufo.userData && ufo.userData.lights) || [];
  const lightBase = lights.map((l) => (l.material && l.material.emissiveIntensity) || 1);
  return { ufo, beamObj, radius, H, undersideY, lights, lightBase };
}

// Frame a perspective camera to fit the craft + most of its beam.
function frameCamera(cam, radius, H) {
  const fit = radius * 1.15 + H * 0.42;
  const fov = (cam.fov * Math.PI) / 180;
  cam.position.set(0, radius * 0.62, fit / Math.sin(fov / 2) * 0.52);
  cam.lookAt(0, -H * 0.30, 0);
}

// --------------------------------------------------------------------------
// Big animated preview.
// --------------------------------------------------------------------------
export class PreviewStage {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
    studioLights(this.scene);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.holder = new THREE.Group(); this.pivot.add(this.holder);
    this.m = null; this._skinId = null; this._beamId = null; this._w = 0; this._h = 0;
  }

  setLook(skin, beam) {
    if (!skin) skin = {};
    const skinChanged = skin.id !== this._skinId;
    const beamChanged = (beam && beam.id) !== this._beamId;
    if (skinChanged || beamChanged) {
      if (this.m) { this.holder.clear(); if (this.m.ufo) disposeTree(this.m.ufo); if (this.m.beamObj) this.m.beamObj.dispose(); }
      this.m = assemble(this.holder, skin, beam || {});
      frameCamera(this.camera, this.m.radius, this.m.H);
      this._skinId = skin.id; this._beamId = beam && beam.id;
    }
  }

  render(target, tSec) {
    if (!target || !this.m) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(48, Math.round(target.clientWidth || target.width || 260));
    const ch = Math.max(48, Math.round(target.clientHeight || target.height || 240));
    if (cw !== this._w || ch !== this._h) {
      this.renderer.setPixelRatio(dpr); this.renderer.setSize(cw, ch, false);
      this.camera.aspect = cw / ch; this.camera.updateProjectionMatrix();
      this._w = cw; this._h = ch;
    }
    this.pivot.rotation.y = tSec * 0.6;
    this.holder.position.y = Math.sin(tSec * 1.6) * this.m.radius * 0.05;
    const lg = this.m.lights;
    for (let i = 0; i < lg.length; i++) {
      const mm = lg[i].material;
      if (mm) mm.emissiveIntensity = this.m.lightBase[i] * (0.55 + 0.6 * (0.5 + 0.5 * Math.sin(tSec * 4 + i * 0.8)));
    }
    if (this.m.beamObj) this.m.beamObj.update(tSec);
    this.renderer.render(this.scene, this.camera);
    blit(target, this.renderer.domElement, dpr, cw, ch);
  }

  dispose() { if (this.m) { if (this.m.ufo) disposeTree(this.m.ufo); if (this.m.beamObj) this.m.beamObj.dispose(); } this.renderer.dispose(); }
}

// --------------------------------------------------------------------------
// Static per-cell thumbnails of the real model (cached by look).
// --------------------------------------------------------------------------
export class ThumbStage {
  constructor(size = 220) {
    this.size = size;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(size, size, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    studioLights(this.scene);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.holder = new THREE.Group(); this.pivot.add(this.holder);
    this.pivot.rotation.y = 0.6;                 // a fixed flattering 3/4 angle
    this._cache = new Map();                      // key → dataURL
  }

  // Paint the look into `target`. Re-renders only on a cache miss.
  renderInto(target, skin, beam) {
    if (!target) return;
    const key = (skin.id || '?') + '|' + (beam && beam.id || '-');
    let url = this._cache.get(key);
    if (!url) {
      const m = assemble(this.holder, skin, beam || {});
      frameCamera(this.camera, m.radius, m.H);
      this.pivot.rotation.y = 0.6;
      if (m.beamObj) m.beamObj.update(0.0);
      this.renderer.render(this.scene, this.camera);
      url = this.renderer.domElement.toDataURL('image/png');
      this.holder.clear(); if (m.ufo) disposeTree(m.ufo); if (m.beamObj) m.beamObj.dispose();
      if (this._cache.size > 240) this._cache.clear();
      this._cache.set(key, url);
    }
    const img = new Image();
    img.onload = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(40, target.clientWidth || 120), chh = Math.max(40, target.clientHeight || 120);
      target.width = Math.round(cw * dpr); target.height = Math.round(chh * dpr);
      const ctx = target.getContext('2d');
      ctx.clearRect(0, 0, target.width, target.height);
      // contain-fit the square render into the cell.
      const s = Math.min(target.width, target.height);
      ctx.drawImage(img, (target.width - s) / 2, (target.height - s) / 2, s, s);
    };
    img.src = url;
  }

  invalidate() { this._cache.clear(); }
}

// --------------------------------------------------------------------------
// Animated galaxy starfield backdrop.
// --------------------------------------------------------------------------
export class GalaxyBackdrop {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    this.camera.position.set(0, 0, 0.1);
    this.group = new THREE.Group(); this.scene.add(this.group);

    // Three layered star shells (parallax) + a soft galactic band.
    const layers = [
      { n: 1100, r: 520, size: 1.6, col: 0xffffff, spin: 0.006 },
      { n: 700, r: 360, size: 2.4, col: 0xbfd8ff, spin: 0.011 },
      { n: 380, r: 230, size: 3.6, col: 0xfff0c8, spin: 0.018 },
    ];
    this._spins = [];
    for (const L of layers) {
      const pos = new Float32Array(L.n * 3), colr = new Float32Array(L.n * 3);
      const tint = new THREE.Color(L.col);
      for (let i = 0; i < L.n; i++) {
        // bias toward a diagonal galactic band for a "galaxy" feel.
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const band = (v - 0.5) * (0.35 + 0.65 * Math.random());
        const rr = L.r * (0.55 + 0.45 * Math.random());
        pos[i * 3] = Math.cos(theta) * rr;
        pos[i * 3 + 1] = band * L.r * 0.6 + (Math.random() - 0.5) * L.r * 0.25;
        pos[i * 3 + 2] = Math.sin(theta) * rr - L.r * 0.2;
        const t = 0.6 + Math.random() * 0.4;
        colr[i * 3] = tint.r * t; colr[i * 3 + 1] = tint.g * t; colr[i * 3 + 2] = tint.b * t;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      const m = new THREE.Points(geo, new THREE.PointsMaterial({
        size: L.size, sizeAttenuation: true, vertexColors: true, transparent: true,
        opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, map: starSprite(),
      }));
      this.group.add(m); this._spins.push({ m, spin: L.spin });
    }
    this._w = 0; this._h = 0;
  }

  render(target, tSec) {
    if (!target) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cw = Math.max(64, target.clientWidth || window.innerWidth);
    const ch = Math.max(64, target.clientHeight || window.innerHeight);
    if (cw !== this._w || ch !== this._h) {
      this.renderer.setPixelRatio(dpr); this.renderer.setSize(cw, ch, false);
      this.camera.aspect = cw / ch; this.camera.updateProjectionMatrix();
      this._w = cw; this._h = ch;
    }
    for (const s of this._spins) s.m.rotation.y = tSec * s.spin;
    this.group.rotation.z = Math.sin(tSec * 0.02) * 0.08;
    this.camera.position.x = Math.sin(tSec * 0.05) * 6;
    this.camera.lookAt(0, 0, -200);
    this.renderer.render(this.scene, this.camera);
    blit(target, this.renderer.domElement, dpr, cw, ch);
  }

  dispose() { this.renderer.dispose(); }
}

// blit a WebGL canvas into a 2D target canvas (DPR-correct).
function blit(target, src, dpr, cw, ch) {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
  if (target.width !== bw || target.height !== bh) { target.width = bw; target.height = bh; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(src, 0, 0, target.width, target.height);
}

let _starTex = null;
function starSprite() {
  if (_starTex) return _starTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(16, 16, 16, 0, 7); x.fill();
  _starTex = new THREE.CanvasTexture(c);
  return _starTex;
}
