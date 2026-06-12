# MOO-FO — Architecture Spec

A 3D UFO cow-abduction arcade game. Crossy Road voxel aesthetic, night-time farm,
90-second runs. Three.js (ES modules, **no build step**), playable on desktop + mobile.

This document is the **contract between modules**. Every exported name, signature,
unit and convention listed here is binding. `js/config.js` holds all shared constants —
import from it, never hard-code a tunable.

---

## Tech & conventions

- Three.js `0.165.0` via CDN import map: `import * as THREE from 'three'`.
- Pure ES modules. Each module imports only `three`, `./config.js`, and the modules
  this spec says it may.
- Units ≈ meters. `+Y` up. Map is `[-MAP_HALF, MAP_HALF]` on X and Z, centered at origin.
- Ground level is `y = 0`. **Every model factory returns a `THREE.Group` whose origin is
  at the bottom-center of the model** (sitting on the ground when `position.y = 0`).
- Style: chunky `BoxGeometry` voxel construction, `MeshLambertMaterial`, flat bright
  saturated colors (night look comes from lighting, NOT from dark materials).
  Round shapes use low-segment cylinders/spheres (6–8 segments) with `flatShading: true`.
- No textures, no external assets except generated WAVs in `assets/audio/`.
- Performance: world decoration (trees, bushes, fences, corn, rocks, cattails…) MUST use
  `THREE.InstancedMesh`. Dynamic entities (cows, farmers, chickens, UFO) are individual Groups.
- Shadow maps only when `!IS_MOBILE` (see config `ENABLE_SHADOWS`); every dynamic entity
  gets a cheap "blob shadow" (dark transparent circle mesh) regardless.

## File ownership (one owner per file — never touch another agent's files)

| File | Owner |
|---|---|
| `index.html`, `js/config.js`, `js/main.js`, `docs/*` | Integrator (lead) |
| `js/models.js` | Agent M (models) |
| `js/world.js`, `js/sky.js` | Agent W (world) |
| `js/ufo.js`, `js/cows.js`, `js/farmers.js`, `js/effects.js` | Agent G (gameplay) |
| `js/controls.js`, `js/hud.js`, `js/ui.js`, `css/style.css` | Agent U (interface) |
| `js/audio.js`, `tools/generate_audio.py`, `assets/audio/*` | Agent A (audio) |

---

## `js/config.js` (provided — read it)

Exports `CFG` (frozen object) and `COLORS` palette. Key values agents rely on:
map size, speeds, beam radius/height, scoring, timings, entity counts, `IS_MOBILE`,
`ENABLE_SHADOWS`. See the actual file for the full list.

---

## `js/models.js` — voxel model factories (Agent M)

Every factory: `(…) => THREE.Group`, origin bottom-center, built from shared cached
materials (`function mat(colorHex)` returning cached `MeshLambertMaterial`).
Set `castShadow`/`receiveShadow` on meshes only if `CFG.ENABLE_SHADOWS`.

Exports (exact names):

