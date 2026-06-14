// MOO-FO — js/dogs.js
// Sheepdogs ("Astro"): border collies that patrol the farm, then bolt after the
// UFO when it strays near — barking, running at double the farmer sprint, and
// ratting the player out to the nearest farmer. They are the early-warning net:
// their detection radius is wider than a farmer's aggro range, so a dog can pull
// a far-off farmer onto you before that farmer would ever notice the ship.
//
// Mirrors FarmerManager's shape: a `dogs` array of { group, ... } for the
// minimap, an update(dt, ufo) state machine, and a dispose().

import * as THREE from 'three';
import { CFG, COLORS } from './config.js';
import { createDog, blobShadow } from './models.js';
import { terrainHeight } from './terrain.js';

const DOG_COUNT = 3;
// Detection net: dogs are mobile, so even a 70-unit trigger reaches the player
// in spots no static farmer can — a dog spots the ship, sprints over, and drags
// a farmer onto you who'd never have seen it from their own patrol.
const DETECT_R = 70;
const DEAGGRO_MULT = 1.35;       // chase persists out to DETECT_R × this
const ALERT_R = 55;              // within this of the UFO, the dog phones a farmer
const ALERT_INTERVAL = 1.2;      // s — min seconds between a dog's alerts
const DOG_RUN = CFG.FARMER_RUN * 2; // dogs are FAST — double the farmer sprint
const DOG_PATROL = CFG.FARMER_WALK * 1.1;
const PATROL_R = 34;             // roam radius around each dog's home

