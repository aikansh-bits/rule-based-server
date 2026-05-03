export const burstDetector = {
  id: "burst_detector",
  name: "Sudden burst of requests",
  weight: 1.0,
  evaluate(ctx) {
    const { state, now, config } = ctx;
    const { windowMs, max } = config.rules.burst;
    const inBurst = state.timestamps.filter((t) => now - t <= windowMs).length;

    if (inBurst > max) {
      return {
        fired: true,
        reason: "burst_detected",
        details: { count: inBurst, windowMs, max },
      };
    }
    return { fired: false };
  },
};