```js
export function createUFO()            // Ø≈5, h≈2.2. userData: { dome, ring, lights: Mesh[], beamAnchor: Object3D (bottom center) }
export function createCow(variant)     // 'holstein' | 'brown' | 'golden'. ~2.2 long, ~1.6 tall.
                                       // userData: { head, legs: [Mesh×4], tail, body } (pivots set so legs swing at hip, head nods at neck)
export function createFarmer(variant)  // 0|1|2 (different shirt/hat colors). ~2.0 tall.
                                       // userData: { head, arms: [l, r], legs: [l, r], gun, gunTip: Object3D at muzzle }
export function createChicken()        // ~0.55 tall. userData: { head, wings: [l, r] }
export function createTree(type)       // 0 oak (round canopy stack) | 1 pine (stacked cones) | 2 poplar (tall slim). 4–9 tall.
export function createBush(type)       // 0|1, ~0.8–1.4
export function createRock(type)       // 0|1|2
export function createBarn()           // big red barn ~12×9×10 (w×h×d), white trim, gambrel-ish roof, doors, hayloft window
export function createFarmhouse()      // ~10×8×8, porch, chimney, lit windows (emissive warm)
export function createSilo()           // r≈2.5, h≈12, dome cap
export function createWindmill()       // ~11 tall. userData: { blades: Group at hub }
export function createWell()           // stone ring + roof + crank
export function createScarecrow()      // post + shirt + straw hat
export function createTractor()        // ~3.5 long. userData: { wheels: Mesh[] }
export function createHayBale()        // round bale, lying
export function createFenceSection(length)  // posts every ~2 + two rails, height ≈1.1, runs along +X from origin
export function createBridge(length, width) // wooden plank bridge, runs along +X, slight arch ok
export function createCoop()           // small chicken coop ~3×2.5×2.5 with ramp
export function createPumpkin()        // ~0.5
export function createCornStalk()      // ~1.8 tall (will be instanced — keep ≤3 boxes… actually return Group; world may convert; keep simple)
export function createCattail()        // pond reed ~1.2
export function createSunflower()      // ~1.6
export function createLanternPost()    // ~3 tall, warm emissive lamp head
export function createMailbox()
export function createCar()            // pickup truck ~4 long, parked decoration
```

Detail bar is HIGH: e.g. cow has snout, nostrils, ears, horns, eyes, udder, tail with
tuft, body patches (extra thin boxes on the body for holstein spots); farmer has hat,
beard, overalls straps, boots; barn has trim boards, X-braces on doors. Crossy Road =
chunky but lovingly detailed.

`createCow('golden')`: gold body + `emissive` glow, tiny floating star boxes ok.

Also export `export function mat(hex)` (cached material) and
`export function blobShadow(radius)` → ground-hugging dark circle mesh
(`y = 0.02`, opacity ≈ 0.3) for reuse by gameplay/world.

---

## `js/world.js` (Agent W)

```js
export class World {
  constructor(scene)           // builds the ENTIRE static map into scene
  colliders                    // Array<{ x, z, r, h }>  cylinder obstacles (buildings, trees, windmill…) h = top height
  isWater(x, z)                // boolean (rivers, ponds, dam reservoir)
  cowSpawnAreas                // Array<{ x, z, r, count }>  pastures (NOT in water/buildings); counts sum to CFG.COW_COUNT
  chickenSpawnAreas            // Array<{ x, z, r, count }>  near coop; sum = CFG.CHICKEN_COUNT
  farmerSpawns                 // Array<{ x, z, patrolRadius }>  length = CFG.FARMER_COUNT, spread across map zones
  goldenCowSpot()              // returns {x, z} a random scenic spot for the golden cow
  drawMinimap(ctx, sizePx)     // paints full static top-down map into a 2D ctx: grass bg, fields, water,
                               // roads, building footprints, forest. Mapping: world (-MAP_HALF..MAP_HALF) → (0..sizePx), x→x, z→y.
  update(dt, elapsed)          // windmill blades, water shimmer, tractor driving its loop, etc.
}
```

Map layout (MAP_HALF = 400 → 800×800) — build all of this:
- Ground: one big plane, vertex-colored patchwork of field tones (subtle checker variation like Crossy Road grass rows).
- Winding **river** N→S (built from overlapping flat blue quads or a ribbon), 10–16 wide,
  with 2–3 wooden **bridges**; a **dam** (gray blocky wall) creating a wide reservoir lake; 2 ponds with cattails + lily pads.
- Farm core near center: farmhouse + lantern posts + well + mailbox + parked pickup, big barn + silo,
  chicken coop with fenced run, vegetable garden (sunflower + pumpkin rows), windmill.
- Second barn NE with hay bales field; **corn field** (instanced stalks in rows) with scarecrows;
  pumpkin patch; apple **orchard** grid; several fenced pastures (fence rectangles with gaps for gates) = cow spawn areas.
