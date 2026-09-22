import type { QualitySettings } from "./quality";

/**
 * The look: which of two ways the same game is drawn.
 *
 * `modern` is the game as built: per-pixel lighting, cascaded shadows, a
 * grade, painted textures at a texel a centimetre. `retro` draws the same
 * level and the same soldiers the way a console of the late nineties would
 * have: a few hundred lines of resolution scaled up in whole pixels, flat
 * vertex lighting baked into the geometry, tiny textures blurred across the
 * walls, fog a short way out, and figures a few hundred polygons each.
 *
 * Nothing about play changes with it. The simulation, the hitboxes, the
 * server and the net code never learn which look a client is drawing.
 *
 * It is also the cheap mode by a wide margin, and deliberately so: every
 * choice that makes it look the part also takes work off the phone. A third
 * of the pixels, no shadow passes, no lit fragments on the level, a third
 * of the polygons on a figure.
 */
export type Look = "modern" | "retro";

export const isLook = (value: unknown): value is Look => value === "modern" || value === "retro";

export const RETRO = {
  /**
   * How many device-independent pixels tall the picture is rendered at.
   *
   * The hardware this is after drew two hundred and forty lines. On a phone
   * held at arm's length that is a shade too coarse to read a figure at
   * thirty metres, and two-seventy is where the look survives and the
   * figure does too.
   */
  internalHeight: 270,
  /**
   * How far the world is drawn before the fog takes it, in metres. Short,
   * because that is what the look is, and because the backdrop past the
   * level stands within a hundred and twenty and still has to be there.
   */
  viewDistance: 150,
  /**
   * How much colour is pushed back into the baked light.
   *
   * The modern grade washed the level out on purpose, so that two coloured
   * figures would read against it. The era this look is after did the
   * opposite: bold, warm, painterly colour everywhere, and the figures
   * read by being bolder still.
   */
  saturation: 1.3,
} as const;

/**
 * The quality settings a look actually renders with.
 *
 * Retro overrides the parts of a tier that its own rules decide — no shadow
 * map ever, a short view — and leaves the rest to the tier the device was
 * given, so a strong phone in retro still gets its anisotropy and a weak
 * one still gets its fog.
 */
export const presentationFor = (quality: QualitySettings, look: Look): QualitySettings =>
  look === "retro"
    ? {
        ...quality,
        shadows: false,
        viewDistance: Math.min(quality.viewDistance, RETRO.viewDistance),
      }
    : quality;

/**
 * The engine's hardware scaling level: how many device pixels each rendered
 * pixel is stretched over.
 *
 * Modern renders at the device's own ratio up to the tier's ceiling. Retro
 * ignores the device entirely and works back from the height of the
 * picture it wants: however tall the canvas is, the picture is the same few
 * hundred lines, so a phone and a monitor get the same look and the same
 * bill.
 */
export const scalingLevelFor = (
  look: Look,
  quality: QualitySettings,
  devicePixelRatio: number,
  canvasCssHeight: number,
): number => {
  if (look === "retro") {
    const height = Math.max(1, canvasCssHeight);
    // Never sharper than one rendered pixel per css pixel: below a certain
    // window height the look would otherwise be upscaling nothing.
    return Math.max(1, (height * devicePixelRatio) / RETRO.internalHeight / devicePixelRatio);
  }
  const ratio = Math.min(devicePixelRatio || 1, quality.maxPixelRatio);
  return 1 / ratio;
};
