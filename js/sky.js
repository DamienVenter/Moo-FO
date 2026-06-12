// MOO-FO — js/sky.js
// Night sky: stars (twinkling), low-poly moon with glow, drifting voxel clouds,
// shooting stars. Also owns scene lighting + fog per the spec.

import * as THREE from 'three';
import { COLORS, ENABLE_SHADOWS } from './config.js';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 246, 216, 0.85)');
  g.addColorStop(0.35, 'rgba(255, 246, 216, 0.25)');
  g.addColorStop(1, 'rgba(255, 246, 216, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function starField(count, size, color) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // upper hemisphere dome, radius ~620
    const a = Math.random() * Math.PI * 2;
    const elev = Math.acos(Math.random() * 0.95);      // bias toward horizon spread
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
    const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.85);
    scene.add(hemi);

    const moonDir = new THREE.DirectionalLight(COLORS.moonlight, 1.05);
    moonDir.position.set(-180, 260, -240);
    moonDir.target.position.set(0, 0, 0);
    scene.add(moonDir);
    scene.add(moonDir.target);
    if (ENABLE_SHADOWS) {
      moonDir.castShadow = true;
      moonDir.shadow.mapSize.set(2048, 2048);
      const sc = moonDir.shadow.camera;
      sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140;
      sc.near = 60; sc.far = 700;
      moonDir.shadow.bias = -0.0008;
      moonDir.shadow.normalBias = 0.4;
    }

    // ---------------------------------------------------------------- stars
    this.stars1 = starField(1100, 2.0, 0xffffff);
    this.stars2 = starField(450, 3.0, 0xcfe0ff);
    scene.add(this.stars1, this.stars2);

    // ----------------------------------------------------------------- moon
    const moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(26, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.moon, fog: false })
    );
    moon.position.set(-280, 330, -380);
    scene.add(moon);
    // crater shading: a few darker low-poly bumps
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xe3d6ae, fog: false });
    for (const [ox, oy, oz, s] of [[8, 6, 22, 6], [-12, -4, 21, 4.5], [2, -12, 20, 3.5]]) {
      const crater = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), craterMat);
      crater.position.set(moon.position.x + ox, moon.position.y + oy, moon.position.z + oz);
      scene.add(crater);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    glow.position.copy(moon.position);
    glow.scale.setScalar(170);
    scene.add(glow);

    // ---------------------------------------------------------------- clouds
    this.clouds = [];
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0x2c3a66, transparent: true, opacity: 0.85, fog: false,
    });
    for (let i = 0; i < 3; i++) {
      const cloud = new THREE.Group();
      const puffs = 4 + ((Math.random() * 3) | 0);
      for (let p = 0; p < puffs; p++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(
          14 + Math.random() * 18, 5 + Math.random() * 4, 8 + Math.random() * 8
        ), cloudMat);
        b.position.set((p - puffs / 2) * 11 + Math.random() * 5, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
        cloud.add(b);
      }
      cloud.position.set(-300 + i * 280, 130 + i * 25, -160 + i * 130);
      scene.add(cloud);
      this.clouds.push({ group: cloud, speed: 1.2 + Math.random() * 1.4 });
    }

    // ----------------------------------------------------------- shooting star
    this.shoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    scene.add(this.shoot);
    this._shootT = -3;          // negative = waiting; positive 0..1 = flying
    this._shootFrom = new THREE.Vector3();
    this._shootDir = new THREE.Vector3();
  }

  update(dt, elapsed) {
    // twinkle (two layers pulsing out of phase)
    this.stars1.material.opacity = 0.75 + Math.sin(elapsed * 2.1) * 0.15;
    this.stars2.material.opacity = 0.65 + Math.sin(elapsed * 3.3 + 1.7) * 0.25;

    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 500) c.group.position.x = -500;
    }

    // shooting star scheduler
    this._shootT += dt;
    if (this._shootT < 0) return;
    if (this._shootT <= 1) {
      if (this._shootT - dt < 0) {
        // just launched: pick a fresh arc
        const a = Math.random() * Math.PI * 2;
        this._shootFrom.set(Math.cos(a) * 420, 280 + Math.random() * 120, Math.sin(a) * 420);
        this._shootDir.set(-Math.cos(a) * 300 + (Math.random() - 0.5) * 200, -60, -Math.sin(a) * 300 + (Math.random() - 0.5) * 200);
        this.shoot.lookAt(this._shootDir.clone().add(this._shootFrom));
      }
      const t = this._shootT;
      this.shoot.position.copy(this._shootFrom).addScaledVector(this._shootDir, t);
      this.shoot.material.opacity = Math.sin(t * Math.PI) * 0.9;
    } else if (this._shootT > 1) {
      this.shoot.material.opacity = 0;
      this._shootT = -(4 + Math.random() * 6);   // wait 4–10 s
    }
  }
}
