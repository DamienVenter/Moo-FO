// MOO-FO — js/sky.js
// Day-cycle-driven sky. A gradient sky DOME (horizon→zenith, shifting with the
// phase) wraps the world; sun AND moon ride continuous arcs with soft coronas;
// layered stars twinkle and fade with night; soft puffy clouds drift in
// parallax tiers, tinted by the sun. Owns scene lighting and fog; every frame
// it samples the DayCycle passed to update().
//
// Performance: every geometry, material and texture is created once in the
// constructor and only cheap per-frame mutations happen in update() — no
// allocations in the hot path beyond reused scratch objects.

import * as THREE from 'three';
import { COLORS, ENABLE_SHADOWS } from './config.js';

const SKY_R = 620;       // radius the sun/moon orbit at
const DOME_R = 720;      // gradient dome radius (just inside the fog far plane)

// ---- shared scratch (no per-frame allocation) ------------------------------
const _v = new THREE.Vector3();

// A soft radial glow sprite texture (cached per tint).
function glowTexture(r, g, b, coreAlpha = 0.9) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${coreAlpha})`);
  grad.addColorStop(0.28, `rgba(${r}, ${g}, ${b}, ${coreAlpha * 0.32})`);
  grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${coreAlpha * 0.08})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A soft round puff texture for clouds — fluffy alpha falloff, white so it can
// be tinted by material colour.
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A round star sprite (soft core) so stars read as little glints, not squares.
function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One starfield layer: points on the upper hemisphere with per-point random
// twinkle phase/speed/size baked into attributes; the shader does the twinkle
// so the CPU only updates two uniforms per frame.
function starLayer(count, baseSize, color, twinkleAmt) {
  const pos = new Float32Array(count * 3);
  const aPhase = new Float32Array(count);
  const aSpeed = new Float32Array(count);
  const aSize = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const elev = Math.acos(Math.random() * 0.96);     // bias toward the dome top
    const r = 600 + Math.random() * 60;
    pos[i * 3] = Math.cos(a) * Math.sin(elev) * r;
    pos[i * 3 + 1] = Math.abs(Math.cos(elev)) * r * 0.85 + 30;
    pos[i * 3 + 2] = Math.sin(a) * Math.sin(elev) * r;
    aPhase[i] = Math.random() * Math.PI * 2;
    aSpeed[i] = 0.6 + Math.random() * 2.2;
    // a few rare bright ones per layer
    aSize[i] = baseSize * (0.7 + Math.random() * 0.7) * (Math.random() < 0.06 ? 2.3 : 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uTwinkle: { value: twinkleAmt },
      uTex: { value: starTexture() },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uTwinkle;
      varying float vTw;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // twinkle: a smooth 0..1 wobble unique per star
        float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
        vTw = mix(1.0 - uTwinkle, 1.0, tw);
        gl_PointSize = aSize * vTw;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTw;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(uColor, t.a * uOpacity * vTw);
      }
    `,
  });
  return new THREE.Points(geo, mat);
}

