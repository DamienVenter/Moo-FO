// MOO-FO — js/daycycle.js
// The world's clock: a fixed 12-minute day that runs continuously, through
// menus and gameplay alike. Phase 0 = midnight. Everything that depends on
// the time of day (sky, lighting, fog, stars, fireflies, lit windows)
// samples this object every frame.
//
// Smoothness contract (why the cycle is glitch-free):
//   * Every interpolated scalar/colour crosses keyframe seams continuously.
//     We use a Catmull–Rom-style monotone-safe Hermite blend per segment so
//     the VALUE and its slope are continuous at every seam — no stalling to
//     zero-velocity at each keyframe (the old smoothstep "pumped"), and no
//     hard linear corners either.
//   * The keyframe table is cyclic: t=0 and t=1 hold identical values, and the
//     segment search + neighbour lookup wrap around, so phase 1.0→0.0 is seam-
//     less for every field.
//   * Sun and moon ride ONE continuous great-circle arc each, parameterised
//     directly by phase with NO clamps. They dip smoothly below the horizon at
//     night/day respectively instead of being clamped flat (which used to snap
//     at rise/set and jump at the midnight wrap).

import * as THREE from 'three';
import { CFG } from './config.js';

// Keyframes around the cycle. Values blend smoothly between neighbours.
//   t: phase position. The table is treated as cyclic (t=0 ≡ t=1).
const KEYS = [
  { t: 0.00, name: 'NIGHT',   sky: 0x0b1026, fog: 0x141b3d, hemiSky: 0x3a4a8a, hemiGround: 0x1c2a26, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0,  glow: 1.0  },
  { t: 0.20, name: 'NIGHT',   sky: 0x0d1330, fog: 0x16204a, hemiSky: 0x3f5095, hemiGround: 0x1e2c28, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0,  glow: 1.0  },
  { t: 0.27, name: 'SUNRISE', sky: 0x4a3a6e, fog: 0x8a5a78, hemiSky: 0x9a6f9e, hemiGround: 0x3a3030, hemiI: 0.9,  sun: 0xffb27a, sunI: 1.0,  stars: 0.35, glow: 0.5  },
  { t: 0.33, name: 'SUNRISE', sky: 0xff9e66, fog: 0xffb98a, hemiSky: 0xffc08a, hemiGround: 0x4a4034, hemiI: 1.0,  sun: 0xffc78a, sunI: 1.25, stars: 0.0,  glow: 0.2  },
  { t: 0.40, name: 'DAY',     sky: 0x7ec8f2, fog: 0xb8def2, hemiSky: 0xbfe3ff, hemiGround: 0x5a6a4a, hemiI: 1.1,  sun: 0xfff3d6, sunI: 1.65, stars: 0.0,  glow: 0.0  },
  { t: 0.58, name: 'DAY',     sky: 0x84ccf0, fog: 0xbfe2f2, hemiSky: 0xc4e6ff, hemiGround: 0x5c6c4c, hemiI: 1.1,  sun: 0xfff3d6, sunI: 1.6,  stars: 0.0,  glow: 0.0  },
  { t: 0.66, name: 'SUNSET',  sky: 0xff8a5c, fog: 0xffad7a, hemiSky: 0xffb380, hemiGround: 0x4c3c34, hemiI: 1.0,  sun: 0xff9e5c, sunI: 1.3,  stars: 0.0,  glow: 0.25 },
  { t: 0.72, name: 'SUNSET',  sky: 0x5a3a6a, fog: 0x6e4a72, hemiSky: 0x8a609a, hemiGround: 0x352e30, hemiI: 0.9,  sun: 0xff8a6e, sunI: 1.0,  stars: 0.4,  glow: 0.6  },
  { t: 0.80, name: 'NIGHT',   sky: 0x0b1026, fog: 0x141b3d, hemiSky: 0x3a4a8a, hemiGround: 0x1c2a26, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0,  glow: 1.0  },
  { t: 1.00, name: 'NIGHT',   sky: 0x0b1026, fog: 0x141b3d, hemiSky: 0x3a4a8a, hemiGround: 0x1c2a26, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0,  glow: 1.0  },
];

