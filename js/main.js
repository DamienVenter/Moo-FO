// MOO-FO — entry point: renderer, chase camera, game state machine, scoring,
// the world clock, and all the wiring.

import * as THREE from 'three';
import { CFG, COLORS, IS_MOBILE, ENABLE_SHADOWS } from './config.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { DayCycle } from './daycycle.js';
import { UFO } from './ufo.js';
import { CowManager } from './cows.js';
import { FarmerManager } from './farmers.js';
import { Effects } from './effects.js';
import { Controls } from './controls.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { AudioManager } from './audio.js';
import { Campaign, STAR_COINS } from './campaign.js';
import { MissionTracker, evaluateLevel } from './missions.js';
import { Wallet } from './wallet.js';
import { DogManager } from './dogs.js';
import { submitScore } from './leaderboard.js';

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
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.5, 1400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------
const audio = new AudioManager();
const cycle = new DayCycle();
const world = new World(scene);
const sky = new Sky(scene);
const effects = new Effects(scene);
const ufo = new UFO(scene, world, effects, audio);

let cows = null;
let farmers = null;
let dogs = null;

const wallet = new Wallet();
const tracker = new MissionTracker();

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

// Mode / campaign run state
const campaign = new Campaign();
let mode = 'free';            // 'free' | 'campaign'
let level = 0;               // current campaign level index (1..15), 0 in free play
let target = 0;              // score goal for the current campaign level (0 = none)
let timeLimit = CFG.GAME_DURATION;
let canComplete = false;     // campaign: score target reached → COMPLETE available

const HS_KEY = 'moofo-highscore';
const getHighscore = () => Number(localStorage.getItem(HS_KEY) || 0);
const setHighscore = (v) => localStorage.setItem(HS_KEY, String(v));

// ---------------------------------------------------------------------------
// Scoring / damage callbacks
// ---------------------------------------------------------------------------
function onAbduct({ kind, variant, points, pos }) {
  comboCount = comboTimer > 0 ? comboCount + 1 : 1;
  comboTimer = CFG.COMBO_WINDOW;
  const mult = Math.min(comboCount, CFG.COMBO_MAX);
  const gained = points * mult;
  score += gained;
  if (kind !== 'chicken') cowsGrabbed += 1;
  tracker.onAbduct(kind, variant);
  tracker.onCombo(mult);

  const color = kind === 'golden' ? COLORS.gold : kind === 'chicken' ? 0xffffff :
                kind === 'sheep' ? 0xeae6da : COLORS.uiGreen;
  effects.scorePopup(pos, `+${gained}`, color);
  if (kind === 'golden') hud.announce('GOLDEN COW!', { color: '#ffd54f' });
  if (mult >= 2) {
    hud.announce(`×${mult} COMBO!`, { small: true });
    audio.play('combo', { volume: 0.8, rate: 1 + 0.06 * mult });
  }
}

function onHitPlayer(damage) {
  if (state !== State.PLAYING) return;
  const landed = ufo._invuln <= 0 && !ufo.dead && !ufo.crashing;
  const died = ufo.takeDamage(damage);
  if (landed) tracker.onHit();   // count a real hit for the "no-hit" star
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
  dogs = new DogManager(scene, world, effects, audio, { farmers });
}

function disposeEntities() {
  for (const mgr of [cows, farmers, dogs]) {
    if (!mgr) continue;
    if (typeof mgr.dispose === 'function') {
      mgr.dispose();
    } else {
      for (const e of mgr.cows || mgr.farmers || mgr.dogs || []) {
        if (e.group) scene.remove(e.group);
      }
      if (mgr._bullets) for (const b of mgr._bullets) scene.remove(b.mesh);
    }
  }
  cows = farmers = dogs = null;
}

function resetRound() {
  score = 0;
  cowsGrabbed = 0;
  timeLeft = timeLimit;
  lastTickSecond = -1;
  comboCount = 0;
  comboTimer = 0;
  shake = 0;
  tracker.reset();
  canComplete = false;
  // Fresh random spawn over open ground every round.
  const sp = world.randomSpawn();
  ufo.reset(sp.x, sp.z);
  const faceCenter = Math.atan2(-sp.x, -sp.z);  // look roughly toward the farm
  ufo.heading = faceCenter;
  camYaw = faceCenter;
  orbitOffset = 0;
  spawnEntities();
}