- Dirt roads (flat tan quads) linking farm buildings and bridges.
- A driving **tractor** looping a road circuit (animated in `update`).
- Dense forest ring at the map edge (instanced trees, also colliders for the inner row).
- Scatter: rocks, bushes, lone trees, hay bales. Thousands of instances are fine via InstancedMesh.
- Everything must respect: no decor in water, on roads, or overlapping buildings (simple
  rejection-sampling against an internal occupancy list is fine).

`js/sky.js`:

```js
export class Sky {
  constructor(scene)   // star Points (~1500, twinkle via shader-less material opacity or size attenuation trick ok),
                       // big low-poly MOON with glow sprite, 2–3 drifting voxel clouds, occasional shooting star.
                       // Also OWNS scene lighting: hemisphere (night blue), moon directional light
                       // (CFG.ENABLE_SHADOWS → casts shadow, tuned ortho frustum covering ~120 around origin is fine
                       // — actually make the shadow camera follow nothing; static covering center farm is acceptable),
                       // plus scene.fog = new THREE.Fog(COLORS.fog, 60, 420) and scene.background = COLORS.night.
  update(dt, elapsed)  // twinkle, cloud drift, shooting stars
}
```

---

## Gameplay (Agent G)

### `js/ufo.js`

```js
export class UFO {
  constructor(scene, world, effects, audio)
  group            // THREE.Group (the ship); group.position is authoritative
  health, maxHealth = CFG.UFO_MAX_HEALTH
  warpEnergy       // 0..1, drains while warping (CFG.WARP_DRAIN per s), regens (CFG.WARP_REGEN per s)
  beamActive       // bool (input.beam && !warping)
  warping          // bool
  heading          // radians, for minimap arrow
  dead, crashing   // crash state flags
  beamMesh         // glowing animated cone, visible while beamActive
  update(dt, input)        // input = { x:-1..1, z:-1..1, beam:bool, warp:bool } (already normalized)
  takeDamage(amount)       // flash, knockback-lite, returns true if this killed it; 0.5s invulnerability window
  startCrash()             // begin spiral-down crash; on ground impact → effects.explosion + this.dead = true
  beamWorldPos()           // {x, z} of beam center on ground
  reset(x, z)
}
```

Movement: smooth accel toward input dir (camera-relative is NOT needed — camera always
faces -Z-ish north; input x/z map to world X/Z), max speed `CFG.UFO_SPEED`
(× `CFG.WARP_MULT` while warping, × `CFG.BEAM_SLOW` while beaming). Bank/tilt into
movement, idle bob + slow ring counter-rotation, blinking lights. Altitude fixed
`CFG.UFO_ALTITUDE` with bob, +rise during warp slightly. Collide vs `world.colliders`
where `collider.h > flight clearance` → slide along; soft-clamp inside map bounds.
Flying over water is fine (it flies). Beam: animated translucent cone + inner bright
cylinder, pulsing rings, light flicker; plays/loops audio.

### `js/cows.js`

```js
export class CowManager {
  constructor(scene, world, effects, audio, { onAbduct })   // onAbduct({ kind:'cow'|'golden'|'chicken', points, pos })
  cows           // Array of live critters: { group, kind, … } (read by minimap)
  populate()     // spawn per world.cowSpawnAreas / chickenSpawnAreas + 1 golden cow at world.goldenCowSpot()
  update(dt, ufo)
}
```

Behaviors: wander (pick point, walk, graze pause, head bob, leg swing, occasional moo),
**flee** from UFO when beam near or UFO low+close (chickens panic harder, flap),
**abducted**: inside beam radius → lift toward UFO (CFG.BEAM_LIFT_SPEED), spin + scale
down near the ship → poof particles + `onAbduct` + remove. Beam released mid-lift →
fall with dust puff, brief stun, resume. Cows never enter water (steer away), avoid
colliders. Golden cow: faster, glowy, respawns at a new `goldenCowSpot()`
`CFG.GOLDEN_RESPAWN` seconds after abduction. Points: `CFG.SCORE_COW/GOLDEN/CHICKEN`.

