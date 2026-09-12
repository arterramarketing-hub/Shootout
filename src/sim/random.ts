/**
 * Seeded pseudo-random source.
 *
 * Shooting must not call Math.random: spread and pellet scatter have to be
 * reproducible in tests, and in Phase 3 the server has to reach the same
 * result as the client from the same seed.
 */
export interface Random {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  reseed(seed: number): void;
}

/** mulberry32: small, fast, and good enough for scatter. */
export const createRandom = (seed = 0x2f6e2b1): Random => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    reseed: (value) => {
      state = value >>> 0;
    },
  };
};
