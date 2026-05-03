const PATTERNS = [
  /;\s*(rm|cat|ls|wget|curl|sh|bash)\b/i,
  /\|\s*(rm|cat|ls|wget|curl|sh|bash)\b/i,
  /&&\s*(rm|cat|ls|wget|curl|sh|bash)\b/i,
  /`[^`]+`/, // backticks
  /\$\([^)]+\)/, // $(...)
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

export const commandInjection = {
  id: "command_injection",
  name: "Command injection patterns",
  weight: 1.0,
  evaluate(ctx) {
    const haystack = [ctx.originalUrl, ...flatten(ctx.query), ...flatten(ctx.body)];
    for (const s of haystack) {
      for (const re of PATTERNS) {
        if (re.test(s)) {
          return {
            fired: true,
            reason: "command_injection",
            details: { pattern: re.toString(), sample: String(s).slice(0, 120) },
          };
        }
      }
    }
    return { fired: false };
  },
};