### `js/farmers.js`

```js
export class FarmerManager {
  constructor(scene, world, effects, audio, { onHitPlayer })  // onHitPlayer(damage)
  farmers        // Array<{ group, … }> (read by minimap)
  update(dt, ufo)
}
```

One farmer per `world.farmerSpawns`. States: **patrol** (wander patrolRadius),
**chase** (UFO within CFG.FARMER_AGGRO — run toward, arms pumping),
**aim+shoot** (within CFG.FARMER_RANGE: stop, raise gun, lead the target slightly,
muzzle flash + tracer bullet ~CFG.BULLET_SPEED toward UFO). Bullets = glowing stretched
boxes; hit = sphere test vs UFO (r≈2.6) → `onHitPlayer(CFG.BULLET_DAMAGE)` + impact
spark; miss despawns at range/lifetime. Farmers shout (audio 'gunshot' on fire). They
never enter water; angry red "!" pops over head when aggroed. Walk/run leg+arm animation.

### `js/effects.js`

```js
export class Effects {
  constructor(scene)
  update(dt)
  abductPoof(pos)            // sparkle burst when critter is consumed
  dustPuff(pos)              // dropped cow landing
  muzzleFlash(pos)           
  bulletSpark(pos)           // bullet hits UFO
  explosion(pos)             // big voxel-chunk explosion (UFO crash)
  warpStreaks(active, ufoGroup) // speed-line particles trailing the ship while warping
  scorePopup(pos, text, colorHex) // floating, fading text sprite (canvas texture)
  confettiAt(pos)            // win celebration burst
}
```

Particles: small pooled box/plane meshes, simple velocity+gravity+fade. Keep pooled and capped.

---

## Interface (Agent U) — `controls.js`, `hud.js`, `ui.js`, `css/style.css`

