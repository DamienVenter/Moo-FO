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

  // UFO
  UFO_ALTITUDE: 11,
  UFO_SPEED: 26,             // max speed, units/s
  UFO_ACCEL: 60,
  UFO_FRICTION: 4.5,         // velocity damping /s when no input
  WARP_MULT: 2.4,
  BEAM_SLOW: 0.55,           // speed multiplier while beaming
  UFO_MAX_HEALTH: 100,
  HIT_INVULN: 0.5,           // seconds of invulnerability after a hit
  WARP_DRAIN: 1 / 3.0,       // warp energy drained per second (full tank = 3 s)
  WARP_REGEN: 1 / 5.0,       // regen per second while not warping

  // Beam
  BEAM_RADIUS: 4.2,          // capture radius on the ground
  BEAM_LIFT_SPEED: 5.5,      // units/s upward
  CONSUME_DIST: 2.2,         // distance from ship center at which critter is consumed

  // Critters
  COW_COUNT: 46,
  CHICKEN_COUNT: 14,
  COW_SPEED: 2.2,
  COW_FLEE_SPEED: 4.6,
  CHICKEN_SPEED: 2.0,
  CHICKEN_FLEE_SPEED: 5.5,
  FLEE_RADIUS: 14,           // UFO proximity that scares critters
  GOLDEN_RESPAWN: 12,        // seconds after abduction before golden cow returns
  GOLDEN_SPEED_MULT: 1.8,

  // Farmers
  FARMER_COUNT: 4,
  FARMER_WALK: 3.0,
  FARMER_RUN: 7.5,
  FARMER_AGGRO: 55,          // starts chasing
  FARMER_RANGE: 34,          // stops and shoots
  FARMER_FIRE_RATE: 1.1,     // seconds between shots
  BULLET_SPEED: 55,
  BULLET_DAMAGE: 9,
  BULLET_LIFETIME: 2.0,

  // Scoring
  SCORE_COW: 100,
  SCORE_GOLDEN: 500,
  SCORE_CHICKEN: 25,
  COMBO_WINDOW: 5.0,         // seconds between grabs to keep the chain
  COMBO_MAX: 4,              // multiplier cap (x4)
  MEDALS: { bronze: 1500, silver: 3000, gold: 5000 },
});

// Shared palette — bright base colors; the night look comes from lighting/fog.
export const COLORS = Object.freeze({
  night: 0x0b1026,           // scene background
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
