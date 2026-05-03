import { logger } from "../utils/logger.js";

/**
 * Lightweight request access log. Skips noisy paths (health, metrics)
 * because the experimental traffic generator hits those frequently and the
 * detection JSONL is a richer data source for everything else.
 */

const SKIP = new Set(["/", "/health", "/ready", "/version", "/favicon.ico"]);
const SKIP_PREFIX = ["/metrics"];
const log = logger.child({ component: "http" });

export const httpLogger = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const path = req.path;
    if (SKIP.has(path)) return;
    if (SKIP_PREFIX.some((p) => path.startsWith(p))) return;
    log.info({
      msg: "request",
      requestId: req.id,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
};
