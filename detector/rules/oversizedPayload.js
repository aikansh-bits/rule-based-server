export const oversizedPayload = {
  id: "oversized_payload",
  name: "Oversized request payload",
  weight: 0.7,
  evaluate(ctx) {
    const max = ctx.config.rules.payload.maxBytes;
    const cl = Number(ctx.headers["content-length"] || 0);
    if (cl > max) {
      return {
        fired: true,
        reason: "oversized_payload",
        details: { contentLength: cl, max },
      };
    }
    return { fired: false };
  },
};
