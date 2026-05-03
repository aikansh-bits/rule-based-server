const PATTERNS = [
  /<script\b/i,
  /<\/script>/i,
  /\bjavascript:/i,
  /\bon\w+\s*=\s*["']?[^"'>]+/i, // onerror= onclick= etc.
  /<iframe\b/i,
  /<svg\b[^>]*on\w+=/i,
];

const flatten = (obj, out = []) => {
  if (obj == null) return out;
  if (typeof obj === "string") {
    out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v) => flatten(v, out));
    return out;
  }
  if (typeof obj === "object") Object.values(obj).forEach((v) => flatten(v, out));
  return out;
};

export const xss = {
  id: "xss",
  name: "XSS patterns",
  weight: 1.0,
  evaluate(ctx) {
    const haystack = [
      decodeURIComponent(ctx.originalUrl),
      ...flatten(ctx.query),
      ...flatten(ctx.body),
    ];
    for (const s of haystack) {
      for (const re of PATTERNS) {
        if (re.test(s)) {
          return {
            fired: true,
            reason: "xss",
            details: { pattern: re.toString(), sample: String(s).slice(0, 120) },
          };
        }
      }
    }
    return { fired: false };
  },
};
