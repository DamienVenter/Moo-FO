// MOO-FO — shop / upgrade 3D preview stage.
//
// Renders the REAL in-game UFO model (js/models.js createUFO) plus a matching
// tractor beam into a small offscreen WebGL canvas, then blits it into whatever
// 2D preview <canvas> the shop/upgrade screens already own. One shared stage is
// reused for every preview (only one is ever visible at a time), so we pay for a
// single WebGL context and only when a preview is first shown.
//
// Public API (used by ui.js):
//   const stage = new PreviewStage();
//   stage.setLook(skinObj, beamObj);   // skin/beam records from cosmetics.js
//   stage.render(targetCanvas2d, tSeconds);
//   stage.dispose();

import * as THREE from 'three';
import { createUFO } from './models.js';

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
    else if (m && m.dispose) m.dispose();
  });
}

export class PreviewStage {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);

    // Friendly studio lighting so every hull colour reads well.
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x2a2440, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.75); key.position.set(6, 10, 8); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9ec5ff, 0.85); fill.position.set(-7, 3, 6); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa9ffd0, 0.6); rim.position.set(0, -4, -9); this.scene.add(rim);

    // pivot spins (turntable); holder recenters the model on the pivot origin.
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.holder = new THREE.Group(); this.pivot.add(this.holder);

    this.ufo = null;
    this.beam = null;
    this._coneMat = null;
    this._coreMat = null;
    this._lights = [];
    this._lightBase = [];
    this._radius = 3;
    this._skinId = null;
    this._rainbow = false;
    this._w = 0; this._h = 0;
  }

  // Build a translucent additive beam cone (outer glow + brighter inner core),
  // sized to the craft, hanging straight down from the underside.
  _buildBeam(radius) {
    const grp = new THREE.Group();
    const h = radius * 2.7;
    const cone = new THREE.CylinderGeometry(radius * 0.26, radius * 1.02, h, 24, 1, true);
    cone.translate(0, -h / 2, 0);
    this._coneMat = new THREE.MeshBasicMaterial({
      color: 0x9af7b0, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    grp.add(new THREE.Mesh(cone, this._coneMat));
    const core = new THREE.CylinderGeometry(radius * 0.16, radius * 0.5, h, 16, 1, true);
    core.translate(0, -h / 2, 0);
    this._coreMat = new THREE.MeshBasicMaterial({
      color: 0xeafff0, transparent: true, opacity: 0.38,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    grp.add(new THREE.Mesh(core, this._coreMat));
    return grp;
  }

  /** Point the stage at a {skin, beam}. Rebuilds the ship only when the skin
   *  changes; otherwise just recolours the beam. */
  setLook(skin, beam) {
    if (!skin) skin = {};
    if (skin.id !== this._skinId) {
      if (this.ufo) { this.holder.remove(this.ufo); disposeTree(this.ufo); }
      if (this.beam) { this.holder.remove(this.beam); disposeTree(this.beam); this.beam = null; }
      this.ufo = createUFO({ shape: skin.shape, hull: skin.hull, dome: skin.dome, light: skin.light });
      this.holder.add(this.ufo);

      // recenter the craft on the pivot using its bounding sphere (beam excluded).
      const box = new THREE.Box3().setFromObject(this.ufo);
      const sph = box.getBoundingSphere(new THREE.Sphere());
      this.ufo.position.set(-sph.center.x, -sph.center.y, -sph.center.z);
      this._radius = Math.max(1, sph.radius);

      // grab the rim lights so we can pulse them for life.
      this._lights = (this.ufo.userData && this.ufo.userData.lights) || [];
      this._lightBase = this._lights.map((l) => (l.material && l.material.emissiveIntensity) || 1);

      // beam hangs from the underside (bottom of the recentred bounding box).
      this.beam = this._buildBeam(this._radius * 0.55);
      this.beam.position.set(0, -sph.center.y - this._radius * 0.96, 0);
      this.holder.add(this.beam);

      // frame the camera to fit the craft (+ a little headroom for the beam).
      const fov = (this.camera.fov * Math.PI) / 180;
      const dist = (this._radius * 1.85) / Math.sin(fov / 2) * 0.5;
      this.camera.position.set(0, this._radius * 0.5, dist);
      this.camera.lookAt(0, -this._radius * 0.35, 0);

      this._skinId = skin.id;
    }
    this._rainbow = !!(beam && beam.rainbow);
    if (this._coneMat && !this._rainbow) this._coneMat.color.set(beam && beam.color != null ? beam.color : 0x9af7b0);
    if (this._coreMat) {
      const c = new THREE.Color(beam && beam.color != null ? beam.color : 0x9af7b0);
      // lift the core toward white for the bright central column.
      c.lerp(new THREE.Color(0xffffff), 0.55);
      this._coreMat.color.copy(c);
    }
  }

  /** Render one frame and blit it into a 2D target canvas. */
  render(target, tSec) {
    if (!target || !this.ufo) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(48, Math.round(target.clientWidth || target.width || 240));
    const ch = Math.max(48, Math.round(target.clientHeight || target.height || 220));
    if (cw !== this._w || ch !== this._h) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(cw, ch, false);
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this._w = cw; this._h = ch;
    }

    // gentle turntable + bob.
    this.pivot.rotation.y = tSec * 0.6;
    this.holder.position.y = Math.sin(tSec * 1.6) * this._radius * 0.05;

    // pulse the rim lights so the craft feels alive.
    if (this._lights.length) {
      for (let i = 0; i < this._lights.length; i++) {
        const m = this._lights[i].material;
        if (m) m.emissiveIntensity = this._lightBase[i] * (0.55 + 0.6 * (0.5 + 0.5 * Math.sin(tSec * 4 + i * 0.8)));
      }
    }
    // rainbow beam: cycle hue.
    if (this._rainbow && this._coneMat) {
      const c = new THREE.Color(); c.setHSL((tSec * 0.16) % 1, 0.9, 0.62);
      this._coneMat.color.copy(c);
      if (this._coreMat) this._coreMat.color.copy(c.clone().lerp(new THREE.Color(0xffffff), 0.6));
    }

    this.renderer.render(this.scene, this.camera);

    // blit the WebGL frame into the existing 2D preview canvas.
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (target.width !== bw || target.height !== bh) { target.width = bw; target.height = bh; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(this.renderer.domElement, 0, 0, target.width, target.height);
  }

  dispose() {
    if (this.ufo) disposeTree(this.ufo);
    if (this.beam) disposeTree(this.beam);
    this.renderer.dispose();
  }
}