// ---------------------------------------------------------------------------
// UI / controls wiring
// ---------------------------------------------------------------------------
const controls = new Controls({
  onPause: () => togglePause(),
  onComplete: () => requestComplete(),
});

// Campaign: once the score target is met, the run keeps going (chase the bonus
// stars) until the player hits COMPLETE (Q / the button) or time runs out.
function requestComplete() {
  if (state !== State.PLAYING || mode !== 'campaign' || !canComplete) return;
  state = State.ESCAPE;
  escapeConfettiDone = false;
  endDelay = 0;
  ufo.forceStopBeam();
  controls.setTouchVisible(false);
  hud.announce('MISSION COMPLETE!', { color: '#7cfc9a' });
}

const ui = new UI({
  onStart: startGame,
  onResume: () => togglePause(),
  onRestart: () => { ui.hidePause(); ui.hideEnd(); beginRound(); },
  onQuitToMenu: quitToMenu,
  onToggleMute: () => { audio.setMuted(!audio.muted); ui.setMuteUI(audio.muted); },
  controls,
  wallet,
  campaign,
  onStartLevel: startLevel,
  onRetryLevel: () => { ui.hideEnd(); beginLevel(level); },
  onNextLevel: () => { ui.hideEnd(); beginLevel(Math.min(campaign.levels.length, level + 1)); },
  onLevelSelect: () => {
    ui.hideEnd();
    hud.hide();
    state = State.MENU;
    mode = 'free'; level = 0; target = 0; timeLimit = CFG.GAME_DURATION;
    resetRound();
    ui.showLevelSelect();
  },
});

const hud = new HUD(world);
hud.onComplete = requestComplete;   // in-game COMPLETE button

async function startGame() {
  await audio.init();
  audio.play('start', { volume: 0.9 });
  mode = 'free'; level = 0; target = 0; timeLimit = CFG.GAME_DURATION;
  await ui.hideStart();
  beginRound();
}

// Campaign: launch a specific level from the level-select screen.
async function startLevel(i) {
  await audio.init();
  audio.play('start', { volume: 0.9 });
  const L = campaign.levels[i - 1];
  mode = 'campaign'; level = i; target = L.target; timeLimit = L.time;
  await ui.hideStart();
  beginRound();
}

// Restart a level directly (from the results screen — no title transition).
function beginLevel(i) {
  const L = campaign.levels[i - 1];
  mode = 'campaign'; level = i; target = L.target; timeLimit = L.time;
  beginRound();
}

async function beginRound() {
  resetRound();
  hud.show();
  hud.update({ score, timeLeft, health: ufo.health, combo: 0, warpEnergy: ufo.warpEnergy, cows: 0, goal: target });
  state = State.COUNTDOWN;
  await ui.countdown();
  state = State.PLAYING;
  controls.setTouchVisible(controls.isTouch);
}

function togglePause() {
  if (state === State.PLAYING) {
    state = State.PAUSED;
    ufo.forceStopBeam();
    audio.play('click', { volume: 0.6 });
    audio.stopLoop('waterfall');
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
  ufo.forceStopBeam();
  audio.stopLoop('waterfall');
  state = State.MENU;
  mode = 'free'; level = 0; target = 0; timeLimit = CFG.GAME_DURATION;
  resetRound();
  ui.showStart(getHighscore());
}

// End-of-run router. Campaign runs go to the level-result screen; free play to
// the classic win/game-over screens.
function endRound(crashed) {
  if (mode === 'campaign') { finishLevel(); return; }
  finishRound(!crashed);
}

function finishRound(won) {
  hud.hide();
  controls.setTouchVisible(false);
  audio.stopLoop('waterfall');
  const best = getHighscore();
  const isNewBest = score > best;
  if (isNewBest) setHighscore(score);
  const payload = { score, cows: cowsGrabbed, highscore: Math.max(best, score), isNewBest };
  submitScore(score, 'free');   // local board now; global once /server is deployed
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

function finishLevel() {
  hud.hide();
  controls.setTouchVisible(false);
  audio.stopLoop('waterfall');
  const L = campaign.levels[level - 1];
  const evalRes = evaluateLevel(L, score, tracker);
  const won = evalRes.scoreDone;
  const rec = campaign.recordRun(level, score, evalRes.bonusMet);
  const prevBalance = wallet.getBalance();
  const newBalance = rec.coinsEarned > 0 ? wallet.add(rec.coinsEarned) : prevBalance;
  if (won) submitScore(score, 'campaign');
  audio.play(won ? 'win' : 'lose', { volume: 0.9 });
  ui.showLevelResult({
    won, index: level, score, target,
    objectives: evalRes.objectives,   // [{label,done} ×3]; row 1 is the score
    stars: rec.stars,                 // 0..3 earned this run
    coinRewards: STAR_COINS,          // [50, 100, 150]
    coinsEarned: rec.coinsEarned,
    prevBalance, newBalance,
    isNewBest: rec.isNewBest,
    hasNext: won && level < campaign.levels.length,
  });
  state = won ? State.WIN : State.GAMEOVER;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === State.PLAYING) togglePause();
});

