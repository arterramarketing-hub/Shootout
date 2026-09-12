# Changelog

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
