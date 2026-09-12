# Shootout

A mobile-first tactical first-person shooter. Grounded, lethal gunplay with the
presentation of a modern mobile shooter: eye-height first-person camera, weapon
viewmodel, touch controls. No body-worn-camera treatment — no fisheye, no chest
mount, no timestamp overlay, no VHS grain.

All art and geometry in this repository is original. No third-party game assets,
names, maps, or trademarks are used.

## Status

**Phase 1 complete.** Four weapons, a first-person viewmodel, hitscan shooting
against practice targets, a full combat HUD, and synthesised weapon audio.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Boot, greybox map, touch movement, deployed URL | Done |
| 1 | Weapons, viewmodel, shooting, HUD, sound | Done |
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
| Audio | Web Audio, synthesised at runtime, no samples |
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

## Weapons

Four original designs. Damage is built backwards from the lethality target:
three body shots or fewer, one headshot always, and a kill between 100 and 300
milliseconds. Unit tests assert all three rules against every weapon, so a
retune that breaks the design fails the build.

| Weapon | Class | Damage | Rate | Magazine | Body shots | Time to kill |
| --- | --- | --- | --- | --- | --- | --- |
| Ridgeline | Assault rifle | 34 | 620 rpm | 30 | 3 | 194 ms |
| Wasp | Submachine gun | 35 | 900 rpm | 25 | 3 | 133 ms |
| Breaker 12 | Pump shotgun | 14 x 8 | 70 rpm | 5 | 1 | one shot |
| P9 | Sidearm | 34 | 450 rpm | 15 | 3 | 266 ms |

Range is what separates them. The submachine gun is the fastest kill in the
game inside twelve metres and the worst past thirty, where its damage floor
turns three shots into five. The shotgun kills in one inside eight metres and
cannot kill at all past twenty. The rifle barely notices distance.

Recoil is a fixed per-shot pattern rather than random kick, so it can be
learned. Sustained fire also widens the cone, which is why tapping beats
holding at range.

## Controls

| Input | Touch | Keyboard and mouse |
| --- | --- | --- |
| Move | Drag anywhere on the left half. The stick appears under your thumb. | W, A, S, D |
| Sprint | Push the stick to its outer ring | Left Shift |
| Look | Drag anywhere on the right half | Mouse, click to capture |
| Fire | FIRE, on either side of the screen | Left mouse button |
| Aim | ADS | Right mouse button |
| Reload | RELOAD | R |
| Swap weapon | SWAP | Tab or F |
| Crouch | Not on the touch layout | Ctrl or C |
| Lean | Not on the touch layout | Q and E |

Crouch and lean stay in the simulation and on the keyboard, but they are off
the touch layout. On a phone, thumb space is the scarcest resource, and it
belongs to firing and aiming.

## Architecture

```
src/
  sim/      pure gameplay. No Babylon imports, so it can run on a server.
  view/     Babylon presentation of simulation state
  input/    pointer, keyboard and gyroscope handling
  engine/   render loop, quality tiers, audio synthesis
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

Shooting follows the same split. The simulation decides what was fired and in
which directions, then asks a `HitscanWorld` interface what the rays hit; the
Babylon layer answers. Scatter comes from a seeded generator rather than
`Math.random`, so a shot is reproducible from its seed, which is what the
authoritative server will need in Phase 3.

The weapon is drawn by a second camera at a fixed 45 degree vertical field of
view. The world runs wide so players can see flanks; a weapon drawn at that
same angle stretches into a fisheye.

## Performance

Budget: 60 fps on an iPhone 12 or Pixel 6, 30 fps floor on a 2020 mid-range
Android, under 150 draw calls, under 15 MB initial load.

Measured for Phase 0:

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 397 KB |
| Draw calls, whole level | 5 |
| Frame rate, software rasteriser in CI | 45 to 60 fps |

Every brush of a given surface kind is merged into one mesh, which is why the
entire level costs five draw calls. Quality tiers are picked from the GPU string
at boot and can be stepped down once by a three-second frame-time benchmark,
because the GPU string alone is an unreliable guide.

## Tuning

Every gameplay number lives in one of two files, and nothing is hard-coded at a
call site. Movement speeds, stance heights, look sensitivity, camera bob and the
joystick deadzone are in `src/sim/config.ts`. Everything a weapon has, from
damage to recoil pattern to the character of its firing sound, is in
`src/sim/weapons.ts`.
