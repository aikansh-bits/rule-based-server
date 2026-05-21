import cors from "cors";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * CORS configuration.
 *
 * `CORS_ORIGINS` semantics:
 *   - unset / empty / "*"  -> allow any origin (permissive default for demos)
 *   - "https://a, https://b" -> only those origins (strict allowlist)
 *
 * The simulation panel needs to send custom headers (X-Detection-Mode,
 * X-Detection-Budget-Ms, X-Ground-Truth, X-Run-Id, X-Scenario,
 * X-Attack-Family) and read X-Request-Id back, so those are explicitly listed.
 *
 * Disallowed origins receive a clean structured 403 from `originGuard` rather
 * than a 500 from the central error handler — that way the browser shows a
 * useful message in DevTools instead of an opaque "Failed to fetch".
 */

const log = logger.child({ component: "cors" });

const isAllowed = (origin) => {
  if (!origin) return true; // same-origin / curl / server-to-server
  if (config.corsOrigins === "*") return true;
  return config.corsOrigins.includes(origin);
};

export const corsMiddleware = cors({
  origin: (origin, cb) => cb(null, isAllowed(origin)),
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "content-type",
    "authorization",
    "x-request-id",
    "x-detection-mode",
    "x-detection-budget-ms",
    "x-ground-truth",
    "x-run-id",
    "x-scenario",
    "x-attack-family",
  ],
  exposedHeaders: [
    "x-request-id",
    "x-detection-latency-ms",
    "x-decision",
    "x-decision-source",
  ],
  maxAge: 86_400,
});

/**
 * If a real (non-OPTIONS) request comes in from a disallowed origin, the cors
 * package will simply not add the Access-Control-Allow-Origin header, which
 * the browser then rejects. We additionally short-circuit with a 403 here so
 * server-side observability picks up the rejection.
 */
export const originGuard = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (isAllowed(origin)) return next();
  log.warn("origin_rejected", { origin, path: req.path, method: req.method });
  return res.status(403).json({
    success: false,
    message: `Origin ${origin} not allowed by CORS policy`,
    meta: { requestId: req.id },
  });
};
