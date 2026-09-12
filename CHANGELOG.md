# Changelog

## Phase 4 — art, a second map, progression

The prototype stops looking like a greybox. Every surface is textured, there
are two levels to play, and rounds now pay into a levelling track that hands
over weapons early and colours thereafter.

**Added**

- Procedural textures generated at load: concrete, wall panelling, timber
  crates, brushed metal, catwalk grating and hazard paint, all from noise and
  simple shapes. The download carries no art at all.
- Per-brush UV scaling, so texel density is even across a forty metre floor and
  a one metre crate rather than stretching one to cover the other.
- Per-map palettes and light levels, which is how a level changes its whole
  look without a brush moving.
- Substation, a second map: a grid of transformer blocks that breaks every lane
  into short lanes, with one raised gantry that trades cover for vision.
- A map registry and a lobby picker. Swapping levels rebuilds the scene, the
  collision world and the navigation grid between rounds.
- Progression: experience from kills, headshots, rounds played, wins and how
  close the round was, with the submachine gun at level 3 and the shotgun at 6.
- Seven weapon finishes, unlocked by level. A finish carries three colours and
  a name, and a test asserts it can carry nothing else.
- An entitlement seam: one interface, one shipped implementation that grants
  only what a profile already records. No purchase path, no currency, no
  prompt.
- Career panel in the lobby and an itemised experience breakdown on the
  scoreboard.
- 57 further unit tests.

**Changed**

- Online matches are not gated by level. The server hands everyone the full
  rack, since progression that becomes an advantage over other players is not
  worth balancing.
- Substation was rebuilt brighter after the first pass. The original palette
  was atmospheric and unplayable: a player standing in a corner simply was not
  visible.

**Fixed**

- The wall texture repeated tightly enough to read as bathroom tile. Softened
  the seams and widened the repeat.
- The "next unlock" line went blank for twenty levels once the weapon rack was
  complete; it now falls through to the next finish.
- Two map surfaces were forced through casts to kinds that did not exist, which
  would have left them without materials at runtime.

**Measured**

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 409 KB |
| Downloaded art | none |
| Navigation bake | 30 to 45 ms |
| Maps | 2 |

## Phase 3 — authoritative server, prediction, lag compensation

The game is playable against other people. An authoritative server owns the
match, clients predict their own movement and reconcile against it, and shots
are judged against the world as the shooter's screen actually showed it.

**Added**

- Analytic collision and hitscan in plain TypeScript, against the level's
  oriented boxes. One implementation now serves the client's prediction, the
  server's authority, and the navigation bake.
- Authoritative server on Node and `ws`, running the shared simulation at
  30 Hz, filling empty slots with bots, and sending each client a snapshot per
  tick. Configurable by environment variable, and bundled to 79 KB.
- Client prediction with reconciliation: each snapshot acknowledges the last
  input applied, and the client replays everything the server had not yet seen.
  Residual error is carried as a decaying visual offset rather than a jolt.
- Lag compensation: the server keeps a short position history and rewinds
  everyone by half the round trip plus the interpolation delay, capped at
  200 ms, before resolving a shot.
- Remote players interpolated a hundred milliseconds in the past, between the
  two snapshots bracketing that moment.
- Free-for-all alongside team deathmatch, with hostility decided by mode rather
  than by comparing team letters.
- Lobby support for online play: a server address, a callsign, and a live
  readout of round trip, interpolation delay and player count.
- 27 further unit tests and 6 further browser tests, the latter running two
  clients against a real server.

**Changed**

- The navigation bake no longer needs the renderer, so the server builds the
  same grid the client does. It also got about seven times faster.
- The Babylon collision coordinator and ray picking are gone, which is why the
  bundle shrank despite everything added.

**Fixed**

- Ray-against-box returned an inverted entry normal, so every floor faced
  downward. Nothing was walkable and the navigation bake produced no nodes at
  all.
- The capsule resolver applied a full push for each of its five sample spheres
  from stale positions, over-correcting badly enough to throw a player backward
  through the space they had just crossed.
