// MOO-FO — entry point: renderer, camera, game state machine, scoring, wiring.

import * as THREE from 'three';
import { CFG, COLORS, IS_MOBILE, ENABLE_SHADOWS } from './config.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { UFO } from './ufo.js';
import { CowManager } from './cows.js';
import { FarmerManager } from './farmers.js';
import { Effects } from './effects.js';
import { Controls } from './controls.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { AudioManager } from './audio.js';

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.75 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (ENABLE_SHADOWS) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

const scene = new THREE.Scene();

const BASE_FOV = 52;
const WARP_FOV = 64;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.5, 900);
const CAM_OFFSET = new THREE.Vector3(0, 24, 27);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------
const audio = new AudioManager();
const world = new World(scene);
const sky = new Sky(scene);
const effects = new Effects(scene);
const ufo = new UFO(scene, world, effects, audio);

let cows = null;
let farmers = null;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const State = Object.freeze({
  MENU: 'menu', COUNTDOWN: 'countdown', PLAYING: 'playing', PAUSED: 'paused',
  CRASHING: 'crashing', ESCAPE: 'escape', GAMEOVER: 'gameover', WIN: 'win',
});
let state = State.MENU;

let score = 0;
let cowsGrabbed = 0;
let timeLeft = CFG.GAME_DURATION;
let lastTickSecond = -1;

let comboCount = 0;
let comboTimer = 0;

let shake = 0;
let endDelay = 0;

const HS_KEY = 'moofo-highscore';
const getHighscore = () => Number(localStorage.getItem(HS_KEY) || 0);
const setHighscore = (v) => localStorage.setItem(HS_KEY, String(v));

// ---------------------------------------------------------------------------
// Scoring / damage callbacks
// ---------------------------------------------------------------------------
function onAbduct({ kind, points, pos }) {
  comboCount = comboTimer > 0 ? comboCount + 1 : 1;
  comboTimer = CFG.COMBO_WINDOW;
  const mult = Math.min(comboCount, CFG.COMBO_MAX);
  const gained = points * mult;
  score += gained;
  if (kind !== 'chicken') cowsGrabbed += 1;

  const color = kind === 'golden' ? COLORS.gold : kind === 'chicken' ? 0xffffff : COLORS.uiGreen;
  effects.scorePopup(pos, `+${gained}`, color);
  if (kind === 'golden') hud.announce('GOLDEN COW!', { color: '#ffd54f' });
  if (mult >= 2) {
    hud.announce(`×${mult} COMBO!`, { small: true });
    audio.play('combo', { volume: 0.8, rate: 1 + 0.06 * mult });
  }
}

function onHitPlayer(damage) {
  if (state !== State.PLAYING) return;
  const died = ufo.takeDamage(damage);
  hud.flashDamage();
  shake = Math.min(shake + 0.7, 1.4);
  if (died) {
    state = State.CRASHING;
    endDelay = 0;
    ufo.startCrash();
    controls.setTouchVisible(false);
  }
}

// ---------------------------------------------------------------------------
// Entity lifecycle
// ---------------------------------------------------------------------------
function spawnEntities() {
  disposeEntities();
  cows = new CowManager(scene, world, effects, audio, { onAbduct });
  cows.populate();
  farmers = new FarmerManager(scene, world, effects, audio, { onHitPlayer });
}

function disposeEntities() {
  for (const mgr of [cows, farmers]) {
    if (!mgr) continue;
    if (typeof mgr.dispose === 'function') {
      mgr.dispose();
    } else {
      for (const e of mgr.cows || mgr.farmers || []) {
        if (e.group) scene.remove(e.group);
      }
    }
  }
  cows = farmers = null;
}

function resetRound() {
  score = 0;
  cowsGrabbed = 0;
  timeLeft = CFG.GAME_DURATION;
  lastTickSecond = -1;
  comboCount = 0;
  comboTimer = 0;
  shake = 0;
  ufo.reset(0, 40);
  spawnEntities();
}

// ---------------------------------------------------------------------------
// UI / controls wiring
// ---------------------------------------------------------------------------
const controls = new Controls({ onPause: () => togglePause() });

const ui = new UI({
  onStart: startGame,
  onResume: () => togglePause(),
  onRestart: () => { ui.hidePause(); ui.hideEnd(); beginRound(); },
  onQuitToMenu: quitToMenu,
  onToggleMute: () => { audio.setMuted(!audio.muted); ui.setMuteUI(audio.muted); },
});

const hud = new HUD(world);

async function startGame() {
  await audio.init();
  audio.play('start', { volume: 0.9 });
  await ui.hideStart();
  beginRound();
}

async function beginRound() {
  resetRound();
  hud.show();
  hud.update({ score, timeLeft, health: ufo.health, combo: 0, warpEnergy: ufo.warpEnergy });
  state = State.COUNTDOWN;
  await ui.countdown();
  state = State.PLAYING;
  controls.setTouchVisible(controls.isTouch);
}

function togglePause() {
  if (state === State.PLAYING) {
    state = State.PAUSED;
    audio.play('click', { volume: 0.6 });
    ui.showPause(audio.muted);
    controls.setTouchVisible(false);
  } else if (state === State.PAUSED) {
    state = State.PLAYING;
    audio.play('click', { volume: 0.6 });
    ui.hidePause();
    controls.setTouchVisible(controls.isTouch);
  }
}

