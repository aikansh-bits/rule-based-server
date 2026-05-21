import { config } from "../config/index.js";
import { now } from "../utils/time.js";

/**
 * Attaches a per-request context object that downstream middleware (detection,
 * routes, metrics writer) can read and mutate. This is the single record that
 * eventually gets serialised as one JSONL row.
 *
 * The context is intentionally separate from `req` properties so that we can
 * evolve the schema without colliding with Express internals.
 */
export const requestContext = (req, res, next) => {
  const startHr = now();
  const startedAt = new Date().toISOString();

  // Per-request overrides via headers (only when allowed by config).
  const allowOverride = config.detection.allowHeaderOverrides;
  const headerMode = (req.get("x-detection-mode") || "").toLowerCase();
  const headerBudget = Number(req.get("x-detection-budget-ms"));
  const headerRunId = (req.get("x-run-id") || "").trim();
  const headerGroundTruth = (req.get("x-ground-truth") || "").toLowerCase();
  const headerScenario = (req.get("x-scenario") || "").trim();
  const headerAttackFamily = (req.get("x-attack-family") || "").toLowerCase().trim();

  const mode =
    allowOverride && ["rule", "ai", "hybrid"].includes(headerMode)
      ? headerMode
      : config.detection.defaultMode;

  const budgetMs =
    allowOverride && Number.isFinite(headerBudget) && headerBudget > 0
      ? Math.min(headerBudget, 60_000)
      : config.detection.budgetMs;

  const runId = (allowOverride && headerRunId) || config.metrics.runId;

  const groundTruth = ["malicious", "legitimate", "unknown"].includes(headerGroundTruth)
    ? headerGroundTruth
    : "unknown";

  // The attack family is a short label (e.g. "sqli", "xss", "brute", "scanner",
  // "benign") used by the analyser to slice metrics per attack type. We accept
  // any header value but normalise empty / missing to "benign" when the
  // ground truth says legitimate, otherwise "unknown". Restricting to known
  // labels at this layer would force the rule server to track the scenario
  // taxonomy of the frontend, which we deliberately avoid.
  const attackFamily =
    headerAttackFamily ||
    (groundTruth === "legitimate" ? "benign" : "unknown");

  req.ctx = {
    requestId: req.id,
    startedAt,
    startHr,
    runId,
    mode,
    budgetMs,
    groundTruth,
    attackFamily,
    scenario: headerScenario || null,
    // Filled in by detection middleware:
    detection: null,
    // Filled in by route handlers:
    endpointClass: null,
    internalLatencyMs: null,
    // Filled in by the response timer:
    responseTimeMs: null,
  };

  next();
};
