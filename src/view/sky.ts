import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Look } from "../engine/look";
import type { QualitySettings } from "../engine/quality";
import type { MapStyle } from "../maps/types";
import { createNoiseField } from "./noise";
import { posterize } from "./retroBake";

/**
 * The sky, painted at load like everything else.
 *
 * A flat colour behind the level is the single clearest way a game says it is
 * a diagram of somewhere rather than somewhere. What a real sky has, and what
 * this builds, is: a gradient that darkens away from the horizon because
 * there is less air to look through overhead; haze piled up at the horizon
 * for the opposite reason; the sun where the shadows say it is, with the
 * glare around it that the air scatters; and a layer of cloud at a fixed
 * height, which is why clouds crowd together towards the horizon and stand
 * apart overhead.
 *
 * It is drawn into a cube map once, so none of the above costs anything per
 * frame afterwards.
 */

/** How high the cloud layer sits, in the same units as the projection below. */
const CLOUD_HEIGHT = 1;
/** How far across the sky one repeat of the cloud pattern runs. */
const CLOUD_SPAN = 220;

interface SkyColours {
  horizon: Color3;
  zenith: Color3;
  ground: Color3;
  sun: Color3;
}

/**
 * The palette, derived from the one colour a map gives for its sky.
 *
 * A map says what its sky looks like near the horizon, because that is the
 * part of it a player standing in a street can see. Everything else follows
 * from that: overhead is the same colour with more of the air taken out of
 * it, the ground half is the same again knocked back and drained, and the
 * sun is near enough white with the warmth left in.
 */
