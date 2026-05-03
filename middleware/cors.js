import cors from "cors";
import { config } from "../config/index.js";

/**
 * CORS configuration.
 *
 * In production we expect a comma-separated list of allowed origins via
 * `CORS_ORIGINS`. In development the wildcard "*" is convenient. Importantly,
 * the simulation panel needs to send custom headers (X-Detection-Mode,
 * X-Detection-Budget-Ms, X-Ground-Truth, X-Run-Id, X-Scenario) and read
 * X-Request-Id back, so those are exposed/allowed explicitly.
 */
export const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (config.corsOrigins === "*" || !origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
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
  ],
  exposedHeaders: ["x-request-id", "x-detection-latency-ms", "x-decision", "x-decision-source"],
  maxAge: 86_400,
});
