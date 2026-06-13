// MOO-FO — js/ufo.js (Agent G)
// Player ship: buttery accel/friction movement, banking, hover bob, warp,
// animated abduction beam, collisions vs world colliders, damage + crash.

import * as THREE from 'three';
import { CFG, COLORS, IS_MOBILE } from './config.js';
import { createUFO, blobShadow } from './models.js';
import { terrainMaxAround } from './terrain.js';

const SHIP_RADIUS = 2.3;       // collision radius vs world colliders
const FLIGHT_CLEARANCE = 1.5;  // colliders shorter than (altitude - this) are flown over
const FLASH_TIME = 0.45;       // damage flash duration
const RING_CYCLE = 0.9;        // ground ring expansion period

const _v = new THREE.Vector3();

export class UFO {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;

    // ---- ship ----
    this.group = createUFO();
    this.group.position.set(0, CFG.UFO_ALTITUDE, 0);
    scene.add(this.group);
    this.ud = this.group.userData || {};

    // ---- public state (spec contract) ----
    this.maxHealth = CFG.UFO_MAX_HEALTH;
    this.health = this.maxHealth;
    this.warpEnergy = 1;
    this.beamActive = false;
    this.warping = false;
    this.heading = 0;
    this.dead = false;
    this.crashing = false;
    this.velocity = new THREE.Vector3();

