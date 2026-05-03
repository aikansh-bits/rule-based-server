const PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e%2f/i,
  /%2e%2e\//i,
  /\/etc\/passwd/i,
  /\\windows\\system32/i,
];

export const pathTraversal = {
  id: "path_traversal",
  name: "Path traversal patterns",
  weight: 1.0,
  evaluate(ctx) {
    const url = decodeURIComponent(ctx.originalUrl);
    for (const re of PATTERNS) {
      if (re.test(url)) {
        return {
          fired: true,
          reason: "path_traversal",
          details: { pattern: re.toString(), sample: url.slice(0, 120) },
        };
      }
    }
    return { fired: false };
  },
};