// Iconic boot jingle: play it the instant the player first interacts (the
// earliest moment the browser lets us make sound) on the title screen.
let _bootJingle = false;
function bootJingle() {
  if (_bootJingle) return;
  _bootJingle = true;
  audio.init().then(() => audio.play('jingle', { volume: 0.85 })).catch(() => {});
}
window.addEventListener('pointerdown', bootJingle, { once: true });
window.addEventListener('keydown', bootJingle, { once: true });

// Waterfall ambience: a proximity loop that swells as you near the falls.
function updateWaterfallSound() {
  const wf = world.waterfallPos;
  if (!wf) return;
  let vol = 0;
  if (state === State.PLAYING || state === State.COUNTDOWN) {
    const d = Math.hypot(ufo.group.position.x - wf.x, ufo.group.position.z - wf.z);
    vol = Math.max(0, 1 - d / 72) * 0.7;
  }
  if (vol > 0.02) audio.startLoop('waterfall', { volume: vol });
  else audio.stopLoop('waterfall');
}

// ---------------------------------------------------------------------------
// Chase camera with manual orbit (Q/E, right stick, mouse drag)
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let camYaw = Math.PI;        // yaw the camera sits behind
let orbitOffset = 0;         // player's manual offset from the chase yaw
let menuAngle = 0;
let freeCam = null;          // cinematic camera override for promo captures

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function updateCamera(dt) {
  if (freeCam) {   // debug/cinematic override (used for capturing promo art)
    camera.position.set(freeCam.pos[0], freeCam.pos[1], freeCam.pos[2]);
    camera.lookAt(freeCam.look[0], freeCam.look[1], freeCam.look[2]);
    camera.fov = freeCam.fov || BASE_FOV;
    camera.updateProjectionMatrix();
    return;
  }
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

  // manual orbit input. Keyboard (Q/E) and controller right-stick go through
  // controls.orbit unchanged; the mouse-drag term is inverted (and only it)
  // so dragging right swings the camera right — per the player's request.
  orbitOffset += controls.orbit * CFG.CAM_ORBIT_SPEED * dt;
  orbitOffset += controls.consumeDragDelta() * -CFG.CAM_DRAG_GAIN;
  orbitOffset = wrapAngle(orbitOffset);
  const speed = Math.hypot(ufo.velocity.x, ufo.velocity.z);
  if (controls.orbit === 0 && speed > 6) {
    orbitOffset *= Math.exp(-dt * 0.7);   // drift back behind the ship while flying
  }

  // chase: settle behind the flight heading (+ the player's offset)
  const targetYaw = ufo.heading + orbitOffset;
  camYaw += wrapAngle(targetYaw - camYaw) * Math.min(1, dt * CFG.CAM_FOLLOW);

  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  const p = ufo.group.position;

  camPos.set(
    p.x - fx * CFG.CAM_DIST,
    p.y + CFG.CAM_HEIGHT * 0.82 + (state === State.ESCAPE ? p.y * 0.4 : 0),
    p.z - fz * CFG.CAM_DIST
  );
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 5));

  camTarget.lerp(new THREE.Vector3(p.x + fx * 5, p.y - 3, p.z + fz * 5), 1 - Math.exp(-dt * 6));

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

