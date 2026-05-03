import { classificationMetrics, summarise } from "../utils/stats.js";
import { readRun } from "./store.js";

/**
 * Compute the dissertation-level summary for a single run.
 *
 * The summary intentionally separates *classification* metrics from *latency*
 * metrics so the analyser can show the trade-off curve cleanly. It also breaks
 * down counts by mode, decision source, fired rules, and endpoint, so the
 * dashboard has rich data without having to re-process the raw JSONL.
 *
 * Latency convention:
 *   - `detection_latency_ms` is what we plot for "system latency" in the
 *     dissertation: the time spent inside the detection pipeline only,
 *     including the AI call and rule evaluation, but excluding the mock
 *     endpoint's own work.
 *   - `response_time_ms` is the wall-clock time the server held the request,
 *     reported as a sanity-check signal.
 */

const inc = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

const isMalicious = (g) => g === "malicious";
const isLegitimate = (g) => g === "legitimate";

export const aggregateRun = (runId) => {
  const rows = readRun(runId);
  if (rows.length === 0) {
    return { runId, empty: true, total: 0 };
  }

  const detectionLatencies = [];
  const ruleLatencies = [];
  const aiLatencies = [];
  const responseTimes = [];

  let blocked = 0;
  let allowed = 0;
  let budgetExceeded = 0;
  let fallbackUsed = 0;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let labelled = 0;

  const byMode = new Map();
  const byDecisionSource = new Map();
  const byEndpoint = new Map();
  const byFiredRule = new Map();
  const byStatus = new Map();
  const byBudget = new Map();
  const byGroundTruth = new Map();

  let firstTs = null;
  let lastTs = null;

  for (const r of rows) {
    if (typeof r.detection_latency_ms === "number") detectionLatencies.push(r.detection_latency_ms);
    if (typeof r.rule?.latency_ms === "number") ruleLatencies.push(r.rule.latency_ms);
    if (typeof r.ai?.latency_ms === "number" && r.ai?.called) aiLatencies.push(r.ai.latency_ms);
    if (typeof r.response_time_ms === "number") responseTimes.push(r.response_time_ms);

    if (r.decision === "block") blocked++;
    else if (r.decision === "allow") allowed++;
    if (r.budget_exceeded) budgetExceeded++;
    if (r.fallback_used) fallbackUsed++;

    if (r.ground_truth && r.ground_truth !== "unknown") {
      labelled++;
      const blocked = r.decision === "block";
      if (isMalicious(r.ground_truth) && blocked) tp++;
      else if (isLegitimate(r.ground_truth) && blocked) fp++;
      else if (isLegitimate(r.ground_truth) && !blocked) tn++;
      else if (isMalicious(r.ground_truth) && !blocked) fn++;
    }

    inc(byMode, r.mode || "unknown");
    inc(byDecisionSource, r.decision_source || "none");
    inc(byEndpoint, r.endpoint_class || r.path || "unknown");
    inc(byStatus, String(r.status ?? "?"));
    inc(byBudget, String(r.budget_ms ?? "?"));
    inc(byGroundTruth, r.ground_truth || "unknown");

    for (const id of r.rule?.fired_ids || []) inc(byFiredRule, id);

    if (r.ts) {
      if (!firstTs || r.ts < firstTs) firstTs = r.ts;
      if (!lastTs || r.ts > lastTs) lastTs = r.ts;
    }
  }

  const durationSec =
    firstTs && lastTs
      ? Math.max(0.001, (Date.parse(lastTs) - Date.parse(firstTs)) / 1000)
      : 0;
  const throughputRps = durationSec > 0 ? rows.length / durationSec : 0;

  return {
    runId,
    total: rows.length,
    labelled,
    unlabelled: rows.length - labelled,

    counts: {
      blocked,
      allowed,
      budgetExceeded,
      fallbackUsed,
    },

    classification: classificationMetrics({ tp, fp, tn, fn }),

    latencyMs: {
      detection: summarise(detectionLatencies),
      ruleEngine: summarise(ruleLatencies),
      aiCall: summarise(aiLatencies),
      response: summarise(responseTimes),
    },

    throughput: {
      durationSec: Number(durationSec.toFixed(3)),
      requestsPerSecond: Number(throughputRps.toFixed(3)),
    },

    timeline: { firstTs, lastTs },

    breakdown: {
      mode: Object.fromEntries(byMode),
      decisionSource: Object.fromEntries(byDecisionSource),
      endpoint: Object.fromEntries(byEndpoint),
      status: Object.fromEntries(byStatus),
      budgetMs: Object.fromEntries(byBudget),
      groundTruth: Object.fromEntries(byGroundTruth),
      firedRules: Object.fromEntries(byFiredRule),
    },
  };
};
