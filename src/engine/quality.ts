export type QualityTier = "low" | "medium" | "high";

export interface QualitySettings {
  tier: QualityTier;
  /** Upper bound on device pixel ratio. The single biggest mobile fps lever. */
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  fog: boolean;
  /**
   * Metres beyond which geometry is culled, and where the fog ends.
   *
   * It has to clear the backdrop outside the level, not just the level: a
   * phone that can only see ninety metres looks down the street at haze and
   * a clip plane, which is what a view distance tuned to a sixty-metre map
   * gives you. The backdrop's silhouettes stand within a hundred and twenty,
   * so every tier reaches them.
   */
  viewDistance: number;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  low: { tier: "low", maxPixelRatio: 1.0, antialias: false, shadows: false, fog: true, viewDistance: 160 },
  medium: { tier: "medium", maxPixelRatio: 1.25, antialias: false, shadows: false, fog: true, viewDistance: 190 },
  high: { tier: "high", maxPixelRatio: 1.5, antialias: true, shadows: true, fog: true, viewDistance: 220 },
};

export const settingsFor = (tier: QualityTier): QualitySettings => ({ ...TIERS[tier] });

/**
 * First guess from the GPU string. This is a heuristic and it is often wrong,
 * which is why the runtime benchmark below can still demote the tier.
 */
export const guessTier = (renderer: string, isMobile: boolean): QualityTier => {
  const gpu = renderer.toLowerCase();
  // Software rasterisers, the whole Mali T series, entry-level Mali G parts,
  // and Adreno 1xx-5xx. All of these predate the performance this game needs.
  const weak =
    /swiftshader|llvmpipe|powervr|videocore|mali-t\d+|mali-g(3\d|5[12])\b|adreno \(tm\) [1-5]\d\d\b/;
  if (weak.test(gpu)) return "low";
  if (!isMobile) return "high";
  const strong = /apple (a1[2-9]|a[2-9]\d|m[1-9])|adreno \(tm\) (6[5-9]\d|7\d\d|8\d\d)|mali-g(7[0-9]|[89]\d)/;
  if (strong.test(gpu)) return "high";
  return "medium";
};

export const readRendererString = (): string => {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "unknown";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const value = info
      ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string);
    return value ?? "unknown";
  } catch {
    return "unknown";
  }
};

export const isMobileDevice = (): boolean =>
  window.matchMedia("(pointer: coarse)").matches ||
  /android|iphone|ipad|ipod/i.test(navigator.userAgent);

export const detectQuality = (): QualitySettings => {
  const renderer = readRendererString();
  const tier = guessTier(renderer, isMobileDevice());
  return settingsFor(tier);
};

const LOWER: Record<QualityTier, QualityTier | null> = { high: "medium", medium: "low", low: null };

/**
 * Watches frame times for a few seconds after boot and steps the tier down if
 * the device cannot hold the target. Runs once, then stops costing anything.
 */
export class QualityBenchmark {
  private samples: number[] = [];
  private elapsed = 0;
  private finished = false;

  constructor(
    private readonly durationSeconds = 3,
    private readonly targetFps = 50,
    /** Ignore the first moments, where shader compilation dominates. */
    private readonly warmupSeconds = 1,
  ) {}

  get isFinished(): boolean {
    return this.finished;
  }

  /** Returns a demoted tier once, when the verdict is in. */
  update(deltaSeconds: number, current: QualityTier): QualityTier | null {
    if (this.finished || deltaSeconds <= 0) return null;
    this.elapsed += deltaSeconds;
    if (this.elapsed < this.warmupSeconds) return null;
    this.samples.push(deltaSeconds);
    if (this.elapsed < this.warmupSeconds + this.durationSeconds) return null;

    this.finished = true;
    const median = this.medianDelta();
    if (median <= 0) return null;
    const fps = 1 / median;
    if (fps >= this.targetFps) return null;
    return LOWER[current];
  }

  /** Median rather than mean: one long stall should not demote a fine device. */
  private medianDelta(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}
