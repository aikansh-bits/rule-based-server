/**
 * Minimal hand-rolled security headers.
 *
 * We avoid `helmet` to keep dependencies tight; the API never serves HTML, so
 * the surface area is small. The headers below cover the realistic attack
 * surface for a JSON-only API: clickjacking, MIME sniffing, referrer leaks,
 * and surface fingerprinting.
 */
export const securityHeaders = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.removeHeader("X-Powered-By");
  next();
};
