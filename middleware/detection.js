import { config } from "../config/index.js";
import { runDetection } from "../detector/engine.js";
import { callAiDetector } from "../detector/aiClient.js";
import { withBudget } from "../latency/withBudget.js";
import { recordFailedLogin } from "../detector/state.js";
import { logger } from "../utils/logger.js";
import { elapsedMs, now } from "../utils/time.js";
import { createResponse } from "../utils/helper.js";

/**
 * Detection middleware — the heart of the latency-vs-accuracy experiment.
 *
 * Modes
 * -----
 *   "rule"   : run only the rule engine. Fast, deterministic, lower recall.
 *   "ai"     : run only the AI server. Slower, higher recall on novel patterns.
 *   "hybrid" : run rules first; if rules don't fire, escalate to the AI.
 *              This is the most realistic deployment shape and lets the
 *              dashboard compare the marginal value of the AI step.
 *
 * Latency control
 * ---------------
 * Every mode is wrapped in `withBudget`. If the per-request budget is
 * exceeded, the configured fallback decision is applied immediately and the
 * request is tagged `fallback_used: true` so the dissertation can quantify
 * how often the SLA was protected at the cost of accuracy.
 *
 * Metrics
 * -------
 * The function does NOT write to disk. Instead it stores a structured
 * `detection` object on `req.ctx`; the response timer middleware aggregates
 * it with the response code/timing and writes a single JSONL row.
 */

const log = logger.child({ component: "detection" });

const buildMetricsRow = ({
  decision,
  decision_source,
  detection_latency_ms,
  budget_exceeded,
  fallback_used,
  fallback_reason,
  rule,
  ai,
}) => ({
  decision,
  decision_source,
  detection_latency_ms: round(detection_latency_ms),
  budget_exceeded: !!budget_exceeded,
  fallback_used: !!fallback_used,
  fallback_reason: fallback_reason || null,
  rule: rule || null,
  ai: ai || null,
});

const compactRule = (ruleResult, latencyMs) => ({
  evaluated: ruleResult.rulesEvaluated,
  fired_ids: ruleResult.fired.map((v) => v.ruleId),
  fired_count: ruleResult.fired.length,
  score: round(ruleResult.score),
  latency_ms: round(latencyMs),
});

const compactAi = (aiResult, latencyMs, called = true) => {
  if (!aiResult) return { called: false, is_anomaly: false, score: 0, latency_ms: 0, error: null };
  if (!aiResult.ok) {
    return {
      called,
      is_anomaly: false,
      score: 0,
      latency_ms: round(latencyMs ?? aiResult.latency_ms ?? 0),
      error: aiResult.error || "unknown",
    };
  }
  const data = aiResult.data || {};
  return {
    called,
    is_anomaly: !!data.is_anomaly,
    score: round(Number(data.score) || 0, 4),
    latency_ms: round(latencyMs ?? aiResult.latency_ms ?? 0),
    label: data.label || null,
    model: data.model || null,
    error: null,
  };
};

/**
 * Run the rule engine, instrumented with high-resolution timing.
 * Returns { decision: "block"|"allow", detail }.
 */
const runRuleStage = (req) => {
  const start = now();
  const result = runDetection(req);
  const latency = elapsedMs(start);
  return {
    decision: result.blocked ? "block" : "allow",
    detail: result,
    latencyMs: latency,
  };
};

/**
 * Build the AI feature payload from the request and per-IP state.
 * Keeping this function colocated with detection (rather than buried in the
 * AI client) makes it explicit which features cross the network boundary.
 */
const buildAiPayload = (req) => {
  const ip = req.ip || "unknown";
  const ua = req.get("user-agent") || "";
  const cl = Number(req.get("content-length") || 0);
  const past = req._ipState?.timestamps || [];
  const burst = past.filter((t) => Date.now() - t <= config.rules.burst.windowMs).length;
  const minute = past.filter((t) => Date.now() - t <= config.rules.rateLimit.windowMs).length;
  const distinctPaths = new Set(
    (req._ipState?.paths || [])
      .filter((p) => Date.now() - p.t <= config.rules.scan.windowMs)
      .map((p) => p.path),
  ).size;

  return {
    request_id: req.id,
    method: req.method,
    path: req.path,
    endpoint: req.originalUrl,
    ip,
    user_agent: ua,
    content_length: cl,
    has_body: !!req.body && Object.keys(req.body).length > 0,
    query_keys: Object.keys(req.query || {}),
    body_keys: Object.keys(req.body || {}),
    history: {
      requests_1min: minute,
      requests_burst: burst,
      distinct_paths: distinctPaths,
    },
  };
};