function quitToMenu() {
  ui.hidePause();
  ui.hideEnd();
  hud.hide();
  controls.setTouchVisible(false);
  state = State.MENU;
  resetRound();
  ui.showStart(getHighscore());
}

function finishRound(won) {
  hud.hide();
  controls.setTouchVisible(false);
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) setHighscore(score);
  const payload = { score, cows: cowsGrabbed, highscore: Math.max(best, score), isNewBest };
  if (won) {
    let medal = null;
    if (score >= CFG.MEDALS.gold) medal = 'gold';
    else if (score >= CFG.MEDALS.silver) medal = 'silver';
    else if (score >= CFG.MEDALS.bronze) medal = 'bronze';
    audio.play('win', { volume: 0.9 });
    ui.showWin({ ...payload, medal });
    state = State.WIN;
  } else {
    audio.play('lose', { volume: 0.9 });
    ui.showGameOver(payload);
    state = State.GAMEOVER;
  }
}

// Auto-pause when the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === State.PLAYING) togglePause();
});

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let menuAngle = 0;

function updateCamera(dt) {
  if (state === State.MENU) {
    menuAngle += dt * 0.08;
    const r = 70;
    camPos.set(Math.sin(menuAngle) * r, 38, Math.cos(menuAngle) * r);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 1.5));
    camTarget.set(0, 4, 0);
    camera.lookAt(camTarget);
    camera.fov += (BASE_FOV - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    return;
  }

  const p = ufo.group.position;
  camPos.set(p.x + CAM_OFFSET.x, CAM_OFFSET.y + (state === State.ESCAPE ? p.y * 0.5 : 0), p.z + CAM_OFFSET.z);
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 5));

  camTarget.lerp(new THREE.Vector3(p.x, p.y * 0.5, p.z - 6), 1 - Math.exp(-dt * 6));

  if (shake > 0.001) {
    shake *= Math.exp(-dt * 6);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
  }
  camera.lookAt(camTarget);

  const targetFov = ufo.warping ? WARP_FOV : BASE_FOV;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const NO_INPUT = Object.freeze({ x: 0, z: 0, beam: false, warp: false });
let minimapAcc = 0;
let elapsed = 0;
let escapeConfettiDone = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === State.PAUSED) { renderer.render(scene, camera); return; }
  elapsed += dt;

  sky.update(dt, elapsed);
  world.update(dt, elapsed);
  effects.update(dt);

  if (state === State.PLAYING) {
    ufo.update(dt, controls.state);
    cows.update(dt, ufo);
    farmers.update(dt, ufo);
    effects.warpStreaks(ufo.warping, ufo.group);

    // Combo window
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) comboCount = 0;
    }

    // Round timer + final-seconds tick
    timeLeft -= dt;
    const sec = Math.ceil(timeLeft);
    if (timeLeft <= CFG.TICK_WARN_TIME && sec !== lastTickSecond && sec > 0) {
      lastTickSecond = sec;
      audio.play('tick', { volume: 0.7 });
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      state = State.ESCAPE;
      escapeConfettiDone = false;
      endDelay = 0;
      hud.announce("TIME'S UP!", {});
    }

    hud.update({
      score, timeLeft, health: ufo.health,
      combo: comboTimer > 0 ? Math.min(comboCount, CFG.COMBO_MAX) : 0,
      warpEnergy: ufo.warpEnergy,
    });

    minimapAcc += dt;
    if (minimapAcc >= 0.1) {
      minimapAcc = 0;
      hud.updateMinimap({
        player: { x: ufo.group.position.x, z: ufo.group.position.z, heading: ufo.heading },
        cows: cows.cows.map((c) => ({ x: c.group.position.x, z: c.group.position.z, kind: c.kind })),
        farmers: farmers.farmers.map((f) => ({ x: f.group.position.x, z: f.group.position.z })),
      });
    }
  } else if (state === State.MENU) {
    // Living diorama behind the title screen.
    if (cows) cows.update(dt, ufo);
    ufo.update(dt, NO_INPUT);
  } else if (state === State.CRASHING) {
    ufo.update(dt, NO_INPUT);
    if (ufo.dead) {
      endDelay += dt;
      if (endDelay > 1.3) finishRound(false);
    }
  } else if (state === State.ESCAPE) {
    // Victory: the UFO rockets up into the night sky.
    ufo.group.position.y += dt * (14 + ufo.group.position.y * 0.6);
    ufo.group.rotation.y += dt * 6;
    if (!escapeConfettiDone && ufo.group.position.y > 24) {
      escapeConfettiDone = true;
      effects.confettiAt(ufo.group.position.clone());
      audio.play('warp', { volume: 0.8, rate: 1.2 });
    }
    endDelay += dt;
    if (endDelay > 2.2) finishRound(true);
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
resetRound();
ui.showStart(getHighscore());
ui.setMuteUI(audio.muted);
camera.position.set(70, 38, 0);
camera.lookAt(0, 4, 0);
frame();