const ICONS = { NIGHT: '🌙', SUNRISE: '🌅', DAY: '☀️', SUNSET: '🌇' };

// Phase at which the sun crosses the horizon. The sun arc is built so that
// these are exactly its rise/set, and the moon arc is the same arc shifted by
// half a cycle — guaranteeing one continuous body is always overhead.
const SUN_RISE = 0.27;
const SUN_SET = 0.73;

export class DayCycle {
  constructor() {
    this.phase = CFG.DAY_START_PHASE;
    // live sampled values
    this.sky = new THREE.Color();
    this.fog = new THREE.Color();
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.hemiIntensity = 1;
    this.sunIntensity = 1;
    this.starOpacity = 1;
    this.nightGlow = 1;          // 0..1 — drives lanterns, windows, fireflies
    this.sunDir = new THREE.Vector3();   // direction the sun light points FROM
    this.moonDir = new THREE.Vector3();
    this.name = 'NIGHT';
    // scratch colours (no per-frame allocation)
    this._c0 = new THREE.Color();
    this._c1 = new THREE.Color();
    this._cm1 = new THREE.Color();
    this._c2 = new THREE.Color();
    this.update(0);
  }

  get icon() { return ICONS[this.name]; }
  get isNightish() { return this.nightGlow > 0.45; }

  // Cyclic keyframe access: wraps the index so segment math is seamless across
  // the 1.0→0.0 boundary. The duplicate t=0/t=1 endpoints mean wrapping the
  // index lands on identical values, so there is never a value jump at wrap.
  _key(i) {
    const n = KEYS.length;
    // KEYS[0] and KEYS[n-1] are identical; treat indices cyclically over the
    // n-1 distinct knots so i=-1 maps to the knot just before t=0.
    const m = n - 1;
    return KEYS[((i % m) + m) % m];
  }

