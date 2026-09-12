import { describe, expect, it } from "vitest";
import { QualityBenchmark, guessTier, settingsFor } from "../src/engine/quality";

describe("guessTier", () => {
  it("puts software renderers on the lowest tier", () => {
    expect(guessTier("SwiftShader Device (LLVM 10)", false)).toBe("low");
    expect(guessTier("llvmpipe (LLVM 15, 256 bits)", false)).toBe("low");
  });

  it("puts old mobile parts on the lowest tier", () => {
    expect(guessTier("Mali-T760", true)).toBe("low");
    expect(guessTier("Adreno (TM) 505", true)).toBe("low");
  });

  it("puts recent flagships on the highest tier", () => {
    expect(guessTier("Apple A15 GPU", true)).toBe("high");
    expect(guessTier("Adreno (TM) 730", true)).toBe("high");
    expect(guessTier("Mali-G78", true)).toBe("high");
  });

  it("defaults unknown mobile parts to the middle tier", () => {
    expect(guessTier("Some New Mobile GPU", true)).toBe("medium");
  });

  it("assumes a desktop can handle the highest tier", () => {
    expect(guessTier("NVIDIA GeForce RTX 4070", false)).toBe("high");
  });
});

describe("settingsFor", () => {
  it("never renders above 1.5x pixel ratio", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(settingsFor(tier).maxPixelRatio).toBeLessThanOrEqual(1.5);
    }
  });

  it("keeps real-time shadows off below the top tier", () => {
    expect(settingsFor("low").shadows).toBe(false);
    expect(settingsFor("medium").shadows).toBe(false);
  });

  it("returns a fresh object each call so callers cannot mutate the table", () => {
    const first = settingsFor("high");
    first.maxPixelRatio = 99;
    expect(settingsFor("high").maxPixelRatio).not.toBe(99);
  });
});

describe("QualityBenchmark", () => {
  const feed = (benchmark: QualityBenchmark, fps: number, seconds: number) => {
    const delta = 1 / fps;
    let verdict: string | null = null;
    for (let elapsed = 0; elapsed < seconds; elapsed += delta) {
      verdict = benchmark.update(delta, "high") ?? verdict;
    }
    return verdict;
  };

  it("stays quiet while the device holds the target", () => {
    const benchmark = new QualityBenchmark(1, 50, 0.2);
    expect(feed(benchmark, 60, 3)).toBeNull();
    expect(benchmark.isFinished).toBe(true);
  });

  it("demotes a device that cannot hold the target", () => {
    const benchmark = new QualityBenchmark(1, 50, 0.2);
    expect(feed(benchmark, 30, 3)).toBe("medium");
  });

  it("only ever reports once", () => {
    const benchmark = new QualityBenchmark(1, 50, 0.2);
    feed(benchmark, 30, 3);
    expect(benchmark.update(1 / 10, "high")).toBeNull();
  });

  it("ignores a single stall during warmup", () => {
    const benchmark = new QualityBenchmark(1, 50, 0.5);
    benchmark.update(2.0, "high");
    expect(feed(benchmark, 60, 3)).toBeNull();
  });

  it("has nowhere to demote from the lowest tier", () => {
    const benchmark = new QualityBenchmark(1, 50, 0.2);
    let verdict: string | null = null;
    for (let i = 0; i < 200; i += 1) verdict = benchmark.update(1 / 20, "low") ?? verdict;
    expect(verdict).toBeNull();
  });
});