const runAiStage = async (req, budgetMs) => {
  const payload = buildAiPayload(req);
  const start = now();
  const aiTimeout = Math.min(config.aiServer.timeoutMs, Math.max(10, budgetMs - 5));
  const aiRes = await callAiDetector(payload, { timeoutMs: aiTimeout });
  const latency = elapsedMs(start);

  if (!aiRes.ok) {
    return {
      decision: "allow",
      latencyMs: latency,
      raw: aiRes,
    };
  }

  const data = aiRes.data || {};
  const score = Number(data.score) || 0;
  const isAnomaly =
    data.is_anomaly === true || score >= config.aiServer.scoreThreshold;
  return {
    decision: isAnomaly ? "block" : "allow",
    latencyMs: latency,
    raw: aiRes,
  };
};

export const detectionMiddleware = async (req, res, next) => {
  const ctx = req.ctx;
  const { mode, budgetMs } = ctx;
  const fallback = config.detection.fallbackDecision;

  // Cache the per-IP state on req so route handlers can mark login failures
  // without going through the engine again.
  req._ipState = req._ipState || null;

  let ruleSummary = null;
  let aiSummary = null;
  let decision = "allow";
  let decisionSource = "none";

  const runner = async () => {
    if (mode === "rule") {
      const r = runRuleStage(req);
      ruleSummary = compactRule(r.detail, r.latencyMs);
      decision = r.decision;
      decisionSource = r.decision === "block" ? "rule" : "none";
      return { blocked: decision === "block" };
    }

    if (mode === "ai") {
      const a = await runAiStage(req, budgetMs);
      aiSummary = compactAi(a.raw, a.latencyMs, true);
      decision = a.decision;
      decisionSource = a.decision === "block" ? "ai" : a.raw?.ok ? "none" : "fallback";
      return { blocked: decision === "block" };
    }

    // hybrid: rules first; if they don't block, run the AI.
    const r = runRuleStage(req);
    ruleSummary = compactRule(r.detail, r.latencyMs);
    if (r.decision === "block") {
      decision = "block";
      decisionSource = "rule";
      aiSummary = compactAi(null, 0, false);
      return { blocked: true };
    }

    const a = await runAiStage(req, budgetMs);
    aiSummary = compactAi(a.raw, a.latencyMs, true);
    decision = a.decision;
    decisionSource = a.decision === "block" ? "ai" : a.raw?.ok ? "none" : "fallback";
    return { blocked: decision === "block" };
  };

  let outcome;
  try {
    outcome = await withBudget(runner, { budgetMs, fallback });
  } catch (err) {
    log.error("detection_pipeline_error", {
      requestId: req.id,
      error: err.message,
    });
    outcome = {
      decision: fallback,
      detection_latency_ms: 0,
      budget_exceeded: false,
      fallback_used: true,
      fallback_reason: `pipeline_error:${err.message}`,
      detail: null,
    };
  }

  // If the budget timed out before any stage completed we may not have
  // populated rule/ai summaries — fill them with empty placeholders so the
  // JSONL row is uniform.
  if (outcome.fallback_used && outcome.fallback_reason === "budget_exceeded") {
    if (!ruleSummary) ruleSummary = { evaluated: 0, fired_ids: [], fired_count: 0, score: 0, latency_ms: 0 };
    if (!aiSummary) aiSummary = compactAi(null, 0, false);
    decision = outcome.decision;
    decisionSource = "fallback";
  } else if (outcome.fallback_used) {
    decisionSource = "fallback";
    decision = outcome.decision;
  }

  ctx.detection = buildMetricsRow({
    decision,
    decision_source: decisionSource,
    detection_latency_ms: outcome.detection_latency_ms,
    budget_exceeded: outcome.budget_exceeded,
    fallback_used: outcome.fallback_used,
    fallback_reason: outcome.fallback_reason,
    rule: ruleSummary,
    ai: aiSummary,
  });

  // Surface the decision on the response headers so client-side simulators
  // can read it without parsing the body (and without us mutating their JSON).
  res.setHeader("x-decision", decision);
  res.setHeader("x-decision-source", decisionSource);
  res.setHeader("x-detection-latency-ms", String(round(outcome.detection_latency_ms)));

  if (decision === "block") {
    return res.status(429).json(
      createResponse({
        success: false,
        message: "Request blocked by detection pipeline",
        meta: {
          requestId: req.id,
          decision,
          decisionSource,
          mode,
          budgetMs,
          detectionLatencyMs: round(outcome.detection_latency_ms),
          fallbackUsed: !!outcome.fallback_used,
          fallbackReason: outcome.fallback_reason,
          firedRules: ruleSummary?.fired_ids || [],
          aiScore: aiSummary?.score ?? null,
        },
      }),
    );
  }

  next();
};

/**
 * Helper for the /login route to record a failed login attempt against the
 * shared per-IP state, which feeds the brute-force rule on subsequent requests.
 */
export const noteFailedLogin = (req) => {
  recordFailedLogin(req.ip || "unknown");
};

const round = (n, d = 3) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
