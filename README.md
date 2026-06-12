# 🛸 MOO-FO

**Abduct all the cows.** You have 90 seconds.

A 3D voxel arcade game in the Crossy Road style, built with Three.js.
You pilot a UFO over a huge night-time farm — beam up cows (and the odd chicken),
chain combos, hunt the golden cow, and dodge shotgun-toting farmers.

## How to play

| Action | Desktop | Mobile |
|---|---|---|
| Fly | WASD / Arrow keys | Left-side virtual joystick |
| Tractor beam | Hold **Space** | Hold **BEAM** |
| Warp speed | Hold **Shift** | Hold **WARP** |
| Pause | **Esc** / **P** | ⏸ button |

- **Cows** are worth 100, **chickens** 25, the **golden cow** 500.
- Grab quickly to chain a **combo** — up to ×4 points.
- Farmers chase and shoot. Lose all health and you crash.
- Survive the full 90 seconds and warp out with your score. Medals at 1500 / 3000 / 5000.

## Run it

No build step. Serve the folder with any static server:

```bash
npx serve .          # or: python3 -m http.server 8000
```

Open the URL on desktop or phone. Three.js loads from a CDN import map.

## Project layout

```
index.html          shell (canvas + import map)
css/style.css       all UI styling
js/config.js        every tunable + palette
js/main.js          game loop, state machine, scoring, camera
js/models.js        voxel model factories (Crossy-Road-style)
js/world.js         800×800 map generation (instanced), colliders, minimap art
js/sky.js           stars, moon, clouds, lighting, fog
js/ufo.js           player ship, beam, warp, crash
js/cows.js          cow/chicken/golden-cow AI + abduction
js/farmers.js       farmer AI + bullets
js/effects.js       pooled particles, popups, explosion
js/controls.js      keyboard + touch input
js/hud.js           score/timer/health/warp HUD + minimap
js/ui.js            title, countdown, pause, game-over, win screens
js/audio.js         WebAudio manager
tools/generate_audio.py   procedural WAV synthesizer (stdlib only)
assets/audio/       generated sound effects
docs/SPEC.md        module contracts
docs/IDEAS.md       roadmap & future ideas
```

Regenerate the sounds anytime with `python3 tools/generate_audio.py`.
