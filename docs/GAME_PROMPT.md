# Shootout — build prompt

Paste everything under "Prompt" into Claude Code (or any coding agent) in this repo.
The engine decision and its trade-offs are recorded at the bottom.

---

## Prompt

You are a senior game engineer. Build **Shootout**, a mobile-first tactical first-person shooter, in this repo. Work in small, verifiable increments. Each phase must run on a real phone before you move to the next.

### Goal
A first-person shooter with the gameplay feel of *Bodycam* (grounded, lethal, tense, realistic gunplay, small close-quarters maps) but the presentation of *Call of Duty: Mobile* (eye-height first-person camera, weapon viewmodel, full HUD, touch controls).

No bodycam camera treatment: no fisheye lens, no chest-height camera, no timestamp overlay, no VHS noise, no heavy motion blur.

Do not use any Bodycam or Call of Duty assets, names, maps, logos, or trademarks. Original or CC0 assets only.

### Tech stack (fixed)
- TypeScript, Vite, three.js (latest), WebGL2 renderer. WebGPU behind a feature flag.
- Physics and collision: Rapier (`@dimforge/rapier3d-compat`) for the character controller and hit raycasts.
- Audio: Web Audio API, positional audio through three.js `PositionalAudio`.
- Assets: glTF/GLB with Meshopt compression, KTX2 textures.
- HUD: DOM + CSS overlaid on the canvas. No React. Plain TypeScript modules.
- Packaging: PWA (installable, fullscreen, landscape lock, offline cache). Capacitor wrapper for app stores later.
- Tests: Vitest for pure logic (weapon math, ballistics, input mapping). Playwright smoke test that the game boots and renders a frame.

### Target devices and performance budget
- 60 fps on iPhone 12 / Pixel 6 class. 30 fps floor on 2020 mid-range Android.
- Per frame: ≤ 150 draw calls, ≤ 300k triangles on screen. Texture memory ≤ 256 MB.
- Lighting: baked lightmaps plus light probes. One directional light plus ambient. No real-time shadows on the mobile tier.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`. SMAA or no anti-aliasing.
- Quality tiers Low / Medium / High, auto-detected from the GPU string plus a 3-second benchmark, user-overridable in settings.
- Initial load ≤ 15 MB. Lazy-load maps and weapons.

### Camera and presentation (COD Mobile style)
- First-person camera at 1.65 m eye height. FOV 70–90, user-adjustable. ADS narrows FOV per weapon.
- Weapon viewmodel rendered by a second camera on its own layer with a fixed FOV (~55) so it does not distort at wide world FOV. Second render pass with `autoClear = false` and a depth clear.
- Procedural viewmodel animation: idle sway, walk bob, sprint pose, ADS transition, recoil kick. Reload is an animated GLB clip.
- Subtle feedback only: light camera shake on shots and explosions. Motion blur off by default. No chromatic aberration.
- Hit markers, damage direction indicator, red vignette at low health.

### Gameplay feel (Bodycam-inspired)
- High lethality: 1–3 body shots kill, 1 headshot kills. Time-to-kill 100–300 ms.
- Grounded movement: walk 4 m/s, sprint 6.5 m/s. No slide, no jump-shooting, no bunny hop. Crouch and lean.
- Sprint-out delay of ~250 ms before ADS or fire.
- Per-weapon recoil patterns (array of 2D offsets), first-shot accuracy, bloom while moving.
- Hitscan with client prediction for the MVP. Projectile bullets with drop behind a flag.
- Sound is a core mechanic: loud footsteps, distinct per-weapon reload and fire sounds, simple occlusion (muffle when a raycast to the source hits a wall).
- MVP weapons: one assault rifle, one SMG, one shotgun, one pistol. Each defines damage, RPM, magazine size, reload time, ADS time, recoil pattern, spread, and range falloff.
- Health 100. No regen for 5 s after damage, then slow regen. All values tunable.

### Touch controls (COD Mobile layout)
- Left half of screen: floating virtual joystick that appears where the thumb lands. Push past a threshold to sprint.
- Right half of screen: drag anywhere to look. Separate hip and ADS sensitivity. Optional gyroscope aim (DeviceOrientation) blended with touch.
- Buttons, all repositionable and resizable, layout saved to localStorage: fire (left and right copies), ADS, reload, crouch, mantle, weapon swap, lean left/right.
- Auto-fire option: fires when the crosshair is over an enemy while in ADS.
- Simple mode: tapping fire does ADS + fire.
- Must handle 3 simultaneous touches (move + look + fire) with correct pointer id tracking. Use Pointer Events, not Touch Events. Call `preventDefault` to stop scroll and zoom.
- Keyboard and mouse also work on desktop for development.

### HUD
- Dynamic-spread crosshair, ammo (magazine / reserve), health bar, minimap (top-left, rotates with the player, shows teammates and enemies who are firing), kill feed, match timer and score, compass strip.
- HUD scale setting. Respect safe-area insets for notches.

### Maps
- MVP: one close-quarters map, roughly 40 × 40 m (abandoned office or warehouse). Greybox first, art later.
- Level format: one GLB. Collision meshes prefixed `col_`. Spawn points named `spawn_a_*` and `spawn_b_*`. Lightmap on UV2.
- Write `tools/bake-lightmap.md` describing the Blender bake workflow.

### AI (before multiplayer)
- Bots on a navmesh (`recast-navigation-js` or `three-pathfinding`). States: patrol, investigate sound, engage, take cover, reload.
- Difficulty tiers change reaction time (250–800 ms) and accuracy.

### Multiplayer (Phase 3: design now, build later)
- Authoritative Node server (Colyseus, or plain WebSocket plus geckos.io for WebRTC data channels). 30 Hz tick.
- Client prediction and reconciliation for movement. Server-side hit validation with lag compensation (rewind up to 200 ms).
- Modes: Team Deathmatch 5v5 and Free-for-all. 6-minute rounds.
- Keep simulation code engine-agnostic (pure TypeScript, no three.js imports) so the same code runs on the server.

### Architecture
```
src/
  main.ts        boot, quality detection, game loop
  engine/        renderer, loop, asset loader, audio
  input/         joystick, look, buttons, gyro, keyboard
  sim/           pure gameplay: player, weapons, ballistics, health (no three.js)
  view/          three.js presentation of sim state, viewmodel, effects
  ai/            bots, navmesh
  hud/           DOM HUD
  net/           (Phase 3) prediction, messages
  maps/          map manifests