All DOM is created by these modules (document.body append). `index.html` only has
`<canvas id="game-canvas">`. Use ids/classes prefixed `mf-`. CSS: chunky arcade style,
rounded, thick borders, glow accents (#7CFC9A green + #B388FF purple), `Rubik`/system
font stack via Google Fonts `<link>` injected from JS or @import — your call.
Must look great on phones (safe-area insets, `touch-action: none` on game areas).

### `js/controls.js`

```js
export class Controls {
  constructor({ onPause })      // Esc/P or mobile ⏸ button → onPause()
  state                         // { x:-1..1, z:-1..1, beam:bool, warp:bool } — normalized, combined kbd+touch
  isTouch                       // capability detection (touch events / coarse pointer)
  setTouchVisible(bool)         // show/hide mobile controls (joystick + BEAM/WARP buttons + pause)
  anyKeyOnce(cb)                // fire cb on next keydown/tap (for menus)
}
```

Keyboard: WASD + arrows = move, Space (hold) = beam, Shift (hold) = warp.
Touch: left-half dynamic-origin virtual joystick; right side two big round hold-buttons
**BEAM** and **WARP** with pressed states; small pause button top-center. Prevent
scrolling/zoom (`preventDefault`, `touch-action`), handle multi-touch correctly
(track pointer ids).

### `js/hud.js`

```js
export class HUD {
  constructor(world)            // builds DOM + minimap canvas; pre-renders world.drawMinimap into offscreen
  show() / hide()
  update({ score, timeLeft, health, combo, warpEnergy })  // every frame; cheap (only touch DOM on change)
  updateMinimap({ player:{x,z,heading}, cows:[{x,z,kind}], farmers:[{x,z}] }) // call ~10Hz; kind 'golden' = pulsing gold dot
  flashDamage()                 // red vignette flash
  announce(text, opts)          // big center banner, e.g. "GOLDEN COW!", "x3 COMBO!"
}
```

Layout: score top-left (big, with little cow icon counter), timer top-center (pulses
red + tick in last 10 s — visual only, audio handled by main), health bar + warp
energy bar bottom-left (segmented, arcade), minimap top-right (~170 px, rounded,
border glow; player = green triangle rotated by heading, cows white dots, golden
pulsing gold, farmers red). Combo badge appears near score when combo ≥ 2.

### `js/ui.js`

```js
export class UI {
  constructor({ onStart, onResume, onRestart, onQuitToMenu, onToggleMute })
  showStart(highscore)        // animated title screen: big MOO-FO logo (CSS art: wobbling cow + ufo made of divs ok),
                              // "ABDUCT ALL THE COWS" tagline, controls help (kbd vs touch aware), high score, big START button
  hideStart()                 // plays exit animation, resolves/calls back when done (return Promise)
  countdown()                 // returns Promise: 3…2…1…GO! big stamped numbers
  showPause(muted) / hidePause()  // dim overlay: RESUME / RESTART / MUTE toggle / QUIT TO MENU / controls recap
  showGameOver({ score, cows, highscore, isNewBest })  // UFO-destroyed theme: "MOO-VER & OUT" style, stats count-up, RETRY + MENU
  showWin({ score, cows, medal, highscore, isNewBest }) // time-up results: medal stamp ('bronze'|'silver'|'gold'|null per CFG.MEDALS), stats count-up, animated
  hideEnd()
  setMuteUI(muted)
}
```

Animations: CSS keyframes (slide/boing/stamp), score count-up via rAF. All screens
usable with keyboard (Enter/Space confirm) AND touch. New-best gets a flashing "NEW
RECORD!" ribbon.

---

## Audio (Agent A) — `tools/generate_audio.py` + `assets/audio/*.wav` + `js/audio.js`

Python 3 **stdlib only** (`math`, `wave`, `struct`, `random`) synthesizer script that
writes 22050 Hz 16-bit mono WAVs into `assets/audio/`. Run it; commit the WAVs.
Craft each sound (envelopes, FM/formant sweeps for moos, filtered noise for shots —
implement a simple one-pole lowpass; no clipping, peak-normalize ≈ −1 dB, short tails):

`ufo_hum` (loopable 2s pad), `beam` (loopable shimmer), `warp` (whoosh ramp),
`moo1` `moo2` `moo3` (pitch/length variants), `abduct` (rising sparkle arp),
`golden` (rich chime), `chicken` (cluck), `gunshot`, `hit` (metallic clank),
`explosion`, `tick` (clock blip), `combo` (quick rising arp), `click`,
`start` (game-start fanfare ~1.5s), `win` (victory jingle ~3s), `lose` (sad jingle ~2.5s).

```js
// js/audio.js
export class AudioManager {
  async init()                  // create AudioContext + fetch/decode all WAVs (call after first user gesture); resilient to missing files
  play(name, { volume = 1, rate = 1, ratejitter = 0 } = {})
  startLoop(name, { volume }) / stopLoop(name)   // hum, beam (seamless loop)
  setLoopVolume(name, v)        // e.g. hum louder during warp
  setMuted(bool) / muted        // persist in localStorage 'moofo-muted'
}
```

---

## `js/main.js` (Integrator) — for reference

State machine MENU → COUNTDOWN → PLAYING ⇄ PAUSED → GAMEOVER | WIN → (restart/menu).
Owns: renderer, perspective camera (smooth-follow behind/above UFO, FOV kick + streaks
during warp, shake on damage), the 90 s timer, score + combo logic
(chain window CFG.COMBO_WINDOW, multiplier ≤ CFG.COMBO_MAX), high score in
localStorage `moofo-highscore`, last-10s tick audio, medals, end-game animations
(crash already in UFO; win = UFO flies up offscreen + confetti), wiring all callbacks.
