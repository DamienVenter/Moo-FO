// MOO-FO shared configuration. Every tunable lives here — modules must not
// hard-code values that appear in this file.

export const IS_MOBILE =
  (typeof navigator !== 'undefined' &&
    (navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))) &&
  (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);

export const ENABLE_SHADOWS = !IS_MOBILE;

export const CFG = Object.freeze({
  // World
  MAP_HALF: 400,             // playable area is [-400, 400] on X and Z
  SOFT_BOUND: 380,           // UFO gets pushed back inside this radius-ish bound

  // Round
  GAME_DURATION: 90,         // seconds
  TICK_WARN_TIME: 10,        // last N seconds: timer pulses + tick sfx

  // Day/night cycle (continuous world clock, runs through menus too)
  DAY_CYCLE_SECONDS: 720,    // full cycle = 12 minutes, fixed
  DAY_START_PHASE: 0.78,     // begins in the evening night (0 = midnight)

  // UFO
  UFO_ALTITUDE: 11,          // height above the terrain underneath
  UFO_SPEED: 26,             // max speed, units/s
  UFO_ACCEL: 60,
  UFO_FRICTION: 4.5,         // velocity damping /s when no input
  WARP_MULT: 2.4,
  BEAM_SLOW: 0.55,           // speed multiplier while beaming
  UFO_MAX_HEALTH: 30,        // harder: ~3 hits and you're down
  HIT_INVULN: 0.4,           // seconds of invulnerability after a hit
  WARP_DRAIN: 1 / 3.0,       // warp energy drained per second (full tank = 3 s)
  WARP_REGEN: 1 / 5.0,       // regen per second while not warping

  // Camera
  CAM_DIST: 27,
  CAM_HEIGHT: 24,
  CAM_ORBIT_SPEED: 1.6,      // rad/s at full manual-orbit input (gentler)
  CAM_FOLLOW: 1.7,           // chase-yaw follow rate — lower = calmer swing
  CAM_DRAG_GAIN: 0.0034,     // mouse-drag → orbit radians per px (inverted in main)

  // Beam
  BEAM_RADIUS: 4.2,          // capture radius on the ground
  BEAM_DROP_RADIUS: 5.4,     // lifted critters falling outside this are dropped
  BEAM_LIFT_SPEED: 5.5,      // units/s upward
  CONSUME_DIST: 2.2,         // distance from ship center at which critter is consumed

  // Critters
  COW_COUNT: 46,
  CHICKEN_COUNT: 14,
  SHEEP_COUNT: 10,
  DUCK_COUNT: 8,             // ducks are NOT abductable — atmosphere + panic only
  COW_SPEED: 2.2,
  COW_FLEE_SPEED: 4.6,
  CHICKEN_SPEED: 2.0,
  CHICKEN_FLEE_SPEED: 5.5,
  SHEEP_SPEED: 2.0,
  SHEEP_FLEE_SPEED: 5.0,
  FLEE_RADIUS: 14,           // UFO proximity that scares critters
  GOLDEN_RESPAWN: 12,        // seconds after abduction before golden cow returns
  GOLDEN_SPEED_MULT: 1.8,
  FENCE_JUMP_CHANCE: 0.08,   // chance a blocked, fleeing cow hops the fence

  // Farmers (harder: they sprint and lead their shots)
  FARMER_COUNT: 4,
  FARMER_WALK: 3.4,
  FARMER_RUN: 9.5,
  FARMER_AGGRO: 75,          // starts chasing
  FARMER_RANGE: 40,          // stops and shoots
  FARMER_FIRE_RATE: 0.85,    // seconds between shots
  BULLET_SPEED: 70,
  BULLET_DAMAGE: 9,
  BULLET_LIFETIME: 2.0,

  // Scoring
  SCORE_COW: 100,
  SCORE_GOLDEN: 500,
  SCORE_CHICKEN: 25,
  SCORE_SHEEP: 75,
  COMBO_WINDOW: 5.0,         // seconds between grabs to keep the chain
  COMBO_MAX: 4,              // multiplier cap (x4)
  MEDALS: { bronze: 1500, silver: 3000, gold: 5000 },
});

// Shared palette — bright base colors; mood comes from the day-cycle lighting.
export const COLORS = Object.freeze({
  night: 0x0b1026,           // scene background (night keyframe)
  fog: 0x141b3d,
  moon: 0xfff6d8,
  moonlight: 0xb9c7ff,
  hemiSky: 0x3a4a8a,
  hemiGround: 0x1c2a26,

  grassA: 0x4caf50,
  grassB: 0x43a047,
  grassC: 0x57bb5b,
  field: 0x8d6e3f,
  road: 0xc2a25e,
  water: 0x3f7fd6,
  waterDeep: 0x2f63b0,
  sand: 0xd9c27e,
  rockGray: 0x8d9499,
  snow: 0xeef3f8,

  barnRed: 0xc62828,
  barnTrim: 0xfdf5e6,
  roof: 0x6d4c41,
  wood: 0x8d6e63,
  woodDark: 0x5d4037,
  stone: 0x9e9e9e,

  cowWhite: 0xf5f5f0,
  cowBlack: 0x2b2b2b,
  cowBrown: 0x8d5a3b,
  cowPink: 0xf2a9b8,
  gold: 0xffd54f,
  wool: 0xeae6da,
  duck: 0x8d6e3f,
  duckHead: 0x2e7d4f,

  ufoBody: 0x9aa7b8,
  ufoDome: 0x7ce8ff,
  ufoGlow: 0x7cfc9a,
  beam: 0x9af7b0,

  denim: 0x3f6fb5,
  shirt: 0xd84315,
  skin: 0xe8b88a,
  straw: 0xe6c35c,

  uiGreen: 0x7cfc9a,
  uiPurple: 0xb388ff,
  danger: 0xff5252,
});
