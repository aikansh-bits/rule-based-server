const PATTERNS = [
  /(\bunion\b\s+\bselect\b)/i,
  /(\bselect\b\s+.+\bfrom\b)/i,
  /(\bdrop\b\s+\btable\b)/i,
  /(\binsert\b\s+\binto\b)/i,
  /(\bdelete\b\s+\bfrom\b)/i,
  /(\bupdate\b\s+\w+\s+\bset\b)/i,
  // Tautologies: "or 1=1", "' or '1'='1", "' or 1=1 --", "or true"
  /(['"]?\s*\bor\b\s*['"]?\s*\d+\s*['"]?\s*=\s*['"]?\s*\d+)/i,
  /(['"]?\s*\bor\b\s+true\b)/i,
  /(\band\b\s*\d+\s*=\s*\d+\s*--)/i,
  // SQL comments at end of value or trailing bypass
  /(--\s*$)/m,
  /(\/\*.*\*\/)/,
  /(;\s*(drop|alter|truncate|exec)\b)/i,
  /(\bxp_cmdshell\b)/i,
  // Time-based blind SQLi
  /(\bsleep\s*\(\s*\d+\s*\))/i,
  /(\bwaitfor\s+delay\b)/i,
  /(\bbenchmark\s*\()/i,
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
  if (typeof obj === "object") {
    Object.values(obj).forEach((v) => flatten(v, out));
  }
  return out;
};

export const sqlInjection = {
  id: "sql_injection",
  name: "SQL injection patterns",
  weight: 1.0,
  evaluate(ctx) {
    const haystack = [ctx.originalUrl, ...flatten(ctx.query), ...flatten(ctx.body)];
    for (const s of haystack) {
      for (const re of PATTERNS) {
        if (re.test(s)) {
          return {
            fired: true,
            reason: "sql_injection",
            details: { pattern: re.toString(), sample: String(s).slice(0, 120) },
          };
        }
      }
    }
    return { fired: false };
  },
};
