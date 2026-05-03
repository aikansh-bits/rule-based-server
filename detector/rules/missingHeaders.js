const REQUIRED = ["host", "accept"];

export const missingHeaders = {
  id: "missing_headers",
  name: "Missing standard headers",
  weight: 0.3,
  evaluate(ctx) {
    const missing = REQUIRED.filter((h) => !ctx.headers[h]);
    if (missing.length > 0) {
      return {
        fired: true,
        reason: "missing_headers",
        details: { missing },
      };
    }
    return { fired: false };
  },
};
