import "dotenv/config";

/**
 * Single source of truth for all server configuration.
 *
 * Every setting is read from environment variables (with sensible dev
 * defaults) so the same binary can drive dev, CI, and the deployed Render
 * instance simply by changing env vars. Numeric and boolean coercion is done
 * here so the rest of the codebase can rely on typed values.
 */

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const bool = (v, d) => {
  if (v == null || v === "") return d;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};

const list = (v) =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const oneOf = (v, allowed, d) => {
  const s = String(v || "").toLowerCase();
  return allowed.includes(s) ? s : d;
};

const env = process.env.NODE_ENV || "development";

export const config = {
  env,
  isProd: env === "production",
  port: num(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || (env === "production" ? "info" : "debug"),

  serviceName: process.env.SERVICE_NAME || "rule-based-server",
  serviceVersion: process.env.SERVICE_VERSION || "1.0.0",

  corsOrigins: process.env.CORS_ORIGINS === "*" ? "*" : list(process.env.CORS_ORIGINS),

  // Body parser limits. Keeping these explicit and small forces oversized-payload
  // attacks to surface as 413s before they reach the rule engine, mirroring
  // production hardening practice.
  bodyLimit: process.env.BODY_LIMIT || "256kb",

  // Latency control over the *whole* detection pipeline (rules + AI).
  detection: {
    budgetMs: num(process.env.DETECTION_BUDGET_MS, 50),
    fallbackDecision: oneOf(process.env.FALLBACK_DECISION, ["allow", "block"], "allow"),
    defaultMode: oneOf(process.env.DETECTION_MODE, ["rule", "ai", "hybrid"], "hybrid"),
    // Allow callers (the simulation panel) to override budget/mode per request
    // via headers — disable in production deployments if needed.
    allowHeaderOverrides: bool(process.env.ALLOW_HEADER_OVERRIDES, true),
  },

  // Rule-engine knobs
  ruleEngine: {
    aggregation: oneOf(process.env.RULE_AGGREGATION, ["any", "weighted"], "any"),
    scoreThreshold: num(process.env.RULE_SCORE_THRESHOLD, 1.0),
  },

  rules: {
    rateLimit: {
      windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
      max: num(process.env.RATE_LIMIT_MAX, 60),
    },
    burst: {
      windowMs: num(process.env.BURST_WINDOW_MS, 1_000),
      max: num(process.env.BURST_MAX, 15),
    },
    bruteForce: {
      windowMs: num(process.env.BRUTE_FORCE_WINDOW_MS, 60_000),
      maxFails: num(process.env.BRUTE_FORCE_MAX_FAILS, 5),
    },
    scan: {
      windowMs: num(process.env.SCAN_WINDOW_MS, 10_000),
      distinctPaths: num(process.env.SCAN_DISTINCT_PATHS, 10),
    },
    payload: {
      maxBytes: num(process.env.MAX_PAYLOAD_BYTES, 51_200),
    },
    ipBlocklist: list(process.env.IP_BLOCKLIST),
  },

  // Connection settings for the AI-based detection server.
  aiServer: {
    baseUrl: process.env.AI_SERVER_URL || "http://127.0.0.1:8000",
    // Per-call timeout. Should be <= detection.budgetMs because the outer
    // budget will time out anyway, but a tighter HTTP timeout fails faster.
    timeoutMs: num(process.env.AI_SERVER_TIMEOUT_MS, 200),
    // If the AI server returns is_anomaly OR score >= threshold, we treat the
    // request as malicious. The threshold lets you trade precision vs recall
    // without changing the model.
    scoreThreshold: num(process.env.AI_SCORE_THRESHOLD, 0.5),
    circuitBreaker: {
      failureThreshold: num(process.env.AI_CB_FAILURE_THRESHOLD, 5),
      openMs: num(process.env.AI_CB_OPEN_MS, 10_000),
    },
  },

  metrics: {
    dir: process.env.METRICS_DIR || "./metrics/runs",
    flushIntervalMs: num(process.env.METRICS_FLUSH_INTERVAL_MS, 1_000),
    runId:
      process.env.RUN_ID && process.env.RUN_ID.trim().length > 0
        ? process.env.RUN_ID.trim()
        : `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    enabled: bool(process.env.METRICS_ENABLED, true),
    // Cap the size of any single run file (in records) to keep the analyser
    // panel snappy. 0 = unlimited.
    maxRecordsPerRun: num(process.env.METRICS_MAX_RECORDS_PER_RUN, 0),
  },
};
