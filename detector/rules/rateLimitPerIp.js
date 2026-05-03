export const rateLimitPerIp = {
  id: "rate_limit_per_ip",
  name: "Rate limit per IP (sliding window)",
  weight: 1.0,
  evaluate(ctx) {
    const { state, now, config } = ctx;
    const { windowMs, max } = config.rules.rateLimit;
    const inWindow = state.timestamps.filter((t) => now - t <= windowMs).length;

    if (inWindow > max) {
      return {
        fired: true,
        reason: "rate_limit_exceeded",
        details: { count: inWindow, windowMs, max },
      };
    }
    return { fired: false };
  },
};
