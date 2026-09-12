# Shootout

A mobile-first tactical first-person shooter. Grounded, lethal gunplay with the
presentation of a modern mobile shooter: eye-height first-person camera, weapon
viewmodel, touch controls. No body-worn-camera treatment — no fisheye, no chest
mount, no timestamp overlay, no VHS grain.

All art and geometry in this repository is original. No third-party game assets,
names, maps, or trademarks are used.

## Status

**Phase 2 complete.** Team deathmatch against navmesh bots, with match flow,
a settings screen, and installable offline play.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Boot, greybox map, touch movement, deployed URL | Done |
| 1 | Weapons, viewmodel, shooting, HUD, sound | Done |
| 2 | Bots, team deathmatch, match flow, PWA install | Done |
| 3 | Authoritative multiplayer server, 5v5 | Planned |
| 4 | Art pass, second map, progression | Planned |

## Stack

| Concern | Choice |
| --- | --- |
| Renderer | Babylon.js 9, WebGL2 |
| Language | TypeScript, strict |
| Bundler | Vite |
| Collision | Babylon swept-ellipsoid collider |
| Navigation | Layered grid baked from the level, A* in the simulation |
| Audio | Web Audio, synthesised at runtime, no samples |
| Offline | Service worker, runtime cache |
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

## Bots

Three difficulty tiers, which differ in the things that actually decide a
gunfight rather than in raw damage.

| Tier | Reaction | Aim error | Turn rate | View |
| --- | --- | --- | --- | --- |
| Recruit | 800 ms | 6.0 deg | 2.2 rad/s | 32 m |
| Regular | 500 ms | 3.2 deg | 3.6 rad/s | 45 m |
| Veteran | 250 ms | 1.5 deg | 5.4 rad/s | 60 m |

Bots patrol, investigate where an enemy was last seen, engage, and break
contact to reload or when badly hurt. They see through a vision cone with a
real line-of-sight test, so cover works against them. Aim error grows with how
fast the target is moving, so sprinting is genuinely harder to track.

They run the same weapon state machine the player does, which means the same
fire rates, magazines, reload times and recoil. Letting bots fire outside those
rules is the quickest way to make a shooter feel unfair.

Navigation is a layered grid baked from the level at load, about 4,700 walkable
nodes for a 40 metre map, built in under 200 ms. A grid rather than a navmesh
library for three reasons: the level is boxes on a floor with one raised deck,
which a grid represents exactly; the simulation has to run on the authoritative
server in Phase 3, and plain arrays travel far more easily than a wasm navmesh;
and the megabyte a navmesh library costs buys nothing here. Layers are what let
the mezzanine and the floor beneath it coexist.

## Match flow

Team deathmatch. Six minute rounds, first to 50 kills, four second respawns.
Lobby sets difficulty and team size, the round plays, and a scoreboard reports
kills, deaths, headshots and ratio.

Settings persist to local storage and cover look sensitivity for touch and
mouse separately, gyroscope aim, inverted look, field of view, HUD scale,
sound, and a quality override. Every field is validated against its own limits
on load, because storage can be empty, stale, or throw outright.

The game installs as a progressive web app and runs offline after the first
visit. The service worker caches at runtime rather than from a build manifest,
since the bundler hashes asset names on every build and a stale list is worse
than no list.

## Architecture

```
src/
  sim/      pure gameplay. No Babylon imports, so it can run on a server.
  view/     Babylon presentation of simulation state
  input/    pointer, keyboard and gyroscope handling
  engine/   render loop, quality tiers, audio synthesis, settings
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

Bots and the player resolve shots through one hitscan path. The player carries
invisible hitboxes so that a bot shooting them runs exactly the code a player
shooting a bot runs. A separate "did the bot hit the player" test would
inevitably drift from the real one.

## Performance

Budget: 60 fps on an iPhone 12 or Pixel 6, 30 fps floor on a 2020 mid-range
Android, under 150 draw calls, under 15 MB initial load.

Measured for Phase 0:

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 407 KB |
| Draw calls, empty level | 5 |
| Navigation bake, at load | under 200 ms |
| Frame rate, software rasteriser in CI | 34 to 60 fps |

Every brush of a given surface kind is merged into one mesh, which is why the
empty level costs five draw calls. Each bot costs three more: one merged body,
a head that needs its own hitbox for headshots, and a weapon. Quality tiers are picked from the GPU string
at boot and can be stepped down once by a three-second frame-time benchmark,
because the GPU string alone is an unreliable guide.

## Tuning

Every gameplay number lives in one of two files, and nothing is hard-coded at a
call site. Movement speeds, stance heights, look sensitivity, camera bob and the
joystick deadzone are in `src/sim/config.ts`. Everything a weapon has, from
damage to recoil pattern to the character of its firing sound, is in
`src/sim/weapons.ts`.