const _v = new THREE.Vector3();

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export class DogManager {
  constructor(scene, world, effects, audio, { farmers } = {}) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.farmers = farmers || null;

    this.dogs = []; // [{ group, ... }] — read by the minimap
    this._t = 0;

    // Home spots: sit the pack near the farm. Prefer the farmer spawns (the
    // farmhouse cluster), then fall back to the origin — always nudged onto dry,
    // in-bounds ground.
    const spawns = (world.farmerSpawns && world.farmerSpawns.length)
      ? world.farmerSpawns
      : [{ x: 58, z: 0 }];

    for (let i = 0; i < DOG_COUNT; i++) {
      const base = spawns[i % spawns.length];
      const spot = this._findGround(base.x, base.z);

      const group = createDog();
      group.position.set(spot.x, terrainHeight(spot.x, spot.z), spot.z);
      group.rotation.y = Math.random() * Math.PI * 2;
      group.add(blobShadow(0.5));
      scene.add(group);

      this.dogs.push({
        group,
        ud: group.userData || {},
        home: { x: spot.x, z: spot.z },
        groundY: terrainHeight(spot.x, spot.z),
        state: 'patrol',      // 'patrol' | 'chase'
        tx: spot.x, tz: spot.z,
        idleT: 0.4 + Math.random() * 1.8,
        run: Math.random() * 10,   // run-cycle phase accumulator
        phase: Math.random() * 10, // per-dog desync
        wag: Math.random() * 10,
        barkT: 0.3 + Math.random() * 0.6,
        alertT: 0,
        aggroed: false,
      });
    }
  }

  // Find a dry, in-bounds spot near (x, z) to plant a dog home.
  _findGround(x, z) {
    const lim = CFG.MAP_HALF - 6;
    for (let k = 0; k < 12; k++) {
      const r = k === 0 ? 0 : 6 + Math.random() * 14;
      const a = Math.random() * Math.PI * 2;
      const nx = THREE.MathUtils.clamp(x + Math.cos(a) * r, -lim, lim);
      const nz = THREE.MathUtils.clamp(z + Math.sin(a) * r, -lim, lim);
      if (!this.world.isWater(nx, nz)) return { x: nx, z: nz };
    }
    return { x: THREE.MathUtils.clamp(x, -lim, lim), z: THREE.MathUtils.clamp(z, -lim, lim) };
  }

  update(dt, ufo) {
    this._t += dt;
    const up = ufo.group.position;
    const ufoAlive = !ufo.dead && !ufo.crashing;

    for (let i = 0; i < this.dogs.length; i++) {
      const d = this.dogs[i];
      const g = d.group;
      d.alertT -= dt;

      let st = 'patrol';
      if (ufoAlive) {
        const dx = up.x - g.position.x;
        const dz = up.z - g.position.z;
        const dist = Math.hypot(dx, dz);
        const detect = d.aggroed ? DETECT_R * DEAGGRO_MULT : DETECT_R;
        if (dist < detect) st = 'chase';
        d._dist = dist;
      }
      d.aggroed = st === 'chase';
      d.state = st;

      if (st === 'chase') {
        // Sprint to the point under the UFO, barking and streaming.
        this._walkToward(d, up.x, up.z, DOG_RUN, dt);
        this._animRun(d, dt);
        this._bark(d, dt);

        // Within alerting range, rat the player out to the nearest farmer.
        if (this.farmers && d._dist < ALERT_R && d.alertT <= 0) {
          d.alertT = ALERT_INTERVAL;
          this.farmers.alertNearest(up);
        }
      } else {
        this._doPatrol(d, dt);
      }
    }
  }

  // ============================== states ==============================

  _doPatrol(d, dt) {
    const g = d.group;
    if (d.idleT > 0) {
      d.idleT -= dt;
      this._animIdle(d, dt);
      return;
    }
    const ddx = d.tx - g.position.x;
    const ddz = d.tz - g.position.z;
    if (ddx * ddx + ddz * ddz < 1) {
      if (Math.random() < 0.45) d.idleT = 0.8 + Math.random() * 2.2;
      this._pickPatrol(d);
    } else {
      this._walkToward(d, d.tx, d.tz, DOG_PATROL, dt);
      this._animTrot(d, dt);
    }
  }

  _pickPatrol(d) {
    const lim = CFG.MAP_HALF - 6;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * PATROL_R;
      const x = d.home.x + Math.cos(a) * r;
      const z = d.home.z + Math.sin(a) * r;
      if (x < -lim || x > lim || z < -lim || z > lim) continue;
      if (this.world.isWater(x, z)) continue;
      d.tx = x;
      d.tz = z;
      return;
    }
    d.tx = d.home.x;
    d.tz = d.home.z;
  }

  // ============================== locomotion ==============================
  // Same constraints as the farmers: never enter water, slide off colliders,
  // respect fences/gates, stay on the terrain and inside the map.

  _walkToward(d, tx, tz, speed, dt) {
    const g = d.group;
    const diff = wrapAngle(Math.atan2(tx - g.position.x, tz - g.position.z) - g.rotation.y);
    g.rotation.y += diff * Math.min(1, dt * 9); // dogs turn snappier than farmers

    const fx = Math.sin(g.rotation.y);
    const fz = Math.cos(g.rotation.y);

    // dogs never swim
    if (this.world.isWater(g.position.x + fx * 1.2, g.position.z + fz * 1.2)) {
      g.rotation.y += (d.phase % 2 < 1 ? 1 : -1) * dt * 3.5;
      if (d.state === 'patrol') this._pickPatrol(d);
      return;
    }

    let nx = g.position.x + fx * speed * dt;
    let nz = g.position.z + fz * speed * dt;

    // fences are solid — take the gates like the farmers do
    if (this.world.crossesFence &&
        this.world.crossesFence(g.position.x, g.position.z, nx + fx * 0.4, nz + fz * 0.4)) {
      g.rotation.y += (d.phase % 2 < 1 ? 1 : -1) * dt * 4;
      if (d.state === 'patrol') this._pickPatrol(d);
      return;
    }

    const colliders = this.world.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      const ddx = nx - col.x;
      const ddz = nz - col.z;
      const rr = col.r + 0.45;
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
    d.groundY = terrainHeight(g.position.x, g.position.z);
  }

  // ============================== animation ==============================

  // Shared leg/tail/head drive. legAmp = stride, bounce = vertical hop.
  _animGait(d, dt, rate, legAmp, bounce, headBob) {
    d.run += dt * rate;
    const w = d.run + d.phase;
    const ud = d.ud;
    const legs = ud.legs;
    if (legs) {
      // diagonal trot pairs: FL+BR together, FR+BL opposite
      if (legs[0]) legs[0].rotation.x = Math.sin(w) * legAmp;
      if (legs[3]) legs[3].rotation.x = Math.sin(w) * legAmp;
      if (legs[1]) legs[1].rotation.x = Math.sin(w + Math.PI) * legAmp;
      if (legs[2]) legs[2].rotation.x = Math.sin(w + Math.PI) * legAmp;
    }
    d.group.position.y = d.groundY + Math.abs(Math.sin(w)) * bounce;
    if (ud.head) ud.head.rotation.x = headBob + Math.sin(w * 2) * 0.05;
  }

  _animTrot(d, dt) {
    this._animGait(d, dt, 11, 0.55, 0.04, 0);
    this._wagTail(d, dt, 9, 0.45, -0.4); // happy wag, tail up
  }

  _animRun(d, dt) {
    // Full gallop: long strides, real bounce, head thrust low for the bark.
    this._animGait(d, dt, 18, 1.0, 0.1, 0.18);
    this._streamTail(d, dt);
  }

  _animIdle(d, dt) {
    const ud = d.ud;
    const k = Math.exp(-6 * dt);
    const legs = ud.legs;
    if (legs) for (let i = 0; i < legs.length; i++) if (legs[i]) legs[i].rotation.x *= k;
    d.group.position.y += (d.groundY - d.group.position.y) * Math.min(1, dt * 6);
    if (ud.head) ud.head.rotation.x = Math.sin(this._t * 1.6 + d.phase) * 0.06; // sniffing about
    this._wagTail(d, dt, 6, 0.3, -0.35); // idle wag
  }

  _wagTail(d, dt, rate, amp, base) {
    d.wag += dt * rate;
    const tail = d.ud.tail;
    if (!tail) return;
    tail.rotation.y = Math.sin(d.wag) * amp;
    tail.rotation.x += (base - tail.rotation.x) * Math.min(1, dt * 6);
  }

  _streamTail(d, dt) {
    d.wag += dt * 16;
    const tail = d.ud.tail;
    if (!tail) return;
    // tail held high and flagging fast behind the gallop
    tail.rotation.y = Math.sin(d.wag) * 0.5;
    tail.rotation.x += (-0.7 - tail.rotation.x) * Math.min(1, dt * 7);
  }

  // ============================== bark ==============================
  // No dedicated bark wav exists. 'chicken' is the only animal-voice SFX;
  // dropped ~half an octave (rate ~0.5) with jitter it lands as a gruff "woof".
  _bark(d, dt) {
    d.barkT -= dt;
    if (d.barkT > 0) return;
    d.barkT = 0.55 + Math.random() * 0.7;
    // distance-scaled volume so a far-off pack doesn't drown the mix
    const dist = d._dist || 0;
    const vol = THREE.MathUtils.clamp(1 - dist / 90, 0.18, 0.6);
    this.audio.play('chicken', { volume: vol, rate: 0.5, ratejitter: 0.18 });
    // snap the head down for the bark thrust
    if (d.ud.head) d.ud.head.rotation.x = 0.42;
  }

  // ============================== teardown ==============================

  dispose() {
    for (let i = 0; i < this.dogs.length; i++) {
      const g = this.dogs[i].group;
      if (g.parent) g.parent.remove(g);
      else this.scene.remove(g);
    }
    this.dogs.length = 0;
  }
}
