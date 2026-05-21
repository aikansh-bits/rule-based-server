import { elapsedMs } from "../utils/time.js";
import { recordDetection } from "../metrics/store.js";
import { config } from "../config/index.js";

/**
 * Records the wall-clock time the server held each request and finalises the
 * JSONL row. This middleware MUST be installed before any handler that may
 * short-circuit the request (e.g. a detection block), because we register the
 * `finish` listener up-front.
 *
 * The JSONL row is the artefact the analyser frontend consumes and is also
 * the cited evidence in the dissertation. Its shape is deliberately stable:
 *   {
 *     run_id, request_id, ts, ip, method, path, endpoint_class, status,
 *     ground_truth, attack_family, mode, budget_ms,
 *     decision, decision_source, blocked,
 *     fallback_used, fallback_reason, budget_exceeded,
 *     rule: { evaluated, fired_ids, fired_count, score, latency_ms },
 *     ai:   { called, is_anomaly, score, latency_ms, error },
 *     detection_latency_ms, internal_latency_ms, response_time_ms,
 *     user_agent, request_size, scenario
 *   }
 */
export const responseTimer = (req, res, next) => {
  if (!req.ctx) return next();

  res.on("finish", () => {
    const responseTimeMs = round(elapsedMs(req.ctx.startHr));
    req.ctx.responseTimeMs = responseTimeMs;

    if (!config.metrics.enabled) return;
    if (!shouldRecord(req)) return;
    // Only requests that traversed the detection middleware populate ctx.detection.
    // System & metrics endpoints have ctx but no detection, so we skip them — the
    // JSONL is reserved exclusively for experimental detection records.
    if (!req.ctx.detection) return;

    const det = req.ctx.detection;
    const row = {
      run_id: req.ctx.runId,
      request_id: req.ctx.requestId,
      ts: req.ctx.startedAt,
      ip: req.ip,
      method: req.method,
      path: req.path,
      endpoint_class: req.ctx.endpointClass || req.path,
      status: res.statusCode,

      ground_truth: req.ctx.groundTruth,
      attack_family: req.ctx.attackFamily || "unknown",
      mode: req.ctx.mode,
      budget_ms: req.ctx.budgetMs,
      scenario: req.ctx.scenario,

      decision: det.decision || "allow",
      decision_source: det.decision_source || "none",
      blocked: det.decision === "block",
      fallback_used: !!det.fallback_used,
      fallback_reason: det.fallback_reason || null,
      budget_exceeded: !!det.budget_exceeded,

      rule: det.rule || null,
      ai: det.ai || null,

      detection_latency_ms: det.detection_latency_ms ?? null,
      internal_latency_ms: req.ctx.internalLatencyMs ?? null,
      response_time_ms: responseTimeMs,

      user_agent: req.get("user-agent") || null,
      request_size: Number(req.get("content-length") || 0),
    };

    recordDetection(row);
  });

  next();
};

const shouldRecord = (req) => {
  if (req.path === "/" || req.path === "/health" || req.path === "/ready" || req.path === "/version") {
    return false;
  }
  if (req.path === "/catalog") return false;
  if (req.path.startsWith("/metrics")) return false;
  if (req.path.startsWith("/detector/state")) return false;
  return true;
};

const round = (n, d = 3) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