// Rotate joystick/key input into camera space so "up" is always "away".
// forward = (fx, fz), right = (-fz, fx); world = right·x + forward·(-z).
const _rotInput = { x: 0, z: 0, beam: false, warp: false };
function cameraRelativeInput() {
  const s = controls.state;
  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  _rotInput.x = -s.x * fz - s.z * fx;
  _rotInput.z = s.x * fx - s.z * fz;
  _rotInput.beam = s.beam;
  _rotInput.warp = s.warp;
  return _rotInput;
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
  elapsed += dt;

  // The world clock never stops — menus and pause included.
  cycle.update(dt);
  hud.updateClock({ phase: cycle.phase, name: cycle.name, icon: cycle.icon });
  sky.update(dt, elapsed, cycle);

  if (state === State.PAUSED) {
    renderer.render(scene, camera);
    return;
  }

  controls.poll();
  world.update(dt, elapsed, cycle, ufo.group.position);
  effects.update(dt);

  if (state === State.PLAYING) {
    ufo.update(dt, cameraRelativeInput());
    cows.update(dt, ufo);
    farmers.update(dt, ufo);
    dogs.update(dt, ufo);
    effects.warpStreaks(ufo.warping, ufo.group);
    if (ufo.warping) tracker.onWarp();

    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) comboCount = 0;
    }

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
      ufo.forceStopBeam();           // hard-exit beam mode: no sound/visual carries over
      hud.announce("TIME'S UP!", {});
    }

    // Campaign: the goal being met no longer auto-ends the run — it just arms
    // the COMPLETE control so you can keep chasing the bonus stars.
    canComplete = mode === 'campaign' && target > 0 && score >= target;

    hud.update({
      score, timeLeft, health: ufo.health,
      combo: comboTimer > 0 ? Math.min(comboCount, CFG.COMBO_MAX) : 0,
      warpEnergy: ufo.warpEnergy, cows: cowsGrabbed, goal: target,
      canComplete,
    });

    minimapAcc += dt;
    if (minimapAcc >= 0.1) {
      minimapAcc = 0;
      hud.updateMinimap({
        player: { x: ufo.group.position.x, z: ufo.group.position.z, heading: ufo.heading },
        cows: cows.cows.filter((c) => c.kind !== 'duck')
          .map((c) => ({ x: c.group.position.x, z: c.group.position.z, kind: c.kind })),
        farmers: farmers.farmers.map((f) => ({ x: f.group.position.x, z: f.group.position.z })),
        dogs: dogs.dogs.map((d) => ({ x: d.group.position.x, z: d.group.position.z })),
      });
      if (mode === 'campaign') {
        hud.setObjectives(evaluateLevel(campaign.levels[level - 1], score, tracker).objectives);
      }
    }

    // Flew into the mountain (or otherwise crashed): you lose.
    if ((ufo.crashing || ufo.dead) && state === State.PLAYING) {
      state = State.CRASHING;
      endDelay = 0;
      controls.setTouchVisible(false);
      audio.stopLoop('waterfall');
    }
  } else if (state === State.MENU) {
    if (cows) cows.update(dt, ufo);
    ufo.update(dt, NO_INPUT);
  } else if (state === State.CRASHING) {
    ufo.update(dt, NO_INPUT);
    if (cows) cows.update(dt, ufo);   // anything mid-lift falls free
    if (ufo.dead) {
      endDelay += dt;
      if (endDelay > 1.3) endRound(true);
    }
  } else if (state === State.ESCAPE) {
    if (cows) cows.update(dt, ufo);   // released critters drop while we leave
    ufo.group.position.y += dt * (14 + ufo.group.position.y * 0.6);
    ufo.group.rotation.y += dt * 6;
    // Celebrate on a win (free-play time-up, or a completed mission) — not on a
    // campaign time-up where the goal was missed.
    const celebrate = mode !== 'campaign' || score >= target;
    if (celebrate && !escapeConfettiDone && ufo.group.position.y > 30) {
      escapeConfettiDone = true;
      effects.confettiAt(ufo.group.position.clone());
      audio.play('warp', { volume: 0.8, rate: 1.2 });
    }
    endDelay += dt;
    if (endDelay > 2.2) endRound(false);
  }

  updateWaterfallSound();
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Debug/testing hook (read-only-ish; not part of the public surface).
window.__MOOFO = {
  get state() { return state; },
  get score() { return score; },
  get timeLeft() { return timeLeft; },
  get ufo() { return ufo; },
  get cows() { return cows; },
  get farmers() { return farmers; },
  get dogs() { return dogs; },
  get cycle() { return cycle; },
  get mode() { return mode; },
  get level() { return level; },
  get target() { return target; },
  get campaign() { return campaign; },
  addScore(n) { score += n; },   // test hook
  setFreeCam(pos, look, fov) { freeCam = { pos, look, fov }; },
  clearFreeCam() { freeCam = null; },
};

resetRound();
ui.showStart(getHighscore());
ui.setMuteUI(audio.muted);
camera.position.set(70, 38, 0);
camera.lookAt(0, 4, 0);
frame();