assets/
tests/
```
Fixed 60 Hz simulation step, rendering interpolates between steps. The sim never touches the DOM or three.js.

### Phases and acceptance criteria
- **Phase 0**: Vite + three.js boot, greybox map, walk around with touch controls on a real phone at 60 fps. Deployed to a URL.
- **Phase 1**: Weapons, viewmodel, shooting targets, HUD, sounds. Vitest coverage for weapon math.
- **Phase 2**: Bots, Team Deathmatch versus bots, match flow (lobby → match → scoreboard), settings screen, PWA install.
- **Phase 3**: Multiplayer server, 5v5 on LAN, then hosted.
- **Phase 4**: Art pass, second map, progression (XP, unlocks), cosmetic-only monetization hooks.

After each phase: run `npm run lint && npm run test && npm run build`, test on a phone through the deployed URL, and add a CHANGELOG entry with measured fps and bundle size.

### Rules
- Simple, readable code. No premature abstraction.
- Every tunable (speeds, damage, sensitivity, timings) lives in `src/sim/config.ts`, never inline.
- Never block the main thread for more than 4 ms. Stream assets. Move navmesh and physics to Web Workers if needed.
- Ask before adding any dependency over 200 KB gzipped.
- Commit after each working increment with a clear message.

---

## Engine decision

**Chosen: three.js in the browser, shipped as a PWA.** Reason: fastest path to a playable prototype on a phone, instant distribution by URL, no app store review, and it is the stack a coding agent iterates on best.

What you give up versus a native engine:
- Fidelity. Bodycam's look comes from Unreal Engine 5 (Lumen, Nanite, photogrammetry). No browser stack reaches that on a phone. Aim for clean, baked-lit realism, not photorealism.
- Mobile FPS tooling. Unity ships a touch input package, netcode, and thousands of FPS assets. Here you build joystick, viewmodel rendering, and netcode yourself.
- Thermal and battery headroom. WebGL on iOS Safari throttles harder than a native app.

Alternatives, in order of preference if requirements change:
1. **Unity (URP)** if the goal is a real App Store product competing with COD Mobile. COD Mobile itself is Unity. Highest ceiling, worst fit for an agent-driven workflow.
2. **Babylon.js** if you stay in the browser but want batteries included (physics, GUI, WebGPU, asset pipeline). Slightly heavier bundle than three.js.
3. **PlayCanvas** if you want a visual editor plus a mobile-optimized WebGL engine. Editor is hosted and partially closed.
4. **Godot 4** if you want open source and a native build without Unity licensing. Mobile renderer is weaker than Unity's.
5. **Unreal Engine 5 mobile** only with a team and budget. Closest to the Bodycam look, heaviest pipeline.

Rule of thumb: prototype and validate the feel in three.js. If it is fun and you want stores, port the pure-TypeScript `sim/` design to Unity C#.