- Bots could strand on desk tops and crate lids: perfectly walkable surfaces
  that nothing links to, because the climb exceeds the step limit. Unreachable
  islands are now pruned from the navigation grid.

**Measured**

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 403 KB |
| Server bundle | 79 KB |
| Navigation bake | about 30 ms |
| Snapshot size, four players | about 800 bytes |
| Server tick rate | 30 Hz |

## Phase 2 — bots, team deathmatch, match flow

The prototype is now a game you can finish. Team deathmatch against bots that
navigate the level, take cover and shoot back, wrapped in a lobby, a round and
a scoreboard, and installable to a phone home screen.

**Added**

- Layered navigation grid baked from the level at load: about 4,700 walkable
  nodes for a 40 metre map in under 200 milliseconds, with the mezzanine and
  the floor beneath it as separate layers. A* pathfinding lives in the
  simulation and runs on plain arrays.
- Bots with patrol, investigate, engage and break-contact behaviour. They see
  through a vision cone with a real line-of-sight test, so cover works against
  them, and their aim error grows with how fast the target is moving.
- Three difficulty tiers that differ in reaction time, aim error, turn rate and
  view distance, from 800 milliseconds and 6 degrees down to 250 and 1.5.
- Bots run the player's weapon state machine, so they obey the same fire rates,
  magazines, reload times and recoil.
- Team deathmatch: six minute rounds, first to 50, four second respawns, spawn
  selection that picks the point furthest from living enemies, and team kills
  that cost a point rather than earning one.
- Match HUD with a score bar, round clock, countdown and kill feed, plus a
  downed overlay while waiting to respawn.
- Lobby, settings and scoreboard screens. Settings persist to local storage and
  cover look sensitivity, gyroscope aim, inverted look, field of view, HUD
  scale, sound and a quality override.
- Installable as a progressive web app, playable offline after the first visit.
- Invisible player hitboxes, so a bot shooting the player runs exactly the code
  a player shooting a bot runs.
- 70 further unit tests and 8 further browser tests.

**Fixed**

- Bots walked on the roof. The navigation rays started above the building, so
  the first surface they found was the ceiling, and the top of it was duly
  marked as walkable ground.
- Every shooter was blind to the world and to itself. Rays start at the eye,
  which sits inside the shooter's own head hitbox, so every line-of-sight test
  and every shot hit the shooter first and stopped there. Bots could never see
  an enemy, and the player's own shots would have been swallowed by their own
  head the moment hitboxes were introduced.
- Each bot cost eight draw calls. Body parts are now merged into one mesh, with
  the head kept separate because it needs its own hitbox for headshots.

**Measured**

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 407 KB |
| Draw calls, empty level | 5 |
| Draw calls per bot | 3 |
| Navigation bake, at load | under 200 ms |
| Frame rate, software rasteriser in CI | 34 to 60 fps |

## Phase 1 — weapons, viewmodel, shooting

The prototype is now a shooter. Four weapons, a first-person viewmodel, hitscan
fire against practice targets, a combat HUD, and weapon audio synthesised at
runtime.

**Added**

- Four original weapons in `src/sim/weapons.ts`: an assault rifle, a submachine
  gun, a pump shotgun and a sidearm. Damage is derived from the lethality
  target rather than picked by feel, and unit tests assert the design rules
  against every weapon, so a retune that breaks them fails the build.
- Ballistics: range falloff, headshot multipliers, movement and stance spread,
  firing bloom, and fixed per-shot recoil patterns that can be learned.
- Weapon state machine covering automatic, semi-automatic and pump actions,
  magazine and per-shell reloads, weapon swapping, and the sprint-out delay.
- Hitscan resolution behind a `HitscanWorld` interface, so the simulation stays
  free of engine types. Scatter comes from a seeded generator, making any shot
  reproducible from its seed.
- First-person viewmodel drawn by a second camera at a fixed 45 degree vertical
  field of view, with procedural sway, bob, sprint and reload poses, an aimed
  pose that lines the weapon's own sight up with screen centre, and recoil kick.
- Six practice targets: a body plate and a head plate on a post, which fold back
  when knocked down and stand up again after three seconds.