  update(dt) {
    this.phase = (this.phase + dt / CFG.DAY_CYCLE_SECONDS) % 1;
    if (this.phase < 0) this.phase += 1;
    const p = this.phase;

    // ---- locate the segment [k0,k1] that contains p (k1.t may be 1.0) ------
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1].t <= p) i++;
    const k0 = KEYS[i];
    const k1 = KEYS[i + 1] || KEYS[KEYS.length - 1];
    const span = Math.max(k1.t - k0.t, 1e-6);
    let t = (p - k0.t) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;

    // Neighbour knots (cyclic) for a Catmull–Rom tangent. km1 precedes k0, k2
    // follows k1. Because endpoints are duplicated and we wrap the index, this
    // is continuous across every seam INCLUDING the 1.0→0.0 wrap.
    const km1 = this._key(i - 1);
    const k2 = this._key(i + 2);

    // Hermite basis (C1-continuous; tangents from Catmull–Rom on the *eased*
    // parameter). h gives a smooth, non-stalling blend with matching slopes at
    // seams, so neither colour nor scalar ever steps.
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    // Catmull–Rom scalar through (vm1,v0,v1,v2) at local t, tangent scale 0.5.
    const crm = (vm1, v0, v1, v2) => {
      const m0 = 0.5 * (v1 - vm1);
      const m1 = 0.5 * (v2 - v0);
      return h00 * v0 + h10 * m0 + h01 * v1 + h11 * m1;
    };

    // Colour blend along the same Catmull–Rom, per channel, then clamp to
    // [0,1] (Catmull–Rom can overshoot slightly — clamp keeps colours valid
    // without introducing a corner anywhere inside the visible range).
    const c0 = this._c0, c1 = this._c1, cm1 = this._cm1, c2 = this._c2;
    const lerpC = (target, am1, a0, a1, a2) => {
      cm1.setHex(am1); c0.setHex(a0); c1.setHex(a1); c2.setHex(a2);
      target.r = clamp01(crm(cm1.r, c0.r, c1.r, c2.r));
      target.g = clamp01(crm(cm1.g, c0.g, c1.g, c2.g));
      target.b = clamp01(crm(cm1.b, c0.b, c1.b, c2.b));
    };

    lerpC(this.sky, km1.sky, k0.sky, k1.sky, k2.sky);
    lerpC(this.fog, km1.fog, k0.fog, k1.fog, k2.fog);
    lerpC(this.hemiSky, km1.hemiSky, k0.hemiSky, k1.hemiSky, k2.hemiSky);
    lerpC(this.hemiGround, km1.hemiGround, k0.hemiGround, k1.hemiGround, k2.hemiGround);
    lerpC(this.sunColor, km1.sun, k0.sun, k1.sun, k2.sun);

    this.hemiIntensity = crm(km1.hemiI, k0.hemiI, k1.hemiI, k2.hemiI);
    this.sunIntensity = crm(km1.sunI, k0.sunI, k1.sunI, k2.sunI);
    this.starOpacity = clamp01(crm(km1.stars, k0.stars, k1.stars, k2.stars));
    this.nightGlow = clamp01(crm(km1.glow, k0.glow, k1.glow, k2.glow));

    // name: pick the nearer keyframe's label (presentational only; the visuals
    // above are already continuous so a label flip causes no visible step).
    this.name = (t < 0.5 ? k0 : k1).name;

    // ---- celestial arcs: ONE continuous great circle each, no clamps -------
    // Each body rides a single great circle whose angle is STRICTLY 2π-periodic
    // in phase — angle = 2π·(p − SUN_RISE). With no clamping anywhere this is
    // smooth and periodic, so:
    //   * elevation = sin(angle) passes smoothly through 0 at the horizon (no
    //     snap at rise/set),
    //   * the p = 1→0 wrap is seamless (angle advances exactly 2π per cycle, so
    //     sin/cos return to the same value — no jump at midnight).
    // The sun rises (el crosses 0 upward) exactly at SUN_RISE and peaks a
    // quarter-cycle later; the keyframe colours are tuned to ride along.
    const sunAng = (p - SUN_RISE) * Math.PI * 2;   // 2π-periodic ⇒ seamless wrap
    setArc(this.sunDir, sunAng);

    // Moon is exactly half a cycle out of phase with the sun: when the sun is
    // below the horizon the moon rides above it. Same arc math, +π of angle →
    // identical smoothness and a seamless wrap.
    setArc(this.moonDir, sunAng + Math.PI);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Place a unit direction on a smooth day-arc for the given angle.
//   angle 0   → on the +X (east) horizon, rising (el = 0, climbing)
//   angle π/2 → high overhead (el = 1, solar noon)
//   angle π   → on the -X (west) horizon, setting (el = 0, descending)
//   angle 3π/2→ solar midnight (el = -1, well below the horizon)
// elevation = sin(angle): continuous & periodic, smoothly negative at night.
// We tilt the whole arc slightly toward -Z so the body crosses the southern
// sky rather than straight overhead, matching the original framing.
function setArc(out, angle) {
  const el = Math.sin(angle);                 // -1..1, smooth, periodic
  const horiz = Math.cos(angle);              // east(+)→west(-)
  // Lift the peak a touch above a pure hemisphere so noon sits high, and let
  // the arc pass through the south (-Z). horiz drives the E/W swing; a fixed
  // southward bias gives the arc its tilt. Normalise → unit direction.
  out.set(
    horiz,                       // x: east at rise, west at set
    el * 1.05 + 0.04,            // y: smooth rise/fall through the horizon
    -0.38 - 0.10 * (1 - Math.abs(el)) // z: leans south, a hair more near horizon
  ).normalize();
}