export class Sky {
  constructor(scene) {
    this.scene = scene;

    scene.background = new THREE.Color(COLORS.night);
    scene.fog = new THREE.Fog(COLORS.fog, 90, 720);  // far enough to see the giant mountain loom

    // ----------------------------------------------------- gradient sky dome
    // A big inward-facing sphere with a vertical gradient driven by three
    // colours from the cycle: a warm/cool HORIZON band, the fog colour right
    // at the skyline (so fog and sky meet seamlessly), and a deep ZENITH up
    // top. The shader blends them by view-direction height — smooth, cheap,
    // and re-tinted each frame via uniforms (no geometry churn).
    this._domeUniforms = {
      uZenith: { value: new THREE.Color(0x0b1026) },
      uHorizon: { value: new THREE.Color(0x141b3d) },
      uGlow: { value: new THREE.Color(0xffb98a) },   // warm sunrise/sunset band
      uGlowAmt: { value: 0.0 },                       // how present the warm band is
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // for a soft directional flush
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_R, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this._domeUniforms,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          uniform vec3 uGlow;
          uniform float uGlowAmt;
          uniform vec3 uSunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);                 // 0 horizon → 1 zenith
            // vertical gradient: horizon → zenith, eased for a soft band
            float g = pow(h, 0.42);
            vec3 col = mix(uHorizon, uZenith, g);
            // warm flush near the horizon, strongest toward the sun azimuth
            float band = pow(1.0 - h, 3.0);                 // hugs the skyline
            float toward = clamp(dot(normalize(vec3(d.x, 0.0, d.z)),
                                     normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
            float flush = band * uGlowAmt * (0.45 + 0.55 * toward);
            col = mix(col, uGlow, clamp(flush, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;     // draw first, behind everything
    scene.add(this.dome);
    // reusable scratch colours for dome tinting
    this._zenC = new THREE.Color();
    this._horC = new THREE.Color();
    this._glowWarm = new THREE.Color(0xffb98a);
    this._glowDay = new THREE.Color(0x9fd6f0);

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
    // Three layers: dense faint, medium, and a sparse bright layer — each with
    // its own twinkle character, for depth and a livelier night sky.
    this.starLayers = [
      starLayer(1600, 9, 0xffffff, 0.55),
      starLayer(700, 13, 0xcfe0ff, 0.7),
      starLayer(180, 22, 0xfff1c8, 0.85),   // sparse warm bright stars
    ];
    for (const s of this.starLayers) { s.frustumCulled = false; scene.add(s); }

    // ----------------------------------------------------------------- moon
    this.moon = new THREE.Group();
    const moonBall = new THREE.Mesh(
      new THREE.IcosahedronGeometry(26, 2),
      new THREE.MeshBasicMaterial({ color: COLORS.moon, fog: false, transparent: true })
    );
    this.moon.add(moonBall);
    // craters, on the face that points roughly toward the camera origin
    this._moonCraterMat = new THREE.MeshBasicMaterial({ color: 0xddcfa4, fog: false, transparent: true });
    const craters = [
      [8, 6, 22, 6], [-12, -4, 21, 4.5], [2, -12, 20, 3.5],
      [-6, 12, 20, 3], [16, -8, 17, 2.6], [-2, 0, 25, 5.2],
    ];
    for (const [ox, oy, oz, s] of craters) {
      const crater = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), this._moonCraterMat);
      crater.position.set(ox, oy, oz);
      crater.scale.z = 0.4;   // shallow dents
      this.moon.add(crater);
    }
    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(214, 226, 255, 0.85), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.moonGlow.scale.setScalar(200);
    this.moon.add(this.moonGlow);
    this._moonMats = [moonBall.material, this._moonCraterMat];
    scene.add(this.moon);

    // ------------------------------------------------------------------ sun
    this.sun = new THREE.Group();
    const sunBall = new THREE.Mesh(
      new THREE.IcosahedronGeometry(30, 2),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false, transparent: true })
    );
    this.sun.add(sunBall);
    // two stacked coronas: a tight bright core glow and a big soft halo
    this.sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(255, 230, 170, 0.95), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunCore.scale.setScalar(150);
    this.sun.add(this.sunCore);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(255, 200, 120, 0.8), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunGlow.scale.setScalar(340);
    this.sun.add(this.sunGlow);
    this._sunMat = sunBall.material;
    // cached tints for the warm-at-low-angle blend
    this._sunHigh = new THREE.Color(0xffe9a8);
    this._sunLow = new THREE.Color(0xff7a3c);
    this._sunGlowHigh = new THREE.Color(0xffc878);
    this._sunGlowLow = new THREE.Color(0xff6a2a);
    this._sunTmp = new THREE.Color();
    scene.add(this.sun);

    // ---------------------------------------------------------------- clouds
    // Soft sprite-puff clouds in three parallax tiers (low/mid/high), each tier
    // drifting at its own speed. Shared puff texture + per-tier material so the
    // whole sky re-tints with one colour write per tier.
    this._puffTex = puffTexture();
    this._cloudNight = new THREE.Color(0x222b4a);
    this._cloudDay = new THREE.Color(0xf7faff);
    this._cloudDusk = new THREE.Color(0xffcaa0);    // golden hour tint
    this._cloudTmp = new THREE.Color();
    this.cloudTiers = [];
    const tierDefs = [
      { y: 120, count: 5, speed: 1.6, scale: 1.0, opacity: 0.9 },
      { y: 165, count: 4, speed: 2.6, scale: 1.35, opacity: 0.8 },
      { y: 210, count: 3, speed: 3.8, scale: 1.8, opacity: 0.62 },
    ];
    for (const def of tierDefs) {
      const mat = new THREE.SpriteMaterial({
        map: this._puffTex, transparent: true, depthWrite: false, fog: false,
        color: 0xf7faff, opacity: def.opacity,
      });
      const clouds = [];
      for (let i = 0; i < def.count; i++) {
        const cloud = new THREE.Group();
        const puffs = 4 + ((Math.random() * 4) | 0);
        for (let p = 0; p < puffs; p++) {
          const sp = new THREE.Sprite(mat);
          const w = (26 + Math.random() * 26) * def.scale;
          sp.scale.set(w, w * (0.55 + Math.random() * 0.2), 1);
          sp.position.set(
            (p - puffs / 2) * 18 * def.scale + (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10 * def.scale,
            (Math.random() - 0.5) * 14 * def.scale
          );
          cloud.add(sp);
        }
        const ang = Math.random() * Math.PI * 2;
        const rad = 180 + Math.random() * 260;
        cloud.position.set(Math.cos(ang) * rad, def.y + (Math.random() - 0.5) * 24, Math.sin(ang) * rad - 60);
        cloud.renderOrder = -5;
        scene.add(cloud);
        clouds.push(cloud);
      }
      this.cloudTiers.push({ mat, clouds, speed: def.speed });
    }

    // ----------------------------------------------------------- shooting star
    this.shoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.shoot.frustumCulled = false;
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

      // ---- gradient dome: zenith = sky colour, horizon meets the fog -------
      // Deepen the zenith a touch above the flat sky colour for a richer top,
      // and seat the horizon on the fog colour so the skyline blends into haze.
      this._zenC.copy(cycle.sky).multiplyScalar(0.82);
      this._horC.copy(cycle.fog);
      this._domeUniforms.uZenith.value.copy(this._zenC);
      this._domeUniforms.uHorizon.value.copy(this._horC);
      // The warm band is strongest at sunrise/sunset (twilight), absent at deep
      // day/night. cycle.nightGlow is ~0 by day, ~1 at night; twilight is the
      // in-between, so a smooth hump on nightGlow gives the golden-hour amount.
      const ng = cycle.nightGlow;
      const twilight = 1 - Math.abs(ng - 0.5) * 2;          // 0 at day/night, 1 at dusk/dawn
      const twi = twilight * twilight * (3 - 2 * twilight); // smoothstep hump
      this._domeUniforms.uGlowAmt.value = twi * 0.85;
      // warm glow colour follows the sun colour for cohesion
      this._domeUniforms.uGlow.value.copy(cycle.sunColor);
      // feed the sun azimuth so the flush points the right way
      this._domeUniforms.uSunDir.value.copy(cycle.sunDir);

      this.hemi.color.copy(cycle.hemiSky);
      this.hemi.groundColor.copy(cycle.hemiGround);
      this.hemi.intensity = cycle.hemiIntensity;

      // The single shadow light tracks whichever body rules the sky.
      const night = cycle.nightGlow > 0.5;
      const d = night ? cycle.moonDir : cycle.sunDir;
      this.dir.position.set(d.x * 320, Math.max(d.y, 0.06) * 320, d.z * 320);
      this.dir.color.copy(cycle.sunColor);
      this.dir.intensity = cycle.sunIntensity;

      // ---- moon -----------------------------------------------------------
      this.moon.position.set(
        cycle.moonDir.x * SKY_R,
        Math.max(cycle.moonDir.y, -0.2) * SKY_R * 0.8 + 40,
        cycle.moonDir.z * SKY_R
      );
      const moonVis = clamp01(cycle.nightGlow * 1.4 - 0.1);
      for (const m of this._moonMats) m.opacity = moonVis;
      this.moonGlow.material.opacity = moonVis * 0.85;

      // ---- sun ------------------------------------------------------------
      this.sun.position.set(
        cycle.sunDir.x * SKY_R,
        Math.max(cycle.sunDir.y, -0.25) * SKY_R * 0.8 + 30,
        cycle.sunDir.z * SKY_R
      );
      const sunVis = clamp01((1 - cycle.nightGlow) * 1.5 - 0.15);
      this._sunMat.opacity = sunVis;
      this.sunCore.material.opacity = sunVis;
      this.sunGlow.material.opacity = sunVis * 0.9;
      // warm tint + fatter halo when the sun is low (near the horizon)
      const elev = clamp01(cycle.sunDir.y);                 // 0 horizon → 1 high
      const low = 1 - elev;                                 // 1 at horizon
      const lowE = low * low;                               // bias toward the horizon
      this._sunTmp.copy(this._sunHigh).lerp(this._sunLow, lowE);
      this._sunMat.color.copy(this._sunTmp);
      this._sunTmp.copy(this._sunGlowHigh).lerp(this._sunGlowLow, lowE);
      this.sunGlow.material.color.copy(this._sunTmp);
      this.sunGlow.scale.setScalar(340 + lowE * 200);       // corona swells at sunset

      // ---- stars: drive shader uniforms (twinkle done on GPU) -------------
      for (const s of this.starLayers) {
        s.material.uniforms.uTime.value = elapsed;
        s.material.uniforms.uOpacity.value = cycle.starOpacity;
      }

      // ---- clouds: tint between night blue, golden dusk, and day white ----
      // day (ng~0) → white; twilight → golden; night (ng~1) → dark blue.
      // Blend white→dusk by the twilight hump, then dusk/white→night by ng.
      const dayMix = 1 - ng;                                // 1 by day
      this._cloudTmp.copy(this._cloudNight)
        .lerp(this._cloudDay, dayMix);                      // night↔day base
      // overlay golden warmth at twilight
      this._cloudTmp.lerp(this._cloudDusk, twi * 0.6);
      for (const tier of this.cloudTiers) tier.mat.color.copy(this._cloudTmp);
    }

    // ---- cloud drift (parallax tiers) -------------------------------------
    for (const tier of this.cloudTiers) {
      for (const cloud of tier.clouds) {
        cloud.position.x += tier.speed * dt;
        if (cloud.position.x > 520) cloud.position.x -= 1040;
      }
    }

    // ---- shooting stars only when stars are out ---------------------------
    const starsOut = !cycle || cycle.starOpacity > 0.5;
    this._shootT += dt;
    if (this._shootT < 0) return;
    if (!starsOut) { this.shoot.material.opacity = 0; this._shootT = -2; return; }
    if (this._shootT <= 1) {
      if (this._shootT - dt < 0) {
        const a = Math.random() * Math.PI * 2;
        this._shootFrom.set(Math.cos(a) * 420, 280 + Math.random() * 120, Math.sin(a) * 420);
        this._shootDir.set(-Math.cos(a) * 300 + (Math.random() - 0.5) * 200, -60, -Math.sin(a) * 300 + (Math.random() - 0.5) * 200);
        _v.copy(this._shootDir).add(this._shootFrom);
        this.shoot.lookAt(_v);
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

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
