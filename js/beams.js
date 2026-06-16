// MOO-FO — beam visual factory. Builds a tractor-beam THREE.Group for a given
// beam cosmetic def, in one of 12 distinct STYLES (not just colours). Used by
// the shop / upgrade 3D previews so every beam reads as its own form.
//
//   const b = buildBeam(def, { radiusTop, radiusBot, height });
//   scene.add(b.group);  b.update(tSeconds);  ... b.dispose();
//
// The beam hangs DOWN from y=0 (touching the craft underside) to y=-height.

import * as THREE from 'three';

const ADD = THREE.AdditiveBlending;

export const BEAM_STYLES = [
  'solid', 'rings', 'spiral', 'dashed', 'double',
  'twist', 'sparkle', 'pillars', 'plasma', 'halo', 'lattice', 'comet',
];

export function buildBeam(def = {}, dims = {}) {
  const rTop = dims.radiusTop != null ? dims.radiusTop : 0.5;
  const rBot = dims.radiusBot != null ? dims.radiusBot : 3.0;
  const h    = dims.height    != null ? dims.height    : 6.0;
  const style = def.style || 'solid';
  const color = def.color != null ? def.color : 0x9af7b0;
  const color2 = def.color2 != null ? def.color2 : color;

  const group = new THREE.Group();
  const primaryMats = [];     // tinted by `color` (and cycled for rainbow)
  const secondaryMats = [];   // tinted by `color2`
  const anims = [];

  const mat = (col, opacity, prim = true) => {
    const m = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity, blending: ADD,
      depthWrite: false, side: THREE.DoubleSide,
    });
    (prim ? primaryMats : secondaryMats).push(m);
    return m;
  };
  const pointsMat = (col, opacity, size, prim = true) => {
    const m = new THREE.PointsMaterial({
      color: col, transparent: true, opacity, size, sizeAttenuation: true,
      blending: ADD, depthWrite: false, map: dotTexture(),
    });
    (prim ? primaryMats : secondaryMats).push(m);
    return m;
  };

  // radius of the cone at depth u (0 top → 1 bottom).
  const rAt = (u) => rTop + (rBot - rTop) * u;

  const cone = (rt, rb, opacity, col, prim = true) => {
    const geo = new THREE.CylinderGeometry(rt, rb, h, 26, 1, true);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat(col, opacity, prim));
    group.add(m);
    return m;
  };
  const innerCore = () => {
    // bright white-ish central column shared by many styles.
    const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6);
    const geo = new THREE.CylinderGeometry(rTop * 0.5, rBot * 0.42, h, 16, 1, true);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat(c.getHex(), 0.34));
    group.add(m);
    return m;
  };

  switch (style) {
    case 'rings': {
      cone(rTop * 0.8, rBot * 0.9, 0.10, color);
      const N = 7, rings = [];
      for (let i = 0; i < N; i++) {
        const u = i / N;
        const t = new THREE.Mesh(new THREE.TorusGeometry(rAt(u), 0.12 + 0.05 * u, 8, 22),
          mat(i % 2 ? color2 : color, 0.85, i % 2 === 0));
        t.rotation.x = Math.PI / 2; t.position.y = -u * h;
        group.add(t); rings.push(t);
      }
      anims.push((tt) => {
        for (let i = 0; i < rings.length; i++) {
          let u = (i / N + (tt * 0.25) % 1) % 1;
          rings[i].position.y = -u * h;
          const r = rAt(u); rings[i].scale.set(r / rAt(i / N), 1, r / rAt(i / N));
        }
      });
      break;
    }
    case 'spiral': {
      cone(rTop * 0.7, rBot * 0.8, 0.08, color);
      helixStrand(group, mat(color, 0.95), { rTop, rBot, h, turns: 3.0, phase: 0, count: 26, rAt });
      if (def.color2 != null) helixStrand(group, mat(color2, 0.95, false), { rTop, rBot, h, turns: 3.0, phase: Math.PI, count: 26, rAt });
      anims.push((tt) => { group.rotation.y = tt * 1.4; });
      break;
    }
    case 'dashed': {
      const segs = 6, bands = [];
      for (let i = 0; i < segs; i++) {
        const u0 = i / segs, u1 = u0 + 0.6 / segs;
        const g2 = new THREE.CylinderGeometry(rAt(u1), rAt(u0), (u1 - u0) * h, 24, 1, true);
        g2.translate(0, -((u0 + u1) / 2) * h, 0);
        const b = new THREE.Mesh(g2, mat(i % 2 ? color2 : color, 0.55, i % 2 === 0));
        group.add(b); bands.push(b);
      }
      // flow the dashes downward via a travelling brightness wave (the bands
      // stay attached to the craft — no drifting the whole beam away).
      anims.push((tt) => {
        for (let i = 0; i < bands.length; i++) {
          const w = 0.5 + 0.5 * Math.sin(tt * 3.2 - i * 1.1);
          bands[i].material.opacity = 0.3 + 0.5 * w;
        }
      });
      innerCore();
      break;
    }
    case 'double': {
      cone(rTop, rBot, 0.18, color);
      const inner = cone(rTop * 0.62, rBot * 0.6, 0.30, color2, false);
      inner.scale.set(1, 1, 1);
      innerCore();
      break;
    }
    case 'twist': {
      cone(rTop * 0.7, rBot * 0.85, 0.12, color);
      const fins = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const finMat = mat(i % 2 ? color2 : color, 0.6, i % 2 === 0);
        const strip = [];
        for (let k = 0; k <= 10; k++) {
          const u = k / 10;
          const cube = new THREE.Mesh(new THREE.BoxGeometry(0.16, h / 10, 0.16), finMat);
          const r = rAt(u) * 0.92, ang = a + u * Math.PI * 1.6;
          cube.position.set(Math.cos(ang) * r, -u * h, Math.sin(ang) * r);
          fins.add(cube);
        }
      }
      group.add(fins);
      anims.push((tt) => { fins.rotation.y = tt * 1.8; });
      break;
    }
    case 'sparkle': {
      cone(rTop, rBot, 0.18, color);
      innerCore();
      const P = 70, pos = new Float32Array(P * 3), seed = new Float32Array(P);
      for (let i = 0; i < P; i++) { seed[i] = Math.random(); reseat(pos, i, Math.random(), rAt, h); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, pointsMat(0xffffff, 0.95, rBot * 0.16));
      group.add(pts);
      anims.push((tt) => {
        const a = pts.geometry.attributes.position.array;
        for (let i = 0; i < P; i++) {
          let u = (seed[i] + tt * 0.35) % 1; reseat(a, i, u, rAt, h);
        }
        pts.geometry.attributes.position.needsUpdate = true;
      });
      break;
    }
    case 'pillars': {
      const K = 8, pillars = new THREE.Group();
      for (let i = 0; i < K; i++) {
        const a = (i / K) * Math.PI * 2;
        const g2 = new THREE.CylinderGeometry(0.12, 0.2, h, 8, 1, true);
        g2.translate(0, -h / 2, 0);
        const p = new THREE.Mesh(g2, mat(i % 2 ? color2 : color, 0.7, i % 2 === 0));
        p.position.set(Math.cos(a) * rBot * 0.62, 0, Math.sin(a) * rBot * 0.62);
        // splay outward toward the base.
        p.rotation.z = -Math.cos(a) * 0.18; p.rotation.x = Math.sin(a) * 0.18;
        pillars.add(p);
      }
      group.add(pillars);
      innerCore();
      anims.push((tt) => { pillars.rotation.y = tt * 0.5; pillars.children.forEach((p, i) => { p.material.opacity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(tt * 3 + i)); }); });
      break;
    }
    case 'plasma': {
      cone(rTop * 0.8, rBot * 0.85, 0.14, color);
      const N = 6, rings = [];
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;
        const t = new THREE.Mesh(new THREE.TorusGeometry(rAt(u), 0.16, 8, 20), mat(i % 2 ? color2 : color, 0.6, i % 2 === 0));
        t.rotation.x = Math.PI / 2; t.position.y = -u * h; group.add(t); rings.push({ m: t, u });
      }
      innerCore();
      anims.push((tt) => { rings.forEach((r, i) => { const w = 1 + 0.22 * Math.sin(tt * 4 + i * 1.3); r.m.scale.set(w, 1, w); r.m.position.y = -(r.u * h) + Math.sin(tt * 3 + i) * 0.2; }); });
      break;
    }
    case 'halo': {
      cone(rTop, rBot, 0.20, color);
      innerCore();
      const halo = new THREE.Mesh(new THREE.TorusGeometry(rBot * 1.15, 0.28, 10, 28), mat(color2, 0.8, false));
      halo.rotation.x = Math.PI / 2; halo.position.y = -h * 0.98; group.add(halo);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(rBot * 1.1, 28), mat(color, 0.14));
      disc.rotation.x = -Math.PI / 2; disc.position.y = -h * 0.985; group.add(disc);
      anims.push((tt) => { const s = 1 + 0.12 * Math.sin(tt * 2.5); halo.scale.set(s, s, 1); });
      break;
    }
    case 'lattice': {
      cone(rTop * 0.7, rBot * 0.8, 0.08, color);
      helixStrand(group, mat(color, 0.85), { rTop, rBot, h, turns: 2.5, phase: 0, count: 22, rAt, box: 0.2 });
      helixStrand(group, mat(color2, 0.85, false), { rTop, rBot, h, turns: -2.5, phase: 0, count: 22, rAt, box: 0.2 });
      anims.push((tt) => { group.rotation.y = Math.sin(tt * 0.6) * 0.4; });
      break;
    }
    case 'comet': {
      cone(rTop * 0.6, rBot * 0.6, 0.07, color);
      const P = 46, pos = new Float32Array(P * 3), seed = new Float32Array(P);
      for (let i = 0; i < P; i++) { seed[i] = Math.random(); reseat(pos, i, Math.random(), rAt, h, 0.5); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, pointsMat(color, 0.95, rBot * 0.22));
      group.add(pts);
      anims.push((tt) => {
        const a = pts.geometry.attributes.position.array;
        for (let i = 0; i < P; i++) { let u = (seed[i] + tt * 0.6) % 1; reseat(a, i, u, rAt, h, 0.5); }
        pts.geometry.attributes.position.needsUpdate = true;
      });
      break;
    }
    case 'solid':
    default: {
      cone(rTop, rBot, 0.24, color);
      innerCore();
      break;
    }
  }

  return {
    group,
    update(t) {
      if (def.rainbow) {
        const c = new THREE.Color().setHSL((t * 0.16) % 1, 0.9, 0.62);
        primaryMats.forEach((m) => m.color.copy(c));
        const c2 = new THREE.Color().setHSL((t * 0.16 + 0.5) % 1, 0.9, 0.62);
        secondaryMats.forEach((m) => m.color.copy(c2));
      }
      for (const fn of anims) fn(t);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
    },
  };
}

// place a strand of small cubes along a helix from top (u=0) to bottom (u=1).
function helixStrand(parent, material, o) {
  const { rTop, rBot, h, turns, phase, count, rAt, box = 0.18 } = o;
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0 : i / (count - 1);
    const r = rAt(u) * 0.96;
    const a = phase + u * turns * Math.PI * 2;
    const cube = new THREE.Mesh(new THREE.BoxGeometry(box, box, box), material);
    cube.position.set(Math.cos(a) * r, -u * h, Math.sin(a) * r);
    parent.add(cube);
  }
  return material;
}

// reposition particle i to depth u within the cone (deterministic scatter).
function reseat(arr, i, u, rAt, h, spread = 0.85) {
  const ang = (i * 2.39996) + u * 6.0;          // golden-angle scatter + drift
  const rr = rAt(u) * spread * (0.2 + 0.8 * ((i * 9301 + 49297) % 233280) / 233280);
  arr[i * 3] = Math.cos(ang) * rr;
  arr[i * 3 + 1] = -u * h;
  arr[i * 3 + 2] = Math.sin(ang) * rr;
}

// tiny soft round sprite for particle materials (cached).
let _dotTex = null;
function dotTexture() {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}