    // ---- unique materials so the damage flash can't bleed into the shared mat() cache ----
    this._mats = [];
    const seen = new Map();
    this.group.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      let rec = seen.get(o.material);
      if (!rec) {
        const m = o.material.clone();
        rec = {
          m,
          hex: m.emissive ? m.emissive.getHex() : 0,
          intensity: m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1,
        };
        seen.set(o.material, rec);
        this._mats.push(rec);
      }
      o.material = rec.m;
    });
    this._flashed = false;

    this._lights = this.ud.lights || [];
    this._lightBase = this._lights.map((l) => l.scale.x || 1);

    // ---- beam: outer cone + inner bright core, hung from beamAnchor, unit height scaled to ground ----
    const beam = new THREE.Group();
    const coneGeo = new THREE.CylinderGeometry(0.55, CFG.BEAM_RADIUS, 1, 18, 1, true);
    coneGeo.translate(0, -0.5, 0); // top at local 0, extends down
    this._coneMat = new THREE.MeshBasicMaterial({
      color: COLORS.beam, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._cone = new THREE.Mesh(coneGeo, this._coneMat);
    const innerGeo = new THREE.CylinderGeometry(0.5, 1.05, 1, 12, 1, true);
    innerGeo.translate(0, -0.5, 0);
    this._innerMat = new THREE.MeshBasicMaterial({
      color: 0xeafff0, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._inner = new THREE.Mesh(innerGeo, this._innerMat);
    beam.add(this._cone);
    beam.add(this._inner);
    beam.visible = false;
    (this.ud.beamAnchor || this.group).add(beam);
    this.beamMesh = beam;

    // expanding ground rings
    this._rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1.0, 26);
    for (let i = 0; i < 3; i++) {
      const rm = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: COLORS.beam, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      rm.rotation.x = -Math.PI / 2;
      rm.visible = false;
      scene.add(rm);
      this._rings.push(rm);
    }

    // beam point light — desktop only
    this.beamLight = null;
    if (!IS_MOBILE) {
      this.beamLight = new THREE.PointLight(COLORS.beam, 0, 30, 1.8);
      scene.add(this.beamLight);
    }

    // blob shadow on the ground
    this._shadow = blobShadow(2.9);
    if (this._shadow.material) this._shadow.material = this._shadow.material.clone();
    scene.add(this._shadow);
    this._shadowBaseOp = this._shadow.material ? this._shadow.material.opacity : 0.3;

    // ---- internals ----
    this._t = 0;
    this._invuln = 0;
    this._flash = 0;
    this._humOn = false;
    this._humVol = 0;
    this._beamVis = 0;       // smoothed 0..1 beam visual amount
    this._warpRise = 0;
    this._speedCap = CFG.UFO_SPEED;
    this._bobKick = 0;       // small altitude dip on hit
    this._beamPos = { x: 0, z: 0 };
    this._crashVy = 0;
    this._crashT = 0;
    this._smokeT = 0;
    this._groundY = 0;       // smoothed terrain height under the ship
  }

  /** Hard-exit beam mode (round end, menus) — state, sound and visuals. */
  forceStopBeam() {
    if (this.beamActive) {
      this.beamActive = false;
      this.audio.stopLoop('beam');
    }
    this._beamVis = 0;
    this.beamMesh.visible = false;
    for (let i = 0; i < this._rings.length; i++) this._rings[i].visible = false;
    if (this.beamLight) this.beamLight.intensity = 0;
  }

  // {x, z} of the beam center on the ground (reused object — no allocation).
  beamWorldPos() {
    this._beamPos.x = this.group.position.x;
    this._beamPos.z = this.group.position.z;
    return this._beamPos;
  }

  takeDamage(amount) {
    if (this.dead || this.crashing) return false;
    if (this._invuln > 0) return false;
    this._invuln = CFG.HIT_INVULN;
    this._flash = FLASH_TIME;
    this._flashed = true;
    this.health = Math.max(0, this.health - amount);
    this.audio.play('hit', { volume: 0.8, ratejitter: 0.12 });
    // knockback-lite: a shove + a little altitude dip
    const a = Math.random() * Math.PI * 2;
    this.velocity.x += Math.cos(a) * 3.5;
    this.velocity.z += Math.sin(a) * 3.5;
    this._bobKick = 0.55;
    return this.health <= 0;
  }

  startCrash() {
    if (this.crashing || this.dead) return;
    this.crashing = true;
    this.warping = false;
    if (this.beamActive) {
      this.beamActive = false;
      this.audio.stopLoop('beam');
    }
    this.audio.stopLoop('ufo_hum');
    this._humOn = false;
    this._crashVy = 0;
    this._crashT = 0;
    this._smokeT = 0;
    this._beamVis = 0;
    this.beamMesh.visible = false;
    for (let i = 0; i < this._rings.length; i++) this._rings[i].visible = false;
    if (this.beamLight) this.beamLight.intensity = 0;
    this.effects.warpStreaks(false, this.group);
  }

  reset(x, z) {
    this._groundY = terrainMaxAround(x, z, 2.5);
    this.group.position.set(x, this._groundY + CFG.UFO_ALTITUDE, z);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.warpEnergy = 1;
    this.heading = 0;
    this.dead = false;
    this.crashing = false;
    this.warping = false;
    this._invuln = 0;
    this._flash = 0;
    this._bobKick = 0;
    this._warpRise = 0;
    this._beamVis = 0;
    this._speedCap = CFG.UFO_SPEED;
    this._restoreMats();
    if (this.beamActive) {
      this.beamActive = false;
      this.audio.stopLoop('beam');
    }
    this.audio.stopLoop('ufo_hum');
    this._humOn = false; // hum restarts on next update
    this.beamMesh.visible = false;
    for (let i = 0; i < this._rings.length; i++) this._rings[i].visible = false;
    if (this.beamLight) this.beamLight.intensity = 0;
    this._shadow.visible = true;
    for (let i = 0; i < this._lights.length; i++) {
      this._lights[i].visible = true;
      this._lights[i].scale.setScalar(this._lightBase[i]);
    }
  }

  update(dt, input) {
    this._t += dt;
    if (this.dead) {
      this.effects.warpStreaks(false, this.group);
      return;
    }
    if (!this._humOn) {
      this.audio.startLoop('ufo_hum', { volume: 0.05 });
      this._humOn = true;
      this._humVol = 0.05;
    }
    if (this.crashing) {
      this._updateCrash(dt);
      return;
    }

    if (this._invuln > 0) this._invuln -= dt;
    if (this._bobKick > 0) this._bobKick *= Math.exp(-5 * dt);

    const ix = input ? input.x || 0 : 0;
    const iz = input ? input.z || 0 : 0;
    const wantBeamInput = !!(input && input.beam);
    const wantWarpInput = !!(input && input.warp);

    // ---- warp energy ----
    const wasWarping = this.warping;
    const canWarp = wasWarping ? this.warpEnergy > 0 : this.warpEnergy > 0.12;
    this.warping = wantWarpInput && canWarp;
    if (this.warping && !wasWarping) this.audio.play('warp', { volume: 0.7, ratejitter: 0.05 });
    if (this.warping) this.warpEnergy = Math.max(0, this.warpEnergy - CFG.WARP_DRAIN * dt);
    else this.warpEnergy = Math.min(1, this.warpEnergy + CFG.WARP_REGEN * dt);

    // ---- beam toggle (warp overrides beam) ----
    const wantBeam = wantBeamInput && !this.warping;
    if (wantBeam !== this.beamActive) {
      this.beamActive = wantBeam;
      if (wantBeam) this.audio.startLoop('beam', { volume: 0.55 });
      else this.audio.stopLoop('beam');
    }

    // ---- movement: accel toward input, exponential friction, smoothed speed cap ----
    const capTarget = CFG.UFO_SPEED *
      (this.warping ? CFG.WARP_MULT : 1) *
      (this.beamActive ? CFG.BEAM_SLOW : 1);
    this._speedCap += (capTarget - this._speedCap) * Math.min(1, dt * 6);

    const hasInput = ix * ix + iz * iz > 0.001;
    if (hasInput) {
      const accel = CFG.UFO_ACCEL * (this.warping ? CFG.WARP_MULT : 1);
      this.velocity.x += ix * accel * dt;
      this.velocity.z += iz * accel * dt;
    }
    const damp = Math.exp(-(hasInput ? 0.6 : CFG.UFO_FRICTION) * dt);
    this.velocity.x *= damp;
    this.velocity.z *= damp;

    let speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > this._speedCap) {
      const k = this._speedCap / speed;
      this.velocity.x *= k;
      this.velocity.z *= k;
      speed = this._speedCap;
    }

    let px = this.group.position.x + this.velocity.x * dt;
    let pz = this.group.position.z + this.velocity.z * dt;

    // ---- collide vs tall colliders: push out + slide ----
    const alt = this.group.position.y;
    const colliders = this.world.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.h <= alt - FLIGHT_CLEARANCE) continue;
      const dx = px - c.x;
      const dz = pz - c.z;
      const rr = c.r + SHIP_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        px = c.x + nx * rr;
        pz = c.z + nz * rr;
        const vn = this.velocity.x * nx + this.velocity.z * nz;
        if (vn < 0) { // strip inward component → slide along
          this.velocity.x -= vn * nx;
          this.velocity.z -= vn * nz;
        }
      }
    }

    // ---- soft map bound: spring back inside ----
    const SB = CFG.SOFT_BOUND;
    if (px > SB) this.velocity.x += (SB - px) * 9 * dt;
    else if (px < -SB) this.velocity.x += (-SB - px) * 9 * dt;
    if (pz > SB) this.velocity.z += (SB - pz) * 9 * dt;
    else if (pz < -SB) this.velocity.z += (-SB - pz) * 9 * dt;
    const HB = CFG.MAP_HALF - 2; // absolute backstop
    px = THREE.MathUtils.clamp(px, -HB, HB);
    pz = THREE.MathUtils.clamp(pz, -HB, HB);

    this.group.position.x = px;
    this.group.position.z = pz;

    // ---- altitude: terrain-following + hover bob + warp rise - hit dip ----
    const gTarget = terrainMaxAround(px, pz, 3);
    this._groundY += (gTarget - this._groundY) * Math.min(1, dt * (gTarget > this._groundY ? 7 : 2.5));
    this._warpRise += ((this.warping ? 1.5 : 0) - this._warpRise) * Math.min(1, dt * 3);
    this.group.position.y =
      this._groundY + CFG.UFO_ALTITUDE + Math.sin(this._t * 1.7) * 0.35 + this._warpRise - this._bobKick;

    // ---- heading (minimap arrow), shortest-arc smoothing ----
    if (speed > 1.2) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      let diff = target - this.heading;
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.heading += diff * Math.min(1, dt * 8);
    }

    // ---- banking: roll + pitch into velocity, clamped & smoothed ----
    const tiltK = 0.24 + (this.warping ? 0.08 : 0);
    const targetRoll = THREE.MathUtils.clamp(-this.velocity.x / CFG.UFO_SPEED, -1.1, 1.1) * tiltK;
    const targetPitch = THREE.MathUtils.clamp(this.velocity.z / CFG.UFO_SPEED, -1.1, 1.1) * tiltK;
    const tk = Math.min(1, dt * 7);
    this.group.rotation.z += (targetRoll - this.group.rotation.z) * tk;
    this.group.rotation.x += (targetPitch - this.group.rotation.x) * tk;

    // ---- spinny bits ----
    if (this.ud.ring) this.ud.ring.rotation.y -= dt * 1.9;
    if (this.ud.dome) this.ud.dome.rotation.y += dt * 0.55;

    // ---- lights: chase pattern (two opposed hot spots running around the rim) ----
    const n = this._lights.length;
    if (n > 0) {
      const idx = Math.floor(this._t * 7) % n;
      const idx2 = (idx + (n >> 1)) % n;
      for (let i = 0; i < n; i++) {
        const hot = i === idx || i === idx2;
        this._lights[i].visible = true;
        this._lights[i].scale.setScalar(this._lightBase[i] * (hot ? 1.55 : 0.85));
      }
    }

    // ---- hum follows warp ----
    const humTarget = this.warping ? 0.8 : 0.35;
    this._humVol += (humTarget - this._humVol) * Math.min(1, dt * 4);
    this.audio.setLoopVolume('ufo_hum', this._humVol);

    this._updateBeamVisuals(dt);
    this._updateFlash(dt);

    // shadow
    this._shadow.position.x = px;
    this._shadow.position.z = pz;
    this._shadow.position.y = this._groundY + 0.05;
    const shScale = 1 + this._beamVis * 0.15 - this._warpRise * 0.06;
    this._shadow.scale.set(shScale, 1, shScale);

    this.effects.warpStreaks(this.warping, this.group);
  }

  // ============================== internals ==============================

  _updateBeamVisuals(dt) {
    const t = this._t;
    this._beamVis += ((this.beamActive ? 1 : 0) - this._beamVis) * Math.min(1, dt * 10);
    const vis = this._beamVis;
    const on = vis > 0.02;

    this.beamMesh.visible = on;
    if (on) {
      // reach the terrain regardless of bob/tilt (a little extra to bury the tip)
      this.beamMesh.scale.y = this.group.position.y - this._groundY + 1.5;
      const pulse = 1 + Math.sin(t * 9) * 0.05;
      this.beamMesh.scale.x = vis * pulse;
      this.beamMesh.scale.z = vis * pulse;
      this._cone.rotation.y += dt * 1.6;
      this._inner.rotation.y -= dt * 2.6;
      this._coneMat.opacity = vis * (0.2 + Math.sin(t * 9) * 0.05);
      this._innerMat.opacity = vis * (0.42 + Math.sin(t * 13 + 1) * 0.1);
    }

    const bx = this.group.position.x;
    const bz = this.group.position.z;
    for (let i = 0; i < this._rings.length; i++) {
      const rm = this._rings[i];
      rm.visible = on;
      if (!on) continue;
      const u = ((t / RING_CYCLE) + i / this._rings.length) % 1;
      const r = 1 + u * (CFG.BEAM_RADIUS * 1.35 - 1);
      rm.scale.set(r, r, 1);
      rm.material.opacity = vis * (1 - u) * 0.5;
      rm.position.set(bx, this._groundY + 0.1 + i * 0.013, bz);
    }

    if (this.beamLight) {
      this.beamLight.position.set(bx, this._groundY + 2.6, bz);
      this.beamLight.intensity = vis * (1.6 + Math.sin(t * 31) * 0.35);
    }
  }

  _updateFlash(dt) {
    if (this._flash > 0) {
      this._flash -= dt;
      const k = Math.max(0, this._flash / FLASH_TIME);
      const pulse = (Math.sin(this._t * 42) * 0.5 + 0.5) * k;
      for (let i = 0; i < this._mats.length; i++) {
        const r = this._mats[i];
        if (!r.m.emissive) continue;
        r.m.emissive.setHex(0xff4f4f);
        r.m.emissiveIntensity = 0.2 + pulse * 1.4;
      }
      if (this._flash <= 0) this._restoreMats();
    }
  }

  _restoreMats() {
    if (!this._flashed) return;
    this._flashed = false;
    for (let i = 0; i < this._mats.length; i++) {
      const r = this._mats[i];
      if (!r.m.emissive) continue;
      r.m.emissive.setHex(r.hex);
      r.m.emissiveIntensity = r.intensity;
    }
  }

  _updateCrash(dt) {
    this._crashT += dt;
    const ct = this._crashT;

    // horizontal drift decays, spin & wobble ramp up, descent accelerates
    const damp = Math.exp(-1.1 * dt);
    this.velocity.x *= damp;
    this.velocity.z *= damp;
    this.group.position.x += this.velocity.x * dt;
    this.group.position.z += this.velocity.z * dt;

    this._crashVy += 13 * dt;
    this.group.position.y -= this._crashVy * dt;

    this.group.rotation.y += (2.5 + ct * 5) * dt;
    const wob = Math.min(0.75, ct * 0.55);
    this.group.rotation.z = Math.sin(ct * 6.2) * wob;
    this.group.rotation.x = Math.cos(ct * 5.1) * wob;

    // sputtering lights
    for (let i = 0; i < this._lights.length; i++) {
      this._lights[i].visible = Math.random() > 0.45;
    }

    // smoke trail
    this._smokeT -= dt;
    if (this._smokeT <= 0) {
      this._smokeT = 0.12;
      this.effects.smokePuff(this.group.position);
    }

    // shadow tracks the fall
    const gy = terrainMaxAround(this.group.position.x, this.group.position.z, 2);
    this._shadow.position.x = this.group.position.x;
    this._shadow.position.z = this.group.position.z;
    this._shadow.position.y = gy + 0.05;

    this._updateFlash(dt);
    this.effects.warpStreaks(false, this.group);

    if (this.group.position.y <= gy + 0.6) {
      this.group.position.y = gy + 0.6;
      this.effects.explosion(this.group.position);
      this.audio.play('explosion', { volume: 1 });
      this.dead = true;
      this.crashing = false;
      this.group.visible = false;
      this._shadow.visible = false;
      this._restoreMats();
    }
  }
}
