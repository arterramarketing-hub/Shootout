# Changelog

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
