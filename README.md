# Shootout

A mobile-first tactical first-person shooter. Grounded, lethal gunplay with the
presentation of a modern mobile shooter: eye-height first-person camera, weapon
viewmodel, touch controls. No body-worn-camera treatment — no fisheye, no chest
mount, no timestamp overlay, no VHS grain.

All art and geometry in this repository is original. No third-party game assets,
names, maps, or trademarks are used.

## Status

**Phase 0 complete.** Boot, greybox level, and full touch movement at 60 fps.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Boot, greybox map, touch movement, deployed URL | Done |
| 1 | Weapons, viewmodel, shooting, HUD, sound | Next |
| 2 | Bots, team deathmatch, match flow, PWA install | Planned |
| 3 | Authoritative multiplayer server, 5v5 | Planned |
| 4 | Art pass, second map, progression | Planned |

## Stack

| Concern | Choice |
| --- | --- |
| Renderer | Babylon.js 9, WebGL2 |
| Language | TypeScript, strict |
| Bundler | Vite |
| Collision | Babylon swept-ellipsoid collider |
| Unit tests | Vitest |
| End-to-end | Playwright, desktop and phone viewports |

Why Babylon.js over three.js is recorded in `docs/GAME_PROMPT.md`.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173, --host so a phone on the LAN can reach it
npm run build        # typecheck, then production bundle into dist/
npm run preview      # serve the production build
npm run test         # unit tests
npm run test:e2e     # browser smoke tests
npm run lint
```

To test on a phone, run `npm run dev` and open the network address it prints on a
device on the same network.

## Controls

| Input | Touch | Keyboard and mouse |
| --- | --- | --- |
| Move | Drag anywhere on the left half. The stick appears under your thumb. | W, A, S, D |
| Sprint | Push the stick to its outer ring | Left Shift |
| Look | Drag anywhere on the right half | Mouse, click to capture |
| Crouch | CROUCH button, latches | Ctrl or C |
| Lean | Q and E buttons | Q and E |

## Architecture

```
src/
  sim/      pure gameplay. No Babylon imports, so it can run on a server.
  view/     Babylon presentation of simulation state
  input/    pointer, keyboard and gyroscope handling
  engine/   render loop, quality tiers
  hud/      DOM overlay
  maps/     level definitions as data
```

Two rules hold the design together.

**The simulation never imports the engine.** `src/sim` is plain TypeScript
operating on numbers. The level reaches it through a `CollisionWorld` interface
that `src/view` implements with Babylon's collider. When Phase 3 adds an
authoritative server, the same simulation code runs there unchanged.

**The simulation runs on a fixed 60 Hz step; rendering interpolates.** Gameplay
is therefore frame-rate independent, which a unit test asserts directly. Aim is
the deliberate exception: look angles are applied at render rate, because
interpolating them reads as input lag.

## Performance

Budget: 60 fps on an iPhone 12 or Pixel 6, 30 fps floor on a 2020 mid-range
Android, under 150 draw calls, under 15 MB initial load.

Measured for Phase 0:

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 386 KB |
| Draw calls, whole level | 5 |
| Frame rate, software rasteriser in CI | 54 to 60 fps |

Every brush of a given surface kind is merged into one mesh, which is why the
entire level costs five draw calls. Quality tiers are picked from the GPU string
at boot and can be stepped down once by a three-second frame-time benchmark,
because the GPU string alone is an unreliable guide.

## Tuning

Every gameplay number lives in `src/sim/config.ts`. Nothing is hard-coded at a
call site. Movement speeds, stance heights, look sensitivity, camera bob and the
joystick deadzone are all there.
