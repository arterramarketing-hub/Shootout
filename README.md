# Shootout

A mobile-first tactical first-person shooter. Grounded, lethal gunplay with the
presentation of a modern mobile shooter: eye-height first-person camera, weapon
viewmodel, touch controls. No body-worn-camera treatment — no fisheye, no chest
mount, no timestamp overlay, no VHS grain.

All art and geometry in this repository is original. No third-party game assets,
names, maps, or trademarks are used.

## Status

**Phase 4 complete.** Two maps with generated art, levelling with weapon and
finish unlocks, on top of the authoritative server from Phase 3.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Boot, greybox map, touch movement, deployed URL | Done |
| 1 | Weapons, viewmodel, shooting, HUD, sound | Done |
| 2 | Bots, team deathmatch, match flow, PWA install | Done |
| 3 | Authoritative multiplayer server, 5v5 | Done |
| 4 | Art pass, second map, progression | Done |

## Stack

| Concern | Choice |
| --- | --- |
| Renderer | Babylon.js 9, WebGL2 |
| Language | TypeScript, strict |
| Bundler | Vite |
| Collision | Analytic capsule against oriented boxes, shared by both sides |
| Navigation | Layered grid baked from the level, A* in the simulation |
| Server | Node and `ws`, authoritative at 30 Hz |
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

npm run server     # authoritative server on port 8080
npm run build:server
```

Environment variables for the server: `PORT`, `MODE` (`tdm` or `ffa`),
`TEAM_SIZE`, `DIFFICULTY`, `ROUND_SECONDS`, `SCORE_LIMIT`.

To test on a phone, run `npm run dev` and open the network address it prints on a
device on the same network.

## Playing it

Every push to the default branch runs lint, tests and the build, and publishes
`dist/` to GitHub Pages:

<https://arterramarketing-hub.github.io/Shootout/>

Share that link with anyone you want to playtest with; it opens on a phone
browser and installs to the home screen from the browser's share menu. There is
no sign-in and nothing to download.

Pages has to be switched on once, by hand, by someone with admin rights on the
repository: **Settings -> Pages -> Build and deployment -> Source -> GitHub
Actions**. The workflow cannot do this for you. Its token is refused with
"Resource not accessible by integration", so until the setting is made the
deploy step fails with `Get Pages site failed: Not Found` and there is no site.
After switching it on, re-run the workflow from the Actions tab.

The published build is the single-player game against bots. The authoritative
server is a separate Node process and is not part of the Pages deploy; online
matches need it running somewhere reachable.

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

## Art

Every texture is drawn at load rather than downloaded: concrete, wall panelling,
timber crates, brushed metal, catwalk grating and hazard paint, all generated
from noise and simple shapes. The download therefore carries zero bytes of art,
and a map changes its entire look by passing different colours through the same
generators.

Texel density is held even by scaling each brush's UVs to its real size. Without
that, a forty metre floor and a one metre crate both get a single tile, and the
level reads as stretched plastic.

## Maps

| Map | Plays like |
| --- | --- |
| Warehouse | Open floor, crate cover, a mezzanine that owns the long angles |
| Substation | Transformer blocks break every lane; the gantry sees everything |

Each carries its own palette and light levels. Substation is cool and
industrial, but deliberately not dark: a player standing still in a corner has
to stay visible, and atmosphere is worth less than that.

## Progression

Experience comes from kills, headshots, seeing a round out, winning, and how
close the round was. Levelling hands over the submachine gun at 3 and the
shotgun at 6, so a new player has two weapons to learn rather than four.

Everything after that is a finish: three colours on the weapon viewmodel and
nothing else. There is no finish that shoots straighter, holds more rounds or
reloads faster. A unit test asserts that a finish carries only colours and a
name, so nothing that could affect a match can be added to one by accident.

Online matches are not gated at all. The server hands everyone the full rack,
because progression that turns into an advantage over other players is not
worth balancing.

The entitlement seam exists as an interface with one shipped implementation
that grants only what a profile already records. There is no purchase path, no
currency and no prompt, and anything plugged into that seam can still only
unlock a set of colours.

## Multiplayer

The server owns the game. It runs the same simulation the client does, at
30 Hz, decides all damage, and sends every client a snapshot of the world each
tick. Clients send input, not outcomes.

Three pieces make that playable over a real connection.

**Prediction.** The client applies its own input immediately rather than
waiting a round trip, so the controls answer at once.

**Reconciliation.** Each snapshot carries the sequence number of the last input
the server applied. The client resets to the authoritative state and replays
everything the server had not yet seen, which brings that state back up to the
present. Whatever remains is genuine prediction error, and it is carried as a
visual offset that decays rather than a jolt.

**Lag compensation.** A player fires at what their screen shows, which is
already a hundred milliseconds old. The server keeps a short history of where
everyone was and rewinds them by half the round trip plus the interpolation
delay, capped at 200 ms, so it judges the shot the shooter actually took.

Remote players are drawn slightly in the past, interpolated between the two
snapshots that bracket that moment, because the alternative is guessing where
someone went and being wrong every time they change direction.

Both sides run one collision implementation, in plain TypeScript, against the
level's oriented boxes. This is the reason prediction lands on the server's
answer instead of near it: two implementations, however carefully written,
disagree somewhere, and every disagreement surfaces as the player being yanked
backwards.

Snapshots are JSON with coordinates rounded to the centimetre. At four players
that is about 800 bytes a tick, or 24 KB a second. A packed binary format would
cut that substantially and is the obvious next optimisation; being able to read
a capture has been worth more so far.

## Architecture

```
src/
  sim/      pure gameplay. No Babylon imports, so it can run on a server.
  view/     Babylon presentation of simulation state
  input/    pointer, keyboard and gyroscope handling
  net/      protocol, client prediction, lag-compensation history
  engine/   render loop, quality tiers, audio synthesis, settings
  hud/      DOM overlay
  maps/     level definitions and their palettes, as data
server/     authoritative game server
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

Measured at Phase 4:

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 409 KB |
| Server bundle | 79 KB |
| Draw calls, empty level | 5 |
| Navigation bake, at load | 30 to 45 ms |
| Downloaded art | none; every texture is generated |
| Snapshot size, four players | about 800 bytes |
| Frame rate, software rasteriser in CI | 30 to 60 fps |

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
