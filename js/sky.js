// MOO-FO — js/sky.js
// Day-cycle-driven sky: sun AND moon travel their arcs, stars fade in/out,
// clouds tint with the light, shooting stars at night. Owns scene lighting
// and fog; every frame it samples the DayCycle passed to update().

import * as THREE from 'three';
import { COLORS, ENABLE_SHADOWS } from './config.js';

const SKY_R = 620;

function glowTexture(r, g, b) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`);
  grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.28)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function starField(count, size, color) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const elev = Math.acos(Math.random() * 0.95);
    const r = 600 + Math.random() * 40;
    pos[i * 3] = Math.cos(a) * Math.sin(elev) * r;
    pos[i * 3 + 1] = Math.abs(Math.cos(elev)) * r * 0.85 + 30;
    pos[i * 3 + 2] = Math.sin(a) * Math.sin(elev) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false,
  });
  return new THREE.Points(geo, mat);
}

export class Sky {
  constructor(scene) {
    this.scene = scene;

    scene.background = new THREE.Color(COLORS.night);
    scene.fog = new THREE.Fog(COLORS.fog, 60, 420);

    // ------------------------------------------------------------ lighting
    this.hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.85);
    scene.add(this.hemi);

    this.dir = new THREE.DirectionalLight(COLORS.moonlight, 1.05);
    this.dir.position.set(-180, 260, -240);
    this.dir.target.position.set(0, 0, 0);
    scene.add(this.dir);
    scene.add(this.dir.target);
    if (ENABLE_SHADOWS) {
      this.dir.castShadow = true;
      this.dir.shadow.mapSize.set(2048, 2048);
      const sc = this.dir.shadow.camera;
      sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140;
      sc.near = 60; sc.far = 700;
      this.dir.shadow.bias = -0.0008;
      this.dir.shadow.normalBias = 0.4;
    }

    // ---------------------------------------------------------------- stars
    this.stars1 = starField(1100, 2.0, 0xffffff);
    this.stars2 = starField(450, 3.0, 0xcfe0ff);
    scene.add(this.stars1, this.stars2);

    // ----------------------------------------------------------------- moon
    this.moon = new THREE.Group();
    const moonBall = new THREE.Mesh(
      new THREE.IcosahedronGeometry(26, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.moon, fog: false, transparent: true })
    );
    this.moon.add(moonBall);
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xe3d6ae, fog: false, transparent: true });
    for (const [ox, oy, oz, s] of [[8, 6, 22, 6], [-12, -4, 21, 4.5], [2, -12, 20, 3.5]]) {
      const crater = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), craterMat);
      crater.position.set(ox, oy, oz);
      this.moon.add(crater);
    }
    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(255, 246, 216), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.moonGlow.scale.setScalar(170);
    this.moon.add(this.moonGlow);
    this._moonMats = [moonBall.material, craterMat];
    scene.add(this.moon);

    // ------------------------------------------------------------------ sun
    this.sun = new THREE.Group();
    const sunBall = new THREE.Mesh(
      new THREE.IcosahedronGeometry(30, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false, transparent: true })
    );
    this.sun.add(sunBall);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(255, 214, 130), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunGlow.scale.setScalar(260);
    this.sun.add(this.sunGlow);
    this._sunMat = sunBall.material;
    scene.add(this.sun);

    // ---------------------------------------------------------------- clouds
    this.clouds = [];
    this._cloudMat = new THREE.MeshBasicMaterial({
      color: 0x2c3a66, transparent: true, opacity: 0.85, fog: false,
    });
    for (let i = 0; i < 4; i++) {
      const cloud = new THREE.Group();
      const puffs = 4 + ((Math.random() * 3) | 0);
      for (let p = 0; p < puffs; p++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(
          14 + Math.random() * 18, 5 + Math.random() * 4, 8 + Math.random() * 8
        ), this._cloudMat);
        b.position.set((p - puffs / 2) * 11 + Math.random() * 5, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
        cloud.add(b);
      }
      cloud.position.set(-380 + i * 220, 125 + i * 22, -200 + i * 120);
      scene.add(cloud);
      this.clouds.push({ group: cloud, speed: 1.2 + Math.random() * 1.4 });
    }
    this._cloudColor = new THREE.Color();
    this._cloudNight = new THREE.Color(0x2c3a66);
    this._cloudDay = new THREE.Color(0xf4f7fb);

    // ----------------------------------------------------------- shooting star
    this.shoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    scene.add(this.shoot);
    this._shootT = -3;
    this._shootFrom = new THREE.Vector3();
    this._shootDir = new THREE.Vector3();
  }

  update(dt, elapsed, cycle) {
    const scene = this.scene;
    if (cycle) {
      scene.background.copy(cycle.sky);
      scene.fog.color.copy(cycle.fog);

      this.hemi.color.copy(cycle.hemiSky);
      this.hemi.groundColor.copy(cycle.hemiGround);
      this.hemi.intensity = cycle.hemiIntensity;

      // The single shadow light tracks whichever body rules the sky.
      const night = cycle.nightGlow > 0.5;
      const d = night ? cycle.moonDir : cycle.sunDir;
      this.dir.position.set(d.x * 320, Math.max(d.y, 0.06) * 320, d.z * 320);
      this.dir.color.copy(cycle.sunColor);
      this.dir.intensity = cycle.sunIntensity;

      // celestial bodies
      this.moon.position.set(cycle.moonDir.x * SKY_R, Math.max(cycle.moonDir.y, -0.2) * SKY_R * 0.8 + 40, cycle.moonDir.z * SKY_R);
      const moonVis = Math.max(0, Math.min(1, cycle.nightGlow * 1.4 - 0.1));
      for (const m of this._moonMats) m.opacity = moonVis;
      this.moonGlow.material.opacity = moonVis * 0.9;

      this.sun.position.set(cycle.sunDir.x * SKY_R, Math.max(cycle.sunDir.y, -0.25) * SKY_R * 0.8 + 30, cycle.sunDir.z * SKY_R);
      const sunVis = Math.max(0, Math.min(1, (1 - cycle.nightGlow) * 1.5 - 0.15));
      this._sunMat.opacity = sunVis;
      this.sunGlow.material.opacity = sunVis;

      // stars
      this.stars1.material.opacity = cycle.starOpacity * (0.75 + Math.sin(elapsed * 2.1) * 0.15);
      this.stars2.material.opacity = cycle.starOpacity * (0.65 + Math.sin(elapsed * 3.3 + 1.7) * 0.25);

      // clouds tint between night blue and day white
      this._cloudColor.copy(this._cloudNight).lerp(this._cloudDay, 1 - cycle.nightGlow);
      this._cloudMat.color.copy(this._cloudColor);
    }

    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 500) c.group.position.x = -500;
    }

    // shooting stars only when stars are out
    const starsOut = !cycle || cycle.starOpacity > 0.5;
    this._shootT += dt;
    if (this._shootT < 0) return;
    if (!starsOut) { this.shoot.material.opacity = 0; this._shootT = -2; return; }
    if (this._shootT <= 1) {
      if (this._shootT - dt < 0) {
        const a = Math.random() * Math.PI * 2;
        this._shootFrom.set(Math.cos(a) * 420, 280 + Math.random() * 120, Math.sin(a) * 420);
        this._shootDir.set(-Math.cos(a) * 300 + (Math.random() - 0.5) * 200, -60, -Math.sin(a) * 300 + (Math.random() - 0.5) * 200);
        this.shoot.lookAt(this._shootDir.clone().add(this._shootFrom));
      }
      const t = this._shootT;
      this.shoot.position.copy(this._shootFrom).addScaledVector(this._shootDir, t);
      this.shoot.material.opacity = Math.sin(t * Math.PI) * 0.9;
    } else {
      this.shoot.material.opacity = 0;
      this._shootT = -(4 + Math.random() * 6);
    }
  }
}
