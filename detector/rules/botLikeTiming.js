/**
 * Flags requests whose inter-arrival times from the same IP are suspiciously
 * regular (low coefficient of variation), which is characteristic of bots.
 *
 * Requires at least MIN_SAMPLES recent requests; otherwise returns no-fire.
 */
const MIN_SAMPLES = 8;
const CV_THRESHOLD = 0.05; // <5% variation => "too regular"
const LOOKBACK_MS = 30_000;

export const botLikeTiming = {
  id: "bot_like_timing",
  name: "Bot-like (too-regular) request timing",
  weight: 0.5,
  evaluate(ctx) {
    const recent = ctx.state.timestamps.filter(
      (t) => ctx.now - t <= LOOKBACK_MS,
    );
    if (recent.length < MIN_SAMPLES) return { fired: false };

    const sorted = [...recent].sort((a, b) => a - b);
    const deltas = [];
    for (let i = 1; i < sorted.length; i++) deltas.push(sorted[i] - sorted[i - 1]);

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    if (mean === 0) return { fired: false };

    const variance =
      deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length;
    const cv = Math.sqrt(variance) / mean;

    if (cv < CV_THRESHOLD) {
      return {
        fired: true,
        reason: "bot_like_timing",
        details: { samples: deltas.length, meanMs: mean, cv },
      };
    }
    return { fired: false };
  },
};
