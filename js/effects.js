// MOO-FO — js/effects.js (Agent G)
// Pooled particle/FX system. Hard caps, zero per-frame allocation in steady state.
// Box particles + flash spheres + canvas-sprite score popups + warp streaks.

import * as THREE from 'three';
import { COLORS } from './config.js';

const BOX_POOL = 320;     // shared pool for all box particles (chunks, sparks, dust, smoke, streaks, confetti)
const FLASH_POOL = 4;     // expanding flash spheres (explosions, big pops)
const POPUP_POOL = 12;    // floating score text sprites

const STREAK_RATE = 70;   // warp streaks emitted per second
const CONFETTI_COLORS = [0xff5252, 0xffd54f, 0x7cfc9a, 0xb388ff, 0x7ce8ff, 0xff8ad8];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this._time = 0;

    // ---- box particle pool ----
    this._boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this._parts = [];
    this._cursor = 0;
    for (let i = 0; i < BOX_POOL; i++) {
      const mesh = new THREE.Mesh(
        this._boxGeo,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false })
      );
      mesh.visible = false;
      scene.add(mesh);
      this._parts.push({
        mesh,
        vx: 0, vy: 0, vz: 0,          // velocity
        sx: 0.3, sy: 0.3, sz: 0.3,    // base scale
        rx: 0, ry: 0, rz: 0,          // spin (rad/s)
        life: 0, maxLife: 1,
        grav: 0, drag: 0, grow: 0,    // grow: -1..n, scale factor over lifetime
        op: 1,
        bounce: false,
        active: false,
      });
    }

    // ---- flash sphere pool ----
    this._flashGeo = new THREE.SphereGeometry(1, 10, 8);
    this._flashes = [];
    this._flashCursor = 0;
    for (let i = 0; i < FLASH_POOL; i++) {
      const mesh = new THREE.Mesh(
        this._flashGeo,
        new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this._flashes.push({ mesh, life: 0, maxLife: 1, base: 1, grow: 4, op: 1, active: false });
    }

    // ---- score popup pool (canvas-texture sprites) ----
    this._popups = [];
    this._popCursor = 0;
    for (let i = 0; i < POPUP_POOL; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(7, 2.625, 1);
      sprite.renderOrder = 50;
      sprite.visible = false;
      scene.add(sprite);
      this._popups.push({ sprite, ctx, tex, life: 0, maxLife: 1.15, active: false });
    }

    // ---- warp streak bookkeeping ----
    this._streakPrev = new THREE.Vector3();
    this._streakValid = false;
    this._streakLast = 0;
  }

  // ============================== core ==============================

  _next() {
    const p = this._parts[this._cursor];
    this._cursor = (this._cursor + 1) % BOX_POOL;
    return p;
  }

  _arm(p, hex, additive, life, op) {
    p.active = true;
    p.life = life;
    p.maxLife = life;
    p.op = op;
    const m = p.mesh;
    m.visible = true;
    m.material.color.setHex(hex);
    m.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.material.opacity = op;
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    m.scale.set(p.sx, p.sy, p.sz);
  }

  _flashAt(x, y, z, hex, base, grow, life, op) {
    const f = this._flashes[this._flashCursor];
    this._flashCursor = (this._flashCursor + 1) % FLASH_POOL;
    f.active = true;
    f.life = life;
    f.maxLife = life;
    f.base = base;
    f.grow = grow;
    f.op = op;
    f.mesh.visible = true;
    f.mesh.material.color.setHex(hex);
    f.mesh.material.opacity = op;
    f.mesh.position.set(x, y, z);
    f.mesh.scale.setScalar(base);
  }

  update(dt) {
    this._time += dt;

    // box particles
    for (let i = 0; i < BOX_POOL; i++) {
      const p = this._parts[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      const m = p.mesh;
      if (p.grav !== 0) p.vy += p.grav * dt;
      if (p.drag !== 0) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
      }
      m.position.x += p.vx * dt;
      m.position.y += p.vy * dt;
      m.position.z += p.vz * dt;
      if (p.bounce && m.position.y < 0.05 && p.vy < 0) {
        m.position.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      if (p.rx !== 0) m.rotation.x += p.rx * dt;
      if (p.ry !== 0) m.rotation.y += p.ry * dt;
      if (p.rz !== 0) m.rotation.z += p.rz * dt;
      const t = p.life / p.maxLife;               // 1 -> 0
      const s = Math.max(0.001, 1 + (1 - t) * p.grow);
      m.scale.set(p.sx * s, p.sy * s, p.sz * s);
      m.material.opacity = p.op * (t < 0.55 ? t / 0.55 : 1);
    }

    // flash spheres
    for (let i = 0; i < FLASH_POOL; i++) {
      const f = this._flashes[i];
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      const t = f.life / f.maxLife;               // 1 -> 0
      f.mesh.scale.setScalar(f.base * (1 + (1 - t) * f.grow));
      f.mesh.material.opacity = f.op * Math.pow(t, 1.4);
    }

    // popups
    for (let i = 0; i < POPUP_POOL; i++) {
      const p = this._popups[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.life / p.maxLife;               // 1 -> 0
      p.sprite.position.y += (1.6 + t * 1.6) * dt;
      p.sprite.material.opacity = Math.min(1, t / 0.45);
      const pop = t > 0.86 ? 1 + (t - 0.86) * 2.4 : 1; // little stamp-in pop
      p.sprite.scale.set(7 * pop, 2.625 * pop, 1);
    }
  }

  // ============================== emitters ==============================

  // Sparkle burst when a critter is consumed by the beam.
  abductPoof(pos) {
    for (let i = 0; i < 16; i++) {
      const p = this._next();
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * Math.PI;
      const sp = 3 + Math.random() * 4.5;
      p.vx = Math.cos(a) * Math.cos(e) * sp;
      p.vz = Math.sin(a) * Math.cos(e) * sp;
      p.vy = Math.abs(Math.sin(e)) * sp * 0.8 + 1.5;
      p.sx = p.sy = p.sz = 0.13 + Math.random() * 0.2;
      p.grav = -2; p.drag = 2.4; p.grow = -0.85;
      p.rx = (Math.random() - 0.5) * 12;
      p.ry = (Math.random() - 0.5) * 12;
      p.rz = (Math.random() - 0.5) * 12;
      p.bounce = false;
      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.9,
        pos.y + 0.6 + (Math.random() - 0.5) * 0.9,
        pos.z + (Math.random() - 0.5) * 0.9
      );
      const hex = i % 3 === 0 ? 0xffffff : (i % 3 === 1 ? COLORS.beam : COLORS.gold);
      this._arm(p, hex, true, 0.5 + Math.random() * 0.35, 0.95);
    }
    this._flashAt(pos.x, pos.y + 0.7, pos.z, COLORS.beam, 0.5, 3.2, 0.18, 0.55);
  }

  // Dropped critter landing / soft ground impact.
  dustPuff(pos) {
    for (let i = 0; i < 10; i++) {
      const p = this._next();
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.6;
      const sp = 1.4 + Math.random() * 1.8;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 0.6 + Math.random() * 1.4;
      p.sx = p.sy = p.sz = 0.24 + Math.random() * 0.26;
      p.grav = -1.6; p.drag = 2.6; p.grow = 2.0;
      p.rx = (Math.random() - 0.5) * 4;
      p.ry = (Math.random() - 0.5) * 4;
      p.rz = (Math.random() - 0.5) * 4;
      p.bounce = false;
      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.8,
        0.25 + Math.random() * 0.3,
        pos.z + (Math.random() - 0.5) * 0.8
      );
      this._arm(p, i % 2 === 0 ? COLORS.sand : 0xb9a06b, false, 0.6 + Math.random() * 0.45, 0.55);
    }
  }

  // Dark puffs trailing the crashing UFO (also generally useful).
  smokePuff(pos) {
    for (let i = 0; i < 4; i++) {
      const p = this._next();
      p.vx = (Math.random() - 0.5) * 1.6;
      p.vz = (Math.random() - 0.5) * 1.6;
      p.vy = 1.2 + Math.random() * 1.6;
      p.sx = p.sy = p.sz = 0.4 + Math.random() * 0.4;
      p.grav = 0; p.drag = 1.2; p.grow = 2.4;
      p.rx = (Math.random() - 0.5) * 2;
      p.ry = (Math.random() - 0.5) * 2;
      p.rz = (Math.random() - 0.5) * 2;
      p.bounce = false;
      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 1.4,
        pos.y + (Math.random() - 0.5) * 0.8,
        pos.z + (Math.random() - 0.5) * 1.4
      );
      this._arm(p, i % 2 === 0 ? 0x3a3a4c : 0x55556a, false, 1.2 + Math.random() * 1.0, 0.45);
    }
  }

  muzzleFlash(pos) {
    // hot core
    const core = this._next();
    core.vx = 0; core.vy = 0.4; core.vz = 0;
    core.sx = core.sy = core.sz = 0.5;
    core.grav = 0; core.drag = 0; core.grow = 1.6;
    core.rx = 0; core.ry = 8; core.rz = 0;
    core.bounce = false;
    core.mesh.position.set(pos.x, pos.y, pos.z);
    this._arm(core, 0xffe9a0, true, 0.07, 1);
    // sparks
    for (let i = 0; i < 4; i++) {
      const p = this._next();
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const sp = 5 + Math.random() * 5;
      p.vx = Math.cos(a) * Math.cos(e) * sp;
      p.vz = Math.sin(a) * Math.cos(e) * sp;
      p.vy = Math.sin(e) * sp * 0.6 + 1;
      p.sx = p.sy = p.sz = 0.08 + Math.random() * 0.08;
      p.grav = -8; p.drag = 1; p.grow = -0.8;
      p.rx = p.ry = p.rz = 0;
      p.bounce = false;
      p.mesh.position.set(pos.x, pos.y, pos.z);
      this._arm(p, 0xffc14d, true, 0.12 + Math.random() * 0.08, 1);
    }
  }

  // Bullet hits the UFO hull.
  bulletSpark(pos) {
    for (let i = 0; i < 9; i++) {
      const p = this._next();
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const sp = 4 + Math.random() * 5;
      p.vx = Math.cos(a) * Math.cos(e) * sp;
      p.vz = Math.sin(a) * Math.cos(e) * sp;
      p.vy = Math.sin(e) * sp;
      p.sx = p.sy = p.sz = 0.09 + Math.random() * 0.12;
      p.grav = -14; p.drag = 1.5; p.grow = -0.7;
      p.rx = (Math.random() - 0.5) * 16;
      p.ry = (Math.random() - 0.5) * 16;
      p.rz = (Math.random() - 0.5) * 16;
      p.bounce = false;
      p.mesh.position.set(pos.x, pos.y, pos.z);
      this._arm(p, i % 2 === 0 ? 0xffd27a : COLORS.ufoGlow, true, 0.28 + Math.random() * 0.25, 1);
    }
    this._flashAt(pos.x, pos.y, pos.z, 0xffe9a0, 0.35, 2.5, 0.1, 0.8);
  }

  // Big multi-stage UFO-crash explosion: flash + voxel chunks + embers + smoke column.
  explosion(pos) {
    this._flashAt(pos.x, pos.y + 1.2, pos.z, 0xfff3d0, 1.6, 7, 0.24, 1);
    this._flashAt(pos.x, pos.y + 1.0, pos.z, 0xff9c4a, 1.0, 9, 0.4, 0.85);

    // voxel chunks (hull debris)
    for (let i = 0; i < 26; i++) {
      const p = this._next();
      const a = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 11;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 4 + Math.random() * 9;
      const s = 0.25 + Math.random() * 0.55;
      p.sx = s; p.sy = s * (0.6 + Math.random() * 0.8); p.sz = s;
      p.grav = -22; p.drag = 0.5; p.grow = -0.3;
      p.rx = (Math.random() - 0.5) * 14;
      p.ry = (Math.random() - 0.5) * 14;
      p.rz = (Math.random() - 0.5) * 14;
      p.bounce = true;
      p.mesh.position.set(pos.x, pos.y + 0.8 + Math.random(), pos.z);
      const hexes = [COLORS.ufoBody, COLORS.ufoDome, 0xff8c42, 0x6b6b78];
      this._arm(p, hexes[(Math.random() * hexes.length) | 0], false, 1.2 + Math.random() * 1.1, 1);
    }
    // hot embers
    for (let i = 0; i < 10; i++) {
      const p = this._next();
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 8;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 5 + Math.random() * 8;
      p.sx = p.sy = p.sz = 0.12 + Math.random() * 0.14;
      p.grav = -16; p.drag = 0.8; p.grow = -0.85;
      p.rx = p.ry = p.rz = 0;
      p.bounce = false;
      p.mesh.position.set(pos.x, pos.y + 1, pos.z);
      this._arm(p, i % 2 === 0 ? 0xffc14d : 0xff7043, true, 0.5 + Math.random() * 0.6, 1);
    }
    // smoke pillar
    for (let i = 0; i < 12; i++) {
      const p = this._next();
      p.vx = (Math.random() - 0.5) * 2.4;
      p.vz = (Math.random() - 0.5) * 2.4;
      p.vy = 1.6 + Math.random() * 3;
      p.sx = p.sy = p.sz = 0.6 + Math.random() * 0.7;
      p.grav = 0; p.drag = 1; p.grow = 2.6;
      p.rx = (Math.random() - 0.5) * 2;
      p.ry = (Math.random() - 0.5) * 2;
      p.rz = (Math.random() - 0.5) * 2;
      p.bounce = false;
      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 2,
        pos.y + 0.5 + Math.random() * 1.5,
        pos.z + (Math.random() - 0.5) * 2
      );
      this._arm(p, i % 2 === 0 ? 0x2e2e3e : 0x4a4a5e, false, 1.6 + Math.random() * 1.2, 0.5);
    }
  }

  // Additive speed-line streaks trailing the ship while warping.
  // Rate-limited internally, so calling more than once per frame is safe.
  warpStreaks(active, ufoGroup) {
    if (!active || !ufoGroup) {
      this._streakValid = false;
      return;
    }
    const pos = ufoGroup.position;
    if (!this._streakValid) {
      this._streakPrev.copy(pos);
      this._streakValid = true;
      this._streakLast = this._time;
      return;
    }
    _v.copy(pos).sub(this._streakPrev);
    const moved = _v.length();
    this._streakPrev.copy(pos);
    if (moved < 1e-4) return;
    _v.divideScalar(moved); // motion direction

    const interval = 1 / STREAK_RATE;
    if (this._time - this._streakLast > 0.25) this._streakLast = this._time - interval;
    let guard = 0;
    while (this._time - this._streakLast >= interval && guard < 6) {
      this._streakLast += interval;
      guard++;
      const p = this._next();
      const back = 2.5 + Math.random() * 3;
      p.mesh.position.set(
        pos.x - _v.x * back + (Math.random() - 0.5) * 4.4,
        pos.y - _v.y * back + (Math.random() - 0.5) * 2.6,
        pos.z - _v.z * back + (Math.random() - 0.5) * 4.4
      );
      p.vx = -_v.x * 14; p.vy = -_v.y * 14; p.vz = -_v.z * 14;
      p.sx = 0.09; p.sy = 0.09; p.sz = 2.2 + Math.random() * 2.4;
      p.grav = 0; p.drag = 0; p.grow = -0.6;
      p.rx = p.ry = p.rz = 0;
      p.bounce = false;
      this._arm(p, Math.random() < 0.5 ? COLORS.ufoGlow : 0xcfe8ff, true, 0.26 + Math.random() * 0.16, 0.8);
      _v2.copy(p.mesh.position).add(_v);
      p.mesh.lookAt(_v2); // stretch axis (+Z) along motion
    }
  }

  // Floating, fading text sprite ("+100", "x3", ...).
  scorePopup(pos, text, colorHex) {
    const p = this._popups[this._popCursor];
    this._popCursor = (this._popCursor + 1) % POPUP_POOL;
    const ctx = p.ctx;
    ctx.clearRect(0, 0, 256, 96);
    ctx.font = '700 54px Rubik, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(8, 10, 28, 0.9)';
    ctx.strokeText(text, 128, 50);
    const hex = colorHex === undefined || colorHex === null ? 0xffffff : colorHex;
    ctx.fillStyle = '#' + hex.toString(16).padStart(6, '0');
    ctx.fillText(text, 128, 50);
    p.tex.needsUpdate = true;
    p.sprite.position.set(pos.x, pos.y + 2.2, pos.z);
    p.sprite.material.opacity = 1;
    p.sprite.visible = true;
    p.active = true;
    p.maxLife = 1.15;
    p.life = p.maxLife;
  }

  // Win celebration burst.
  confettiAt(pos) {
    for (let i = 0; i < 30; i++) {
      const p = this._next();
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 3.5;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 6 + Math.random() * 7;
      p.sx = 0.26 + Math.random() * 0.14;
      p.sy = 0.05;
      p.sz = 0.18 + Math.random() * 0.1;
      p.grav = -13; p.drag = 0.9; p.grow = 0;
      p.rx = (Math.random() - 0.5) * 18;
      p.ry = (Math.random() - 0.5) * 18;
      p.rz = (Math.random() - 0.5) * 18;
      p.bounce = true;
      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 1.5,
        pos.y + (Math.random() - 0.5) * 1.5,
        pos.z + (Math.random() - 0.5) * 1.5
      );
      this._arm(p, CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0], false, 1.4 + Math.random() * 0.9, 1);
    }
  }
}
