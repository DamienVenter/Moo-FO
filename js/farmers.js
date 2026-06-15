// MOO-FO — js/farmers.js (Agent G)
// Farmers: patrol → chase → aim+shoot state machine, pooled tracer bullets,
// target leading, aggro "!" pop, water/collider/bounds-aware movement.

import * as THREE from 'three';
import { CFG, COLORS } from './config.js';
import { createFarmer, blobShadow } from './models.js';
import { terrainHeight } from './terrain.js';

const BULLET_POOL = 24;
const UFO_HIT_R = 2.6;
const DEAGGRO_MULT = 1.3;        // chase persists out to AGGRO × this
const SHOOT_EXIT_MULT = 1.15;    // keep shooting out to RANGE × this once planted

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export class FarmerManager {
  constructor(scene, world, effects, audio, { onHitPlayer, difficulty = 1 } = {}) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.onHitPlayer = onHitPlayer;

    this.farmers = []; // [{ group, ... }] — read by the minimap
    this._t = 0;

    const bangMat = new THREE.MeshBasicMaterial({ color: COLORS.danger });
    // Harder campaign levels add extra farmers and quicker shots.
    this._fireMul = 1 / Math.max(1, difficulty);
    const base = world.farmerSpawns;
    const spawns = base.slice();
    const extra = Math.round((difficulty - 1) * 5);
    for (let e = 0; e < extra; e++) {
      const s = base[e % base.length];
      spawns.push({ x: s.x + (Math.random() - 0.5) * 34, z: s.z + (Math.random() - 0.5) * 34, patrolRadius: s.patrolRadius });
    }
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      const group = createFarmer(i % 3);
      group.position.set(s.x, terrainHeight(s.x, s.z), s.z);
      group.rotation.y = Math.random() * Math.PI * 2;
      group.add(blobShadow(0.7));

      // angry "!" above the head (pops once per aggro)
      const bang = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.22), bangMat);
      bar.position.y = 0.55;
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), bangMat);
      bang.add(bar);
      bang.add(dot);
      bang.position.y = 2.55;
      bang.visible = false;
      group.add(bang);

      scene.add(group);
      this.farmers.push({
        group,
        ud: group.userData || {},
        bang,
        home: { x: s.x, z: s.z },
        groundY: terrainHeight(s.x, s.z),
        patrolR: s.patrolRadius,
        state: 'patrol',
        tx: s.x, tz: s.z,
        idleT: 0.5 + Math.random() * 1.5,
        walk: Math.random() * 10,
        phase: Math.random() * 10,
        fireT: 0.6 + Math.random() * 0.8,
        bangT: -1,
        aggroed: false,
        recoil: 0,
      });
    }

    // ---- pooled tracer bullets ----
    this._bullets = [];
    this._bCursor = 0;
    const bGeo = new THREE.BoxGeometry(0.16, 0.16, 1.7);
    for (let i = 0; i < BULLET_POOL; i++) {
      const mesh = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this._bullets.push({ mesh, vel: new THREE.Vector3(), life: 0, active: false });
    }

    // UFO velocity estimate (for leading shots — not part of the UFO contract)
    this._prevUfo = new THREE.Vector3();
    this._ufoVel = new THREE.Vector3();
    this._havePrev = false;
  }

  update(dt, ufo) {
    this._t += dt;
    const up = ufo.group.position;
    const ufoAlive = !ufo.dead && !ufo.crashing;

    // estimate + smooth UFO velocity for shot leading
    if (this._havePrev && dt > 0) {
      _v.copy(up).sub(this._prevUfo).divideScalar(dt);
      this._ufoVel.lerp(_v, Math.min(1, dt * 8));
    }
    this._prevUfo.copy(up);
    this._havePrev = true;

    for (let i = 0; i < this.farmers.length; i++) {
      const f = this.farmers[i];
      const g = f.group;
      const dx = up.x - g.position.x;
      const dz = up.z - g.position.z;
      const d = Math.hypot(dx, dz);

      // ---- state select (with hysteresis) ----
      let st = 'patrol';
      if (ufoAlive) {
        const shootR = f.state === 'shoot' ? CFG.FARMER_RANGE * SHOOT_EXIT_MULT : CFG.FARMER_RANGE;
        const aggroR = f.aggroed ? CFG.FARMER_AGGRO * DEAGGRO_MULT : CFG.FARMER_AGGRO;
        if (d < shootR) st = 'shoot';
        else if (d < aggroR) st = 'chase';
      }
      if (st !== 'patrol' && !f.aggroed) {
        f.aggroed = true;
        f.bangT = 0;
        f.bang.visible = true;
        // farmer hollers when he spots you
        this.audio.play('farmer', {
          volume: THREE.MathUtils.clamp(1 - d / 90, 0.2, 0.8), ratejitter: 0.14,
        });
      } else if (st === 'patrol' && f.aggroed) {
        f.aggroed = false;
      }
      f.state = st;

      // ---- "!" pop animation (overshoot in, hold, shrink out) ----
      if (f.bangT >= 0) {
        f.bangT += dt;
        const bt = f.bangT;
        let s;
        if (bt < 0.18) s = (bt / 0.18) * 1.5;
        else if (bt < 0.35) s = 1.5 - ((bt - 0.18) / 0.17) * 0.5;
        else s = 1;
        if (bt > 1.3) s = Math.max(0, 1 - (bt - 1.3) * 4);
        if (bt > 1.55) {
          f.bang.visible = false;
          f.bangT = -1;
        } else {
          f.bang.scale.setScalar(Math.max(0.001, s));
          f.bang.position.y = 2.55 + Math.sin(this._t * 10) * 0.08;
          f.bang.rotation.y = -g.rotation.y; // keep facing the camera side
        }
      }

      f.recoil *= Math.exp(-9 * dt);

      if (st === 'shoot') {
        this._doShoot(f, ufo, d, dx, dz, dt);
      } else if (st === 'chase') {
        this._gunRest(f, dt);
        this._walkToward(f, up.x, up.z, CFG.FARMER_RUN, dt);
        this._animRun(f, dt);
        f.fireT = Math.max(f.fireT, 0.25); // brief shoulder-up delay after closing in
      } else {
        this._gunRest(f, dt);
        this._doPatrol(f, dt);
      }
    }

    this._updateBullets(dt, ufo, ufoAlive);
  }

  // ============================== external alerts ==============================

  /**
   * A sheepdog rats the player out: nudge the nearest NON-aggroed farmer into
   * the chase, pointed at `pos`, even if it couldn't see the UFO itself.
   * Safe + cheap to call frequently — no-op when every farmer is already
   * aggroed. Sets the aggro flags + pops the existing "!" so the normal
   * chase→shoot state machine takes over from the next update().
   */
  alertNearest(pos) {
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < this.farmers.length; i++) {
      const f = this.farmers[i];
      if (f.aggroed) continue; // already chasing/shooting — leave it alone
      const dx = pos.x - f.group.position.x;
      const dz = pos.z - f.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = f; }
    }
    if (!best) return; // everyone's already aggroed — nothing to do
    best.aggroed = true;
    best.state = 'chase';
    best.tx = pos.x;
    best.tz = pos.z;
    best.bangT = 0;            // trigger the "!" pop
    best.bang.visible = true;
    best.fireT = Math.max(best.fireT, 0.25);
    this.audio.play('scream', { volume: 0.6, ratejitter: 0.14 });
  }

  // ============================== states ==============================

  _doPatrol(f, dt) {
    const g = f.group;
    if (f.idleT > 0) {
      f.idleT -= dt;
      this._animIdle(f, dt);
      return;
    }
    const ddx = f.tx - g.position.x;
    const ddz = f.tz - g.position.z;
    if (ddx * ddx + ddz * ddz < 1) {
      if (Math.random() < 0.4) f.idleT = 1 + Math.random() * 2.5;
      this._pickPatrol(f);
    } else {
      this._walkToward(f, f.tx, f.tz, CFG.FARMER_WALK, dt);
      this._animWalkCycle(f, dt, 7.5, 0.5, 0.42, -0.05);
    }
  }

  _doShoot(f, ufo, d, dx, dz, dt) {
    const g = f.group;
    const ud = f.ud;
    const up = ufo.group.position;

    // plant feet, square up to the ship
    const diff = wrapAngle(Math.atan2(dx, dz) - g.rotation.y);
    g.rotation.y += diff * Math.min(1, dt * 6);

    // raise + aim the gun (slight elevation toward the ship)
    const elev = Math.atan2(up.y - (f.groundY + 1.4), Math.max(0.001, d));
    if (ud.gun) ud.gun.rotation.x += ((-elev * 0.9 + f.recoil) - ud.gun.rotation.x) * Math.min(1, dt * 9);
    const arms = ud.arms;
    if (arms) {
      if (arms[1]) arms[1].rotation.x += ((-0.95 - elev * 0.5) - arms[1].rotation.x) * Math.min(1, dt * 8);
      if (arms[0]) arms[0].rotation.x += ((-0.65 - elev * 0.4) - arms[0].rotation.x) * Math.min(1, dt * 8);
    }
    const legs = ud.legs;
    if (legs) {
      if (legs[0]) legs[0].rotation.x *= Math.exp(-8 * dt);
      if (legs[1]) legs[1].rotation.x *= Math.exp(-8 * dt);
    }
    g.position.y += (f.groundY - g.position.y) * Math.min(1, dt * 8); // settle any run-bounce

    f.fireT -= dt;
    if (f.fireT <= 0 && Math.abs(diff) < 0.5) {
      f.fireT = CFG.FARMER_FIRE_RATE * this._fireMul * (0.85 + Math.random() * 0.35);
      this._fire(f, ufo, d);
    }
  }

  // ============================== shooting ==============================

  _fire(f, ufo, d) {
    const ud = f.ud;
    f.group.updateMatrixWorld(true);
    if (ud.gunTip) {
      ud.gunTip.getWorldPosition(_v);
    } else {
      _v.copy(f.group.position);
      _v.y += 1.4;
    }

    // lead the target: aim where the UFO will be when the bullet arrives
    const tof = d / CFG.BULLET_SPEED;
    _v2.copy(ufo.group.position);
    _v2.x += this._ufoVel.x * tof * 0.85;
    _v2.z += this._ufoVel.z * tof * 0.85;
    _v2.y += 0.8; // hull center
    // small spread
    _v2.x += (Math.random() - 0.5) * 2.2;
    _v2.y += (Math.random() - 0.5) * 1.6;
    _v2.z += (Math.random() - 0.5) * 2.2;
    _v3.copy(_v2).sub(_v).normalize();

    const b = this._bullets[this._bCursor];
    this._bCursor = (this._bCursor + 1) % BULLET_POOL;
    b.active = true;
    b.life = CFG.BULLET_LIFETIME;
    b.mesh.visible = true;
    b.mesh.position.copy(_v);
    b.vel.copy(_v3).multiplyScalar(CFG.BULLET_SPEED);
    _v2.copy(_v).add(_v3);
    b.mesh.lookAt(_v2); // stretch axis along flight

    this.effects.muzzleFlash(_v);
    this.audio.play('gunshot', {
      volume: THREE.MathUtils.clamp(1 - d / 120, 0.25, 0.85),
      ratejitter: 0.12,
    });
    f.recoil = 0.3;
  }

  _updateBullets(dt, ufo, ufoAlive) {
    const hitR2 = UFO_HIT_R * UFO_HIT_R;
    if (ufoAlive) {
      _v.copy(ufo.group.position);
      _v.y += 0.9; // hull center
    }
    for (let i = 0; i < BULLET_POOL; i++) {
      const b = this._bullets[i];
      if (!b.active) continue;
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.life <= 0 ||
          b.mesh.position.y < terrainHeight(b.mesh.position.x, b.mesh.position.z)) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      if (ufoAlive && b.mesh.position.distanceToSquared(_v) < hitR2) {
        this.effects.bulletSpark(b.mesh.position);
        if (this.onHitPlayer) this.onHitPlayer(CFG.BULLET_DAMAGE);
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  // ============================== locomotion ==============================

  _walkToward(f, tx, tz, speed, dt) {
    const g = f.group;
    const diff = wrapAngle(Math.atan2(tx - g.position.x, tz - g.position.z) - g.rotation.y);
    g.rotation.y += diff * Math.min(1, dt * 7);

    const fx = Math.sin(g.rotation.y);
    const fz = Math.cos(g.rotation.y);

    // farmers never enter water
    if (this.world.isWater(g.position.x + fx * 1.5, g.position.z + fz * 1.5)) {
      g.rotation.y += (f.phase % 2 < 1 ? 1 : -1) * dt * 3;
      if (f.state === 'patrol') this._pickPatrol(f);
      return;
    }

    let nx = g.position.x + fx * speed * dt;
    let nz = g.position.z + fz * speed * dt;

    // fences are solid for farmers too — they take the gates
    if (this.world.crossesFence &&
        this.world.crossesFence(g.position.x, g.position.z, nx + fx * 0.5, nz + fz * 0.5)) {
      g.rotation.y += (f.phase % 2 < 1 ? 1 : -1) * dt * 4;
      if (f.state === 'patrol') this._pickPatrol(f);
      return;
    }

    const colliders = this.world.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      const ddx = nx - col.x;
      const ddz = nz - col.z;
      const rr = col.r + 0.6;
      if (Math.abs(ddx) > rr || Math.abs(ddz) > rr) continue;
      const dd2 = ddx * ddx + ddz * ddz;
      if (dd2 < rr * rr && dd2 > 1e-6) {
        const dd = Math.sqrt(dd2);
        nx = col.x + (ddx / dd) * rr;
        nz = col.z + (ddz / dd) * rr;
        g.rotation.y += dt * 2.5;
      }
    }

    const lim = CFG.MAP_HALF - 3; // never leave the map
    g.position.x = THREE.MathUtils.clamp(nx, -lim, lim);
    g.position.z = THREE.MathUtils.clamp(nz, -lim, lim);
    f.groundY = terrainHeight(g.position.x, g.position.z);
  }

  _pickPatrol(f) {
    const lim = CFG.MAP_HALF - 4;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * f.patrolR;
      const x = f.home.x + Math.cos(a) * r;
      const z = f.home.z + Math.sin(a) * r;
      if (x < -lim || x > lim || z < -lim || z > lim) continue;
      if (this.world.isWater(x, z)) continue;
      f.tx = x;
      f.tz = z;
      return;
    }
    f.tx = f.home.x;
    f.tz = f.home.z;
  }

  // ============================== animation ==============================

  _animWalkCycle(f, dt, rate, legAmp, armAmp, armBase) {
    f.walk += dt * rate;
    const w = f.walk + f.phase;
    const ud = f.ud;
    const legs = ud.legs;
    if (legs) {
      if (legs[0]) legs[0].rotation.x = Math.sin(w) * legAmp;
      if (legs[1]) legs[1].rotation.x = Math.sin(w + Math.PI) * legAmp * 1.05;
    }
    const arms = ud.arms;
    if (arms) { // arms counter-swing the legs
      if (arms[0]) arms[0].rotation.x = Math.sin(w + Math.PI) * armAmp + armBase;
      if (arms[1]) arms[1].rotation.x = Math.sin(w) * armAmp + armBase;
    }
    f.group.position.y = f.groundY + Math.abs(Math.sin(w)) * (rate > 10 ? 0.07 : 0.03);
    if (ud.head) ud.head.rotation.x = Math.sin(w * 2) * 0.04;
  }

  _animRun(f, dt) {
    // pumping arms, big strides
    this._animWalkCycle(f, dt, 13, 0.9, 1.05, -0.45);
  }

  _animIdle(f, dt) {
    const ud = f.ud;
    const k = Math.exp(-5 * dt);
    const legs = ud.legs;
    if (legs) {
      if (legs[0]) legs[0].rotation.x *= k;
      if (legs[1]) legs[1].rotation.x *= k;
    }
    const arms = ud.arms;
    if (arms) {
      if (arms[0]) arms[0].rotation.x *= k;
      if (arms[1]) arms[1].rotation.x *= k;
    }
    f.group.position.y += (f.groundY - f.group.position.y) * Math.min(1, dt * 5);
    if (ud.head) ud.head.rotation.x = Math.sin(this._t * 1.4 + f.phase) * 0.05; // looking about
  }

  _gunRest(f, dt) {
    if (f.ud.gun) f.ud.gun.rotation.x *= Math.exp(-6 * dt);
  }
}
