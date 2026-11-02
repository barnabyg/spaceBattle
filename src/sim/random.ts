/** A seeded source of pseudo-random numbers in [0, 1); the same seed gives the same sequence. */
export type Random = () => number;

/** Mulberry32: small, fast and good enough for game chance; deterministic on every platform. */
export const createRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