const coloursFor = (style: MapStyle): SkyColours => {
  const horizon = Color3.FromHexString(style.sky ?? "#8fb5d9");
  const zenith = new Color3(
    horizon.r * 0.42,
    horizon.g * 0.6,
    Math.min(1, horizon.b * 0.94),
  );
  const ground = new Color3(horizon.r * 0.5, horizon.g * 0.5, horizon.b * 0.48);
  const sun = new Color3(1, 0.96, 0.88);
  return { horizon, zenith, ground, sun };
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (edge0: number, edge1: number, v: number): number => {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Where the sun is, from where the light comes from.
 *
 * The key light points the way the light travels, so the sun is the other
 * way. Taking it from the same number the shadows use is the whole point:
 * the sun in the sky and the shadows on the ground agree, which is the first
 * thing the eye checks and the first thing a painted sky usually gets wrong.
 */
const sunDirection = (style: MapStyle): [number, number, number] => {
  const { x, y, z } = style.keyDirection;
  const length = Math.hypot(x, y, z) || 1;
  return [-x / length, -y / length, -z / length];
};

/**
 * Build one face of the cube.
 *
 * The face index follows the graphics convention the cube map expects:
 * +X, -X, +Y, -Y, +Z, -Z.
 */
const faceDirection = (
  face: number,
  u: number,
  v: number,
): [number, number, number] => {
  switch (face) {
    case 0:
      return [1, -v, -u];
    case 1:
      return [-1, -v, u];
    case 2:
      return [u, 1, v];
    case 3:
      return [u, -1, -v];
    case 4:
      return [u, -v, 1];
    default:
      return [-u, -v, -1];
  }
};

/** Paint the six faces of the sky. */
const paintFaces = (
  style: MapStyle,
  seed: number,
  size: number,
  clouds: boolean,
): ArrayBufferView[] => {
  const { horizon, zenith, ground, sun } = coloursFor(style);
  const [sx, sy, sz] = sunDirection(style);
  const cloudField = createNoiseField(seed ^ 0x1f83d9ab, CLOUD_SPAN);
  const faces: ArrayBufferView[] = [];

  for (let face = 0; face < 6; face += 1) {
    const data = new Uint8Array(size * size * 4);
    for (let py = 0; py < size; py += 1) {
      const v = ((py + 0.5) / size) * 2 - 1;
      for (let px = 0; px < size; px += 1) {
        const u = ((px + 0.5) / size) * 2 - 1;
        const [dx, dy, dz] = faceDirection(face, u, v);
        const length = Math.hypot(dx, dy, dz);
        const x = dx / length;
        const y = dy / length;
        const z = dz / length;

        // The gradient. Thick air at the horizon, thin overhead, and the
        // change is fast near the horizon and slow above it.
        const up = clamp01(y);
        const depth = 1 - Math.exp(-3.4 * up);
        let r = mix(horizon.r, zenith.r, depth);
        let g = mix(horizon.g, zenith.g, depth);
        let b = mix(horizon.b, zenith.b, depth);

        // Below the horizon there is no sky, only the haze over whatever is
        // down there. Visible past the edge of the level and nowhere else.
        if (y < 0) {
          const down = smoothstep(0, -0.28, y);
          r = mix(r, ground.r, down);
          g = mix(g, ground.g, down);
          b = mix(b, ground.b, down);
        }

        // The sun: a hard disc inside the glare the air scatters around it.
        const towardsSun = x * sx + y * sy + z * sz;
        if (towardsSun > 0) {
          const glare = towardsSun ** 26 * 0.55 + towardsSun ** 4 * 0.08;
          const disc = smoothstep(0.99965, 0.99987, towardsSun);
          const light = Math.min(1.6, glare + disc * 3.2);
          r = Math.min(1, r + sun.r * light);
          g = Math.min(1, g + sun.g * light);
          b = Math.min(1, b + sun.b * light);
        }

        // Cloud, on a layer at a fixed height. Looking along the layer puts
        // far more of it in front of you than looking up through it does,
        // which is why cloud gathers into a band at the horizon by itself.
        if (clouds && y > 0.015) {
          const reach = Math.min(90, CLOUD_HEIGHT / y);
          const cu = x * reach * 26;
          const cv = z * reach * 26;
          const shape = cloudField.fbm(cu, cv, 3, 6);
          const body = smoothstep(0.52, 0.78, shape);
          // Thinned out where the layer runs away to the horizon, so it
          // fades into haze rather than turning to mush.
          const cover = body * smoothstep(0.015, 0.2, y);
          if (cover > 0.002) {
            // A cloud is lit on the side the sun is on and grey underneath.
            const towardsLight = smoothstep(0.45, 0.95, shape);
            const lit = mix(0.58, 1.02, towardsLight) + Math.max(0, towardsSun) * 0.22;
            r = mix(r, Math.min(1, lit), cover);
            g = mix(g, Math.min(1, lit * 0.995), cover);
            b = mix(b, Math.min(1, lit * 0.99), cover);
          }
        }

        const i = (py * size + px) * 4;
        data[i] = r * 255;
        data[i + 1] = g * 255;
        data[i + 2] = b * 255;
        data[i + 3] = 255;
      }
    }
    faces.push(data);
  }
  return faces;
};

/**
 * Put a sky behind the level, or nothing at all for a map that is indoors.
 *
 * The box is drawn first and writes no depth, so whatever size it is it
 * never hides anything: the world is laid over the top of it. That is also
 * why it can be small enough to sit well inside the far plane, which is as
 * close as ninety metres on a phone.
 */
export const buildSky = (
  scene: Scene,
  style: MapStyle,
  quality: QualitySettings,
  seed: number,
  look: Look = "modern",
): Mesh | null => {
  if (!style.sky) return null;

  // The retro sky is a gradient, a sun and big soft clouds, at a size that
  // blurs into bands when it is stretched over the screen. Sixty-four
  // texels: enough for a cloud to be a shape rather than a smear, and the
  // skies of the era were mostly cloud shapes on a gradient.
  const retro = look === "retro";
  const size = retro ? 64 : quality.tier === "high" ? 256 : 128;
  const faces = paintFaces(style, seed, size, true);
  if (retro) for (const face of faces) posterize(face as Uint8Array, 14);
  const texture = new RawCubeTexture(
    scene,
    faces,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    !retro,
    false,
    retro ? Texture.BILINEAR_SAMPLINGMODE : Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.coordinatesMode = Texture.SKYBOX_MODE;
  texture.gammaSpace = true;

  const material = new StandardMaterial("mat_sky", scene);
  material.backFaceCulling = false;
  material.reflectionTexture = texture;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.disableLighting = true;
  // Never occludes: it lays down colour and leaves the depth buffer alone.
  material.disableDepthWrite = true;
  material.fogEnabled = false;
  material.freeze();

  const span = Math.min(quality.viewDistance, 200) * 0.8;
  const box = MeshBuilder.CreateBox("sky", { size: span }, scene);
  box.material = material;
  box.infiniteDistance = true;
  box.isPickable = false;
  box.alwaysSelectAsActiveMesh = true;
  box.applyFog = false;

  // Drawn before the world, because with no depth of its own it has to be.
  scene.setRenderingOrder(0, (a, b) => {
    const first = a.getMesh() === box ? 0 : 1;
    const second = b.getMesh() === box ? 0 : 1;
    return first - second;
  });

  return box;
};