- Shot effects: pooled tracers and impact marks, plus a muzzle flash on the
  weapon itself. Nothing is allocated per shot.
- Weapon audio synthesised from noise and oscillators, with no sample files. Each
  weapon's crack, body and room tail are tuned as numbers beside its damage.
- Combat HUD: ammunition, health with a damage vignette, weapon name, a
  crosshair driven by the same spread the bullets use, hit markers that
  distinguish headshots, and a damage feed.
- Player health with delayed regeneration, ready for Phase 2.
- 99 further unit tests and 14 further browser tests.

**Changed**

- Crouch and lean came off the touch layout, which now carries fire, aim, reload
  and swap. Both remain in the simulation and on the keyboard.
- The submachine gun went from 26 to 35 damage. At 26 it needed four body shots,
  breaking the design rule of three or fewer.

**Fixed**

- Vertical look was inverted. Screen coordinates grow downward, so a drag up
  gives a negative delta, and adding that to pitch unchanged aimed the camera
  the wrong way.
- `setPointerCapture` throws for a pointer the browser no longer considers
  active, which aborted the pointer-down handler and dropped the touch entirely.
- Firing bloom was inert on every weapon, because recovery was faster than any
  weapon could accumulate it.
- The weapon viewmodel was invisible, then enormous. Three separate causes: it
  was parented to the camera, whose world matrix is not the frame the offsets
  were written in; its field of view was converted from a horizontal figure,
  which on a wide phone screen gave a very narrow vertical angle; and its stock
  sat level with the eye, where perspective blew the near end up until it
  covered the screen.
- The mesh readout under-reported the scene, because `getActiveMeshes` returns
  only the camera rendered last, which is the weapon camera.

**Measured**

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 397 KB |
| Draw calls, whole level | 5 |
| Frame rate, software rasteriser in CI | 45 to 60 fps |

## Phase 0 — boot, greybox, movement

First playable build. The player can walk, sprint, crouch and lean around a
greybox warehouse on a phone, with touch controls, at the target frame rate.

**Added**

- Babylon.js 9 renderer on WebGL2, with a Vite and TypeScript project.
- Engine-independent simulation layer in `src/sim`, reached from the view
  through a `CollisionWorld` interface.
- Fixed 60 Hz simulation step with render interpolation, and a catch-up cap so
  a backgrounded tab cannot stall the page on return.
- Character controller: walk, sprint, crouch, lean, directional speed limits,
  sprint-out timer, head bob, and a landing dip scaled by impact speed.
- Touch controls: a floating movement stick on the left half, drag-to-look on
  the right half, and repositionable crouch and lean buttons. Pointer Events
  throughout, so three simultaneous contacts track correctly.
- Keyboard and mouse input with pointer lock, for development.
- Optional gyroscope aim, off by default, blended through the same sensitivity
  model as touch.
- Greybox warehouse: office rooms, an open floor with crate cover and pillars,
  a mezzanine reached by two ramps, and a loading bay. Defined as data.
- Quality tiers chosen from the GPU string, with a three-second frame-time
  benchmark that can demote once.
- Phase 0 HUD: crosshair with movement-driven spread, stance readout, and a
  debug line.
- 63 unit tests and 9 browser tests across desktop and phone viewports.

**Fixed during the phase**

- Sprinting was allowed while pushing the stick straight backwards. Clamping
  the forward component before `atan2` discarded its sign, so a full backpedal
  measured as zero degrees off forward.
- Mali T-series and Adreno 1xx to 4xx parts were not recognised as low-end, so
  old phones were given the medium tier.
- A resting player reported as airborne. The swept collider comes to rest a
  hair above the floor, leaving the next step's fall unobstructed; the
  controller now holds a small downward speed while grounded.
- Unlit surfaces rendered black because materials had no ambient response.
- Spawn points faced the nearest wall rather than the middle of the map.

**Measured**

| Metric | Value |
| --- | --- |
| Bundle, gzipped | 386 KB |
| Draw calls | 5 |
| Frame rate, software rasteriser in CI | 54 to 60 fps |
