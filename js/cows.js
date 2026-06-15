// MOO-FO — js/cows.js (Agent G)
// Cows, chickens and the golden cow: wander/graze/flee state machine,
// beam abduction (lift → consume / drop → stun), golden respawn.

import * as THREE from 'three';
import { CFG } from './config.js';
import { createCow, createChicken, createSheep, createDuck, createPig, createHorse, blobShadow } from './models.js';
import { terrainHeight, WATER_LEVEL } from './terrain.js';

const MOOS = ['moo1', 'moo2', 'moo3'];
const MOO_RANGE = 28;          // only moo when the UFO is fairly close (less ambient noise)
const FALL_GRAVITY = 28;
const STUN_TIME = 1.0;
const JUMP_TIME = 0.7;         // fence-hop duration
const CELL = 18;               // collider grid cell size
const WATER_Y = WATER_LEVEL + 0.05;

// ---- tiny spatial hash for static colliders (built once) ----
function buildGrid(colliders) {
  const map = new Map();
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const pad = c.r + 3.5;
    const x0 = Math.floor((c.x - pad) / CELL);
    const x1 = Math.floor((c.x + pad) / CELL);
    const z0 = Math.floor((c.z - pad) / CELL);
    const z1 = Math.floor((c.z + pad) / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx * 100000 + gz;
        let arr = map.get(key);
        if (!arr) { arr = []; map.set(key, arr); }
        arr.push(c);
      }
    }
  }
  return map;
}

