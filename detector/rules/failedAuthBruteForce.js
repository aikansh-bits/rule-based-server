export const failedAuthBruteForce = {
  id: "failed_auth_brute_force",
  name: "Brute-force on /login (failed-auth burst)",
  weight: 1.0,
  evaluate(ctx) {
    if (ctx.path !== "/login") return { fired: false };

    const { state, now, config } = ctx;
    const { windowMs, maxFails } = config.rules.bruteForce;
    const recent = state.loginFails.filter((t) => now - t <= windowMs).length;

    if (recent >= maxFails) {
      return {
        fired: true,
        reason: "brute_force_login",
        details: { fails: recent, windowMs, maxFails },
      };
    }
    return { fired: false };
  },
};
