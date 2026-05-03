// Allowed methods per known endpoint. Anything outside the table is ignored
// (so unknown endpoints are not falsely flagged).
const ALLOWED = {
  "/login": ["POST"],
  "/data": ["GET"],
  "/payment": ["POST"],
  "/attack": ["GET"],
};

export const httpMethodAbuse = {
  id: "http_method_abuse",
  name: "Unexpected HTTP method on known endpoint",
  weight: 0.5,
  evaluate(ctx) {
    const allowed = ALLOWED[ctx.path];
    if (!allowed) return { fired: false };
    if (!allowed.includes(ctx.method)) {
      return {
        fired: true,
        reason: "http_method_abuse",
        details: { method: ctx.method, allowed, path: ctx.path },
      };
    }
    return { fired: false };
  },
};