function gridAt(map, x, z) {
  return map.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) || null;
}

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export class CowManager {
  constructor(scene, world, effects, audio, { onAbduct } = {}) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.onAbduct = onAbduct;

    this.cows = []; // live critters: { group, kind, ... } — read by the minimap
    this._grid = buildGrid(world.colliders);
    this._goldenT = -1;
    this._t = 0;
    this._pt = { x: 0, z: 0 }; // reusable spawn-point result
  }

  populate() {
    for (let i = 0; i < this.cows.length; i++) this.scene.remove(this.cows[i].group);
    this.cows.length = 0;
    this._goldenT = -1;

    const areas = this.world.cowSpawnAreas;
    for (let a = 0; a < areas.length; a++) {
      const area = areas[a];
      for (let i = 0; i < area.count; i++) {
        const p = this._spawnPointIn(area);
        this._add('cow', Math.random() < 0.62 ? 'holstein' : 'brown', p.x, p.z);
      }
    }
    const cAreas = this.world.chickenSpawnAreas;
    for (let a = 0; a < cAreas.length; a++) {
      const area = cAreas[a];
      for (let i = 0; i < area.count; i++) {
        const p = this._spawnPointIn(area);
        this._add('chicken', null, p.x, p.z);
      }
    }
    const sAreas = this.world.sheepSpawnAreas || [];
    for (let a = 0; a < sAreas.length; a++) {
      const area = sAreas[a];
      for (let i = 0; i < area.count; i++) {
        const p = this._spawnPointIn(area);
        this._add('sheep', null, p.x, p.z);
      }
    }
    const pAreas = this.world.pigSpawnAreas || [];
    for (let a = 0; a < pAreas.length; a++) {
      const area = pAreas[a];
      for (let i = 0; i < area.count; i++) {
        const p = this._spawnPointIn(area);
        this._add('pig', Math.random() < 0.7 ? 'pink' : 'spotted', p.x, p.z);
      }
    }
    const hAreas = this.world.horseSpawnAreas || [];
    for (let a = 0; a < hAreas.length; a++) {
      const area = hAreas[a];
      for (let i = 0; i < area.count; i++) {
        const p = this._spawnPointIn(area);
        this._add('horse', ['bay', 'brown', 'white'][(Math.random() * 3) | 0], p.x, p.z);
      }
    }
    // ducks paddle their ponds — atmosphere only, the beam ignores them
    const dAreas = this.world.duckAreas || [];
    const perPond = Math.max(1, Math.floor(CFG.DUCK_COUNT / Math.max(1, dAreas.length)));
    for (let a = 0; a < dAreas.length; a++) {
      for (let i = 0; i < perPond; i++) {
        const area = dAreas[a];
        const x = area.x + (Math.random() - 0.5) * area.rx;
        const z = area.z + (Math.random() - 0.5) * area.rz;
        const d = this._add('duck', null, x, z);
        d.pond = area;
      }
    }
    const g = this.world.goldenCowSpot();
    this._add('golden', 'golden', g.x, g.z);
  }

  /** Ground every airborne critter instantly (used when leaving a round). */
  releaseAll() {
    for (let i = 0; i < this.cows.length; i++) {
      const c = this.cows[i];
      if (c.state === 'lift' || c.state === 'fall' || c.state === 'jump') {
        const g = c.group;
        c.groundY = c.kind === 'duck' ? WATER_Y : terrainHeight(g.position.x, g.position.z);
        g.position.y = c.groundY;
        g.scale.setScalar(1);
        g.rotation.z = 0;
        c.vy = 0;
        c.state = 'wander';
        this._neutralPose(c);
        this._pickTarget(c);
        this._groundShadow(c);
      }
    }
  }

  update(dt, ufo) {
    this._t += dt;
    const up = ufo.group.position;
    const ufoAlive = !ufo.dead && !ufo.crashing;
    const beamOn = ufoAlive && ufo.beamActive;
    const bp = ufo.beamWorldPos();

    // golden cow respawn
    if (this._goldenT > 0) {
      this._goldenT -= dt;
      if (this._goldenT <= 0) {
        const s = this.world.goldenCowSpot();
        this._add('golden', 'golden', s.x, s.z);
      }
    }

    const fleeR2 = CFG.FLEE_RADIUS * CFG.FLEE_RADIUS;
    const beamFearR2 = (CFG.FLEE_RADIUS * 1.1) * (CFG.FLEE_RADIUS * 1.1);
    // Effective beam radius reflects the player's beam upgrade (ufo.beamRadius).
    const beamR = ufo.beamRadius || CFG.BEAM_RADIUS;
    const beamR2 = beamR * beamR;

    for (let i = this.cows.length - 1; i >= 0; i--) {
      const c = this.cows[i];
      const g = c.group;

      // ---------- airborne states ----------
      if (c.state === 'lift') {
        if (this._lift(c, dt, ufo, beamOn, bp)) this._consume(c, i);
        else this._groundShadow(c);
        continue;
      }
      if (c.state === 'fall') {
        this._fall(c, dt, beamOn, bp, beamR2);
        this._groundShadow(c);
        continue;
      }
      if (c.state === 'jump') {
        this._jump(c, dt);
        this._groundShadow(c);
        continue;
      }

      // ---------- ducks live on the water, on their own rules ----------
      if (c.kind === 'duck') {
        this._duck(c, dt, up, ufoAlive);
        continue;
      }

      const px = g.position.x;
      const pz = g.position.z;

      // ---------- beam capture (from any grounded state; ducks excluded above) ----------
      if (beamOn) {
        const dbx = px - bp.x;
        const dbz = pz - bp.z;
        if (dbx * dbx + dbz * dbz < beamR2) {
          this._startLift(c, up);
          this._groundShadow(c);
          continue;
        }
      }

      // ---------- stun (just dropped) ----------
      if (c.state === 'stun') {
        c.st -= dt;
        const k = Math.max(0, c.st / STUN_TIME);
        g.rotation.z = Math.sin(this._t * 16 + c.phase) * 0.09 * k;
        // un-squash
        g.scale.x += (1 - g.scale.x) * Math.min(1, dt * 6);
        g.scale.y += (1 - g.scale.y) * Math.min(1, dt * 6);
        g.scale.z = g.scale.x;
        if (c.st <= 0) {
          g.rotation.z = 0;
          g.scale.setScalar(1);
          c.state = 'wander';
          this._pickTarget(c);
        }
        this._groundShadow(c);
        continue;
      }

      // ---------- fear ----------
      const dux = px - up.x;
      const duz = pz - up.z;
      const dU2 = dux * dux + duz * duz;
      let scared = ufoAlive && dU2 < fleeR2;
      if (!scared && beamOn) {
        const dbx = px - bp.x;
        const dbz = pz - bp.z;
        scared = dbx * dbx + dbz * dbz < beamFearR2;
      }
      if (scared) {
        c.state = 'flee';
        c.calm = 0;
      } else {
        c.calm += dt;
      }

      // ---------- occasional moos / clucks (volume by distance to UFO) ----------
      c.mooT -= dt;
      if (c.mooT <= 0) {
        // Much longer gaps so the herd isn't mooing/clucking constantly.
        c.mooT = (c.kind === 'chicken' ? 9 : 16) + Math.random() * 26;
        const d = Math.sqrt(dU2);
        if (d < MOO_RANGE) {
          if (c.kind === 'chicken') {
            this.audio.play('chicken', {
              volume: THREE.MathUtils.clamp(0.8 - d / 80, 0.1, 0.7),
              ratejitter: 0.15,
            });
          } else if (c.kind === 'sheep') {
            this.audio.play('baa', {
              volume: THREE.MathUtils.clamp(0.7 - d / 90, 0.1, 0.6),
              ratejitter: 0.12,
            });
          } else if (c.kind === 'pig') {
            this.audio.play('oink', {
              volume: THREE.MathUtils.clamp(0.6 - d / 90, 0.1, 0.5),
              ratejitter: 0.14,
            });
          } else if (c.kind === 'horse') {
            this.audio.play('horse', {
              volume: THREE.MathUtils.clamp(0.5 - d / 90, 0.08, 0.4),
              ratejitter: 0.1,
            });
          } else {
            this.audio.play(MOOS[(Math.random() * 3) | 0], {
              volume: THREE.MathUtils.clamp(1 - d / 70, 0.15, 0.9),
              ratejitter: 0.07,
              rate: c.kind === 'golden' ? 1.12 : 1,
            });
          }
        }
      }

      // ---------- grounded behaviors ----------
      if (c.state === 'flee') {
        const len = Math.sqrt(dU2) || 1;
        let yawT = Math.atan2(dux / len, duz / len); // straight away from the UFO
        if (c.kind === 'chicken') yawT += Math.sin(this._t * 7 + c.phase * 3) * 0.9; // panicked zigzag
        const sp = (c.kind === 'chicken' ? CFG.CHICKEN_FLEE_SPEED :
                    c.kind === 'sheep' ? CFG.SHEEP_FLEE_SPEED : CFG.COW_FLEE_SPEED) * c.speedMult;
        this._step(c, yawT, sp, dt);
        this._animWalk(c, dt, 1.7);
        if (c.kind === 'chicken') this._flapWings(c, 28, 0.55);
        if (c.calm > 0.9) {
          c.state = 'wander';
          this._pickTarget(c);
        }
      } else if (c.state === 'graze') {
        c.st -= dt;
        this._animGraze(c, dt);
        if (c.st <= 0) {
          c.state = 'wander';
          this._pickTarget(c);
        }
      } else { // wander
        const dx = c.tx - px;
        const dz = c.tz - pz;
        c.walkT += dt;
        if (dx * dx + dz * dz < 0.7 || c.walkT > 12) {
          if (Math.random() < 0.45) {
            c.state = 'graze';
            c.st = 1.6 + Math.random() * 2.8;
          } else {
            this._pickTarget(c);
          }
        } else {
          const sp = (c.kind === 'chicken' ? CFG.CHICKEN_SPEED :
                      c.kind === 'sheep' ? CFG.SHEEP_SPEED : CFG.COW_SPEED) * c.speedMult;
          this._step(c, Math.atan2(dx, dz), sp, dt);
          this._animWalk(c, dt, 0.8);
          if (c.kind === 'chicken') this._flapWings(c, 6, 0.12);
        }
      }
      this._groundShadow(c);
    }
  }

  // ============================== spawning ==============================

  _spawnPointIn(area) {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * area.r;
      const x = area.x + Math.cos(a) * r;
      const z = area.z + Math.sin(a) * r;
      if (this.world.isWater(x, z)) continue;
      if (this._insideCollider(x, z)) continue;
      this._pt.x = x;
      this._pt.z = z;
      return this._pt;
    }
    this._pt.x = area.x;
    this._pt.z = area.z;
    return this._pt;
  }

  _add(kind, variant, x, z) {
    const group =
      kind === 'chicken' ? createChicken() :
      kind === 'sheep' ? createSheep() :
      kind === 'pig' ? createPig(variant) :
      kind === 'horse' ? createHorse(variant) :
      kind === 'duck' ? createDuck() : createCow(variant);
    const gy = kind === 'duck' ? WATER_Y : terrainHeight(x, z);
    group.position.set(x, gy, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    const shadow = blobShadow(
      kind === 'chicken' || kind === 'duck' ? 0.4 :
      kind === 'pig' ? 0.8 : kind === 'horse' ? 1.2 : 1.0);
    if (shadow.material) shadow.material = shadow.material.clone();
    if (kind === 'duck') shadow.visible = false;
    group.add(shadow);
    this.scene.add(group);
    const c = {
      kind,                          // 'cow' | 'golden' | 'chicken' | 'sheep' | 'duck'
      variant,                       // cow coat: 'holstein' | 'brown' (else null)
      group,
      groundY: gy,
      jumpCd: 0,
      ud: group.userData || {},
      shadow,
      shadowOp: shadow.material ? shadow.material.opacity : 0.3,
      state: 'wander',
      st: 0,                         // state timer (graze/stun)
      tx: x, tz: z,                  // wander target
      walkT: 0,
      phase: Math.random() * 10,     // personality offset
      walk: Math.random() * 10,      // gait phase
      mooT: 2 + Math.random() * 14,
      vy: 0,
      spin: 0,
      calm: 10,
      speedMult: kind === 'golden' ? CFG.GOLDEN_SPEED_MULT : kind === 'horse' ? CFG.HORSE_SPEED_MULT : 1,
    };
    this._pickTarget(c);
    this.cows.push(c);
    return c;
  }

  // ============================== abduction ==============================

  _startLift(c, up) {
    c.state = 'lift';
    c.spin = 2;
    c.vy = 0;
    // startled noise on grab — each species its own voice
    const d = Math.hypot(c.group.position.x - up.x, c.group.position.z - up.z);
    if (c.kind === 'chicken') {
      this.audio.play('chicken', { volume: 0.6, rate: 1.2, ratejitter: 0.12 });
    } else if (c.kind === 'sheep') {
      this.audio.play('baa', { volume: 0.7, rate: 1.12, ratejitter: 0.1 });
    } else if (c.kind === 'pig') {
      this.audio.play('oink', { volume: 0.7, rate: 1.15, ratejitter: 0.12 });
    } else if (c.kind === 'horse') {
      this.audio.play('horse', { volume: 0.5, rate: 1.1, ratejitter: 0.1 });
    } else if (d < MOO_RANGE) {
      this.audio.play(MOOS[(Math.random() * 3) | 0], { volume: 0.7, rate: 1.18, ratejitter: 0.08 });
    }
  }

  // returns true when consumed
  _lift(c, dt, ufo, beamOn, bp) {
    const g = c.group;
    if (!beamOn) {
      c.state = 'fall';
      c.vy = 0;
      return false;
    }

    const ship = ufo.group.position;
    const hFrac = THREE.MathUtils.clamp(
      (g.position.y - c.groundY) / Math.max(1, ship.y - c.groundY), 0, 1);

    // The beam is a cone: the higher the critter, the narrower the hold.
    // Outrun it (or let it pass the ship) and the critter drops — no free rides.
    // The hold radius scales with the beam upgrade (ufo.beamRadius).
    const dbx = g.position.x - bp.x;
    const dbz = g.position.z - bp.z;
    const dropR = CFG.BEAM_DROP_RADIUS * ((ufo.beamRadius || CFG.BEAM_RADIUS) / CFG.BEAM_RADIUS);
    const allowed = THREE.MathUtils.lerp(dropR, CFG.CONSUME_DIST + 0.6, hFrac);
    if (dbx * dbx + dbz * dbz > allowed * allowed || g.position.y > ship.y + 0.5) {
      c.state = 'fall';
      c.vy = 0;
      return false;
    }

    // pulled to the beam axis while rising
    const pull = Math.min(1, dt * 4);
    g.position.x += (bp.x - g.position.x) * pull;
    g.position.z += (bp.z - g.position.z) * pull;
    g.position.y += (ufo.beamLiftSpeed || CFG.BEAM_LIFT_SPEED) * dt;
    c.spin = 2 + hFrac * 9; // spin faster as they rise
    g.rotation.y += c.spin * dt;
    g.rotation.z = Math.sin(this._t * 5 + c.phase) * 0.12;

    this._flail(c, dt);

    // shrink into the ship over the last ~2 units
    const dx = g.position.x - ship.x;
    const dy = g.position.y + 0.7 - ship.y;
    const dz = g.position.z - ship.z;
    const d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    g.scale.setScalar(THREE.MathUtils.clamp((d3 - 0.5) / 2.0, 0.16, 1));

    return d3 < CFG.CONSUME_DIST;
  }

  _consume(c, i) {
    const g = c.group;
    this.effects.abductPoof(g.position);
    const kind = c.kind;
    this.audio.play(
      kind === 'golden' ? 'golden' : kind === 'chicken' ? 'chicken' : 'abduct',
      { volume: 0.9 }
    );
    const points =
      kind === 'golden' ? CFG.SCORE_GOLDEN :
      kind === 'chicken' ? CFG.SCORE_CHICKEN :
      kind === 'sheep' ? CFG.SCORE_SHEEP :
      kind === 'pig' ? CFG.SCORE_PIG :
      kind === 'horse' ? CFG.SCORE_HORSE : CFG.SCORE_COW;
    const pos = { x: g.position.x, y: g.position.y, z: g.position.z };
    this.scene.remove(g);
    this.cows[i] = this.cows[this.cows.length - 1];
    this.cows.pop();
    if (kind === 'golden') this._goldenT = CFG.GOLDEN_RESPAWN;
    if (this.onAbduct) this.onAbduct({ kind, variant: c.variant, points, pos });
  }

  _fall(c, dt, beamOn, bp, beamR2 = CFG.BEAM_RADIUS * CFG.BEAM_RADIUS) {
    const g = c.group;
    // the beam can re-catch a falling critter
    if (beamOn) {
      const dbx = g.position.x - bp.x;
      const dbz = g.position.z - bp.z;
      if (dbx * dbx + dbz * dbz < beamR2) {
        c.state = 'lift';
        return;
      }
    }
    c.vy -= FALL_GRAVITY * dt;
    g.position.y += c.vy * dt;
    g.rotation.y += c.spin * dt;
    c.spin *= Math.exp(-2 * dt);
    g.scale.setScalar(Math.min(1, g.scale.x + dt * 1.5));
    c.groundY = terrainHeight(g.position.x, g.position.z);
    if (g.position.y <= c.groundY) {
      g.position.y = c.groundY;
      this.effects.dustPuff(g.position);
      g.scale.set(1.12, 0.82, 1.12); // landing squash, eased out during stun
      g.rotation.z = 0;
      c.vy = 0;
      c.state = 'stun';
      c.st = STUN_TIME;
      this._neutralPose(c);
    }
  }

  // ============================== locomotion ==============================

  // Turn toward yaw, advance, steer off water, slide off colliders,
  // respect fences (cows may rarely hop one in a panic), stay in bounds.
  _step(c, targetYaw, speed, dt) {
    const g = c.group;
    const diff = wrapAngle(targetYaw - g.rotation.y);
    g.rotation.y += diff * Math.min(1, dt * (c.kind === 'chicken' ? 10 : 6));
    if (c.jumpCd > 0) c.jumpCd -= dt;

    const fx = Math.sin(g.rotation.y);
    const fz = Math.cos(g.rotation.y);

    // probe ahead for water — never walk in
    if (this.world.isWater(g.position.x + fx * 1.8, g.position.z + fz * 1.8)) {
      g.rotation.y += (c.phase % 2 < 1 ? 1 : -1) * dt * 3.5;
      if (c.state === 'wander') this._pickTarget(c);
      return;
    }

    let nx = g.position.x + fx * speed * dt;
    let nz = g.position.z + fz * speed * dt;

    // fences are solid — except for the rare panicked cow that hops one
    if (this.world.crossesFence &&
        this.world.crossesFence(g.position.x, g.position.z, nx + fx * 0.6, nz + fz * 0.6)) {
      if (c.kind === 'cow' && c.state === 'flee' && c.jumpCd <= 0 &&
          Math.random() < CFG.FENCE_JUMP_CHANCE) {
        this._startJump(c, fx, fz);
        return;
      }
      c.jumpCd = Math.max(c.jumpCd, 0.8);
      g.rotation.y += (c.phase % 2 < 1 ? 1 : -1) * dt * 4; // turn along the fence
      if (c.state === 'wander') this._pickTarget(c);
      return;
    }

    const list = gridAt(this._grid, nx, nz);
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const col = list[k];
        const ddx = nx - col.x;
        const ddz = nz - col.z;
        const rr = col.r + 0.8;
        const dd2 = ddx * ddx + ddz * ddz;
        if (dd2 < rr * rr && dd2 > 1e-6) {
          const dd = Math.sqrt(dd2);
          nx = col.x + (ddx / dd) * rr;
          nz = col.z + (ddz / dd) * rr;
          g.rotation.y += dt * 2.5; // nudge along the obstacle
        }
      }
    }

    const lim = CFG.MAP_HALF - 3;
    g.position.x = THREE.MathUtils.clamp(nx, -lim, lim);
    g.position.z = THREE.MathUtils.clamp(nz, -lim, lim);
    c.groundY = terrainHeight(g.position.x, g.position.z);
    if (c.kind !== 'chicken') g.position.y = c.groundY;   // chickens bounce in _animWalk
  }

  _startJump(c, fx, fz) {
    const g = c.group;
    c.state = 'jump';
    c.st = 0;
    c.jx0 = g.position.x;
    c.jz0 = g.position.z;
    c.jx1 = g.position.x + fx * 4.2;
    c.jz1 = g.position.z + fz * 4.2;
    c.jy0 = c.groundY;
    c.jy1 = terrainHeight(c.jx1, c.jz1);
    c.jumpCd = 3;
    this.audio.play(MOOS[(Math.random() * 3) | 0], { volume: 0.55, rate: 1.3, ratejitter: 0.06 });
  }

  _jump(c, dt) {
    const g = c.group;
    c.st += dt / JUMP_TIME;
    const t = Math.min(1, c.st);
    g.position.x = c.jx0 + (c.jx1 - c.jx0) * t;
    g.position.z = c.jz0 + (c.jz1 - c.jz0) * t;
    g.position.y = c.jy0 + (c.jy1 - c.jy0) * t + Math.sin(t * Math.PI) * 1.7;
    // forelegs tuck, hind legs kick
    const L = c.ud.legs;
    if (L) {
      const k = Math.sin(t * Math.PI);
      if (L[0]) L[0].rotation.x = -0.9 * k;
      if (L[1]) L[1].rotation.x = -0.9 * k;
      if (L[2]) L[2].rotation.x = 0.8 * k;
      if (L[3]) L[3].rotation.x = 0.8 * k;
    }
    if (t >= 1) {
      c.groundY = c.jy1;
      g.position.y = c.jy1;
      this.effects.dustPuff(g.position);
      c.state = 'flee';
      c.calm = 0;
      this._neutralPose(c);
    }
  }

  // Ducks paddle their pond, scatter from the UFO, and never leave the water.
  _duck(c, dt, up, ufoAlive) {
    const g = c.group;
    const pond = c.pond;
    const dux = g.position.x - up.x;
    const duz = g.position.z - up.z;
    const scared = ufoAlive && dux * dux + duz * duz < CFG.FLEE_RADIUS * CFG.FLEE_RADIUS;

    let yawT;
    let sp;
    if (scared) {
      yawT = Math.atan2(dux, duz) + Math.sin(this._t * 6 + c.phase * 2) * 0.5;
      sp = 4.5;
      this._flapWings(c, 26, 0.6);
      c.mooT -= dt * 3;
    } else {
      const dx = c.tx - g.position.x;
      const dz = c.tz - g.position.z;
      if (dx * dx + dz * dz < 0.5) {
        c.tx = pond.x + (Math.random() - 0.5) * 2 * pond.rx;
        c.tz = pond.z + (Math.random() - 0.5) * 2 * pond.rz;
      }
      yawT = Math.atan2(c.tx - g.position.x, c.tz - g.position.z);
      sp = 1.1;
      this._flapWings(c, 3, 0.06);
    }
    if (c.mooT <= 0) {
      c.mooT = 5 + Math.random() * 10;
      const d = Math.hypot(dux, duz);
      if (d < 50) this.audio.play('quack', { volume: 0.45, ratejitter: 0.14 });
    } else {
      c.mooT -= dt;
    }

    const diff = wrapAngle(yawT - g.rotation.y);
    g.rotation.y += diff * Math.min(1, dt * 5);
    let nx = g.position.x + Math.sin(g.rotation.y) * sp * dt;
    let nz = g.position.z + Math.cos(g.rotation.y) * sp * dt;
    // stay inside the pond ellipse
    const ex = (nx - pond.x) / pond.rx;
    const ez = (nz - pond.z) / pond.rz;
    const e = ex * ex + ez * ez;
    if (e > 1) {
      const k = 1 / Math.sqrt(e);
      nx = pond.x + (nx - pond.x) * k;
      nz = pond.z + (nz - pond.z) * k;
      g.rotation.y += dt * 3;
    }
    g.position.x = nx;
    g.position.z = nz;
    // Minecraft-style bob: a pronounced up/down float plus a little pitch rock.
    g.position.y = WATER_Y + Math.sin(this._t * 2.6 + c.phase) * 0.14;
    g.rotation.x = Math.sin(this._t * 2.6 + c.phase + 1) * 0.12;
    if (c.ud.head) c.ud.head.rotation.x = Math.sin(this._t * 1.5 + c.phase) * 0.2 + (scared ? 0.25 : 0);
  }

  _pickTarget(c) {
    const g = c.group;
    const lim = CFG.MAP_HALF - 6;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 10;
      const x = g.position.x + Math.sin(a) * r;
      const z = g.position.z + Math.cos(a) * r;
      if (x < -lim || x > lim || z < -lim || z > lim) continue;
      if (this.world.isWater(x, z)) continue;
      if (this.world.isWater((g.position.x + x) / 2, (g.position.z + z) / 2)) continue;
      if (this._insideCollider(x, z)) continue;
      if (this.world.crossesFence && this.world.crossesFence(g.position.x, g.position.z, x, z)) continue;
      c.tx = x;
      c.tz = z;
      c.walkT = 0;
      return;
    }
    // nowhere nice to go — chill here a moment
    c.tx = g.position.x;
    c.tz = g.position.z;
    c.walkT = 0;
    c.state = 'graze';
    c.st = 1 + Math.random();
  }

  _insideCollider(x, z) {
    const list = gridAt(this._grid, x, z);
    if (!list) return false;
    for (let k = 0; k < list.length; k++) {
      const col = list[k];
      const dx = x - col.x;
      const dz = z - col.z;
      const rr = col.r + 0.9;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  // ============================== animation ==============================

  _animWalk(c, dt, intensity) {
    c.walk += dt * (4.5 + intensity * 6.5);
    const w = c.walk + c.phase;
    const ud = c.ud;
    if (c.kind === 'chicken') {
      if (ud.head) ud.head.rotation.x += (Math.sin(w * 2.2) * 0.25 - ud.head.rotation.x) * Math.min(1, dt * 8);
      c.group.position.y = c.groundY + Math.abs(Math.sin(w * 1.7)) * 0.08; // bouncy strut
      return;
    }
    const amp = 0.3 + intensity * 0.32;
    const L = ud.legs;
    if (L) { // diagonal gait with a little personality drift per leg
      if (L[0]) L[0].rotation.x = Math.sin(w) * amp;
      if (L[1]) L[1].rotation.x = Math.sin(w + Math.PI) * amp * 1.06;
      if (L[2]) L[2].rotation.x = Math.sin(w + Math.PI * 1.12) * amp;
      if (L[3]) L[3].rotation.x = Math.sin(w + 0.14) * amp * 0.94;
    }
    if (ud.head) ud.head.rotation.x += ((-0.05 + Math.sin(w * 2) * 0.07) - ud.head.rotation.x) * Math.min(1, dt * 7);
    if (ud.tail) ud.tail.rotation.y = Math.sin(w * 0.6 + c.phase) * 0.3;
  }

  _animGraze(c, dt) {
    const ud = c.ud;
    const k = Math.min(1, dt * 4);
    if (c.kind === 'chicken') {
      if (ud.head) ud.head.rotation.x += ((0.5 + Math.sin(this._t * 9 + c.phase) * 0.25) - ud.head.rotation.x) * Math.min(1, dt * 10); // peck peck
      c.group.position.y += (c.groundY - c.group.position.y) * k;
      return;
    }
    if (ud.head) ud.head.rotation.x += (0.55 - ud.head.rotation.x) * k; // head down, munching
    const L = c.ud.legs;
    if (L) {
      for (let i = 0; i < 4; i++) {
        if (L[i]) L[i].rotation.x *= Math.exp(-6 * dt);
      }
    }
    if (ud.tail) ud.tail.rotation.y = Math.sin(this._t * 2.2 + c.phase) * 0.4; // happy tail flicks
  }

  _flail(c, dt) {
    const ud = c.ud;
    const w = this._t * 15 + c.phase;
    if (c.kind === 'chicken') {
      this._flapWings(c, 30, 0.7);
      if (ud.head) ud.head.rotation.x = Math.sin(w) * 0.3;
      return;
    }
    const L = ud.legs;
    if (L) {
      for (let i = 0; i < 4; i++) {
        if (L[i]) L[i].rotation.x = Math.sin(w + i * 1.9) * 0.75;
      }
    }
    if (ud.head) ud.head.rotation.x = Math.sin(w * 0.6) * 0.25 - 0.15;
    if (ud.tail) ud.tail.rotation.y = Math.sin(w * 1.4) * 0.6;
  }

  _flapWings(c, rate, amp) {
    const W = c.ud.wings;
    if (!W) return;
    const f = Math.sin(this._t * rate + c.phase) * amp;
    if (W[0]) W[0].rotation.z = 0.25 + f;
    if (W[1]) W[1].rotation.z = -0.25 - f;
  }

  _neutralPose(c) {
    const ud = c.ud;
    const L = ud.legs;
    if (L) {
      for (let i = 0; i < 4; i++) {
        if (L[i]) L[i].rotation.x = 0;
      }
    }
    const W = ud.wings;
    if (W) {
      if (W[0]) W[0].rotation.z = 0;
      if (W[1]) W[1].rotation.z = 0;
    }
  }

  // Keep the blob shadow pinned to the terrain under an airborne critter,
  // fading with height (shadow is a child, so divide out the group scale).
  _groundShadow(c) {
    const g = c.group;
    const s = Math.max(0.001, g.scale.y);
    const height = g.position.y - c.groundY;
    c.shadow.position.y = (c.groundY + 0.04 - g.position.y) / s;
    if (c.shadow.material) {
      c.shadow.material.opacity =
        c.shadowOp * THREE.MathUtils.clamp(1 - height / 13, 0, 1);
    }
  }
}
