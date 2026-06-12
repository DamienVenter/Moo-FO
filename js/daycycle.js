// MOO-FO — js/daycycle.js
// The world's clock: a fixed 12-minute day that runs continuously, through
// menus and gameplay alike. Phase 0 = midnight. Everything that depends on
// the time of day (sky, lighting, fog, stars, fireflies, lit windows)
// samples this object every frame.

import * as THREE from 'three';
import { CFG } from './config.js';

// Keyframes around the cycle. Values lerp smoothly between neighbours.
//   t: phase position. Wraps at 1.
const KEYS = [
  { t: 0.00, name: 'NIGHT',   sky: 0x0b1026, fog: 0x141b3d, hemiSky: 0x3a4a8a, hemiGround: 0x1c2a26, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0, glow: 1.0 },
  { t: 0.20, name: 'NIGHT',   sky: 0x0d1330, fog: 0x16204a, hemiSky: 0x3f5095, hemiGround: 0x1e2c28, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0, glow: 1.0 },
  { t: 0.27, name: 'SUNRISE', sky: 0x4a3a6e, fog: 0x8a5a78, hemiSky: 0x9a6f9e, hemiGround: 0x3a3030, hemiI: 0.9,  sun: 0xffb27a, sunI: 1.0,  stars: 0.35, glow: 0.5 },
  { t: 0.33, name: 'SUNRISE', sky: 0xff9e66, fog: 0xffb98a, hemiSky: 0xffc08a, hemiGround: 0x4a4034, hemiI: 1.0,  sun: 0xffc78a, sunI: 1.25, stars: 0.0, glow: 0.2 },
  { t: 0.40, name: 'DAY',     sky: 0x7ec8f2, fog: 0xb8def2, hemiSky: 0xbfe3ff, hemiGround: 0x5a6a4a, hemiI: 1.1,  sun: 0xfff3d6, sunI: 1.65, stars: 0.0, glow: 0.0 },
  { t: 0.58, name: 'DAY',     sky: 0x84ccf0, fog: 0xbfe2f2, hemiSky: 0xc4e6ff, hemiGround: 0x5c6c4c, hemiI: 1.1,  sun: 0xfff3d6, sunI: 1.6,  stars: 0.0, glow: 0.0 },
  { t: 0.66, name: 'SUNSET',  sky: 0xff8a5c, fog: 0xffad7a, hemiSky: 0xffb380, hemiGround: 0x4c3c34, hemiI: 1.0,  sun: 0xff9e5c, sunI: 1.3,  stars: 0.0, glow: 0.25 },
  { t: 0.72, name: 'SUNSET',  sky: 0x5a3a6a, fog: 0x6e4a72, hemiSky: 0x8a609a, hemiGround: 0x352e30, hemiI: 0.9,  sun: 0xff8a6e, sunI: 1.0,  stars: 0.4, glow: 0.6 },
  { t: 0.80, name: 'NIGHT',   sky: 0x0b1026, fog: 0x141b3d, hemiSky: 0x3a4a8a, hemiGround: 0x1c2a26, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0, glow: 1.0 },
  { t: 1.00, name: 'NIGHT',   sky: 0x0b1026, fog: 0x141b3d, hemiSky: 0x3a4a8a, hemiGround: 0x1c2a26, hemiI: 0.85, sun: 0xb9c7ff, sunI: 1.05, stars: 1.0, glow: 1.0 },
];

const ICONS = { NIGHT: '🌙', SUNRISE: '🌅', DAY: '☀️', SUNSET: '🌇' };

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
    this._a = new THREE.Color();
    this._b = new THREE.Color();
    this.update(0);
  }

  get icon() { return ICONS[this.name]; }
  get isNightish() { return this.nightGlow > 0.45; }

  update(dt) {
    this.phase = (this.phase + dt / CFG.DAY_CYCLE_SECONDS) % 1;
    const p = this.phase;

    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1].t < p) i++;
    const k0 = KEYS[i];
    const k1 = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const span = Math.max(k1.t - k0.t, 1e-6);
    const t = Math.min(1, Math.max(0, (p - k0.t) / span));
    const e = t * t * (3 - 2 * t);

    const lerpC = (target, a, b) => {
      this._a.setHex(a); this._b.setHex(b);
      target.copy(this._a).lerp(this._b, e);
    };
    lerpC(this.sky, k0.sky, k1.sky);
    lerpC(this.fog, k0.fog, k1.fog);
    lerpC(this.hemiSky, k0.hemiSky, k1.hemiSky);
    lerpC(this.hemiGround, k0.hemiGround, k1.hemiGround);
    lerpC(this.sunColor, k0.sun, k1.sun);
    this.hemiIntensity = k0.hemiI + (k1.hemiI - k0.hemiI) * e;
    this.sunIntensity = k0.sunI + (k1.sunI - k0.sunI) * e;
    this.starOpacity = k0.stars + (k1.stars - k0.stars) * e;
    this.nightGlow = k0.glow + (k1.glow - k0.glow) * e;

    // name: pick the nearer keyframe's label
    this.name = (t < 0.5 ? k0 : k1).name;

    // Sun travels an arc: rises in the east (+x) at phase .27, sets west at .73.
    const sunA = (p - 0.25) * Math.PI * 2 * 0.5 / 0.5;   // angle over the day half
    const dayT = (p - 0.27) / (0.73 - 0.27);             // 0..1 across daylight
    const az = Math.PI * (1 - dayT);                     // east → west
    const el = Math.sin(Math.PI * Math.min(1, Math.max(0, dayT))) * 1.1 + 0.08;
    this.sunDir.set(Math.cos(az), Math.sin(el), -0.35).normalize();

    // Moon mirrors the sun's schedule at night.
    const nightT = p > 0.73 ? (p - 0.73) / 0.54 : (p + 0.27) / 0.54;
    const mAz = Math.PI * (1 - Math.min(1, Math.max(0, nightT)));
    const mEl = Math.sin(Math.PI * Math.min(1, Math.max(0, nightT))) * 1.0 + 0.15;
    this.moonDir.set(Math.cos(mAz), Math.sin(mEl), -0.4).normalize();
  }
}
