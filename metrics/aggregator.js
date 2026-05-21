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

  // Throughput is meaningful only when we have more than one record AND the
  // span between first and last is non-trivial (>= 100 ms). Otherwise the
  // ratio is dominated by the timestamp resolution and produces nonsense
  // figures like "1000 rps from a single record". When the run is too small,
  // we report 0 — the dashboard can show "—" instead of a fake number.
  const spanMs = firstTs && lastTs ? Date.parse(lastTs) - Date.parse(firstTs) : 0;
  const durationSec = rows.length >= 2 && spanMs >= 100 ? spanMs / 1000 : 0;
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

const round = (n, d = 4) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

/**
 * Build the latency-vs-accuracy matrix for the dissertation's Results tab.
 *
 * Groups the JSONL rows by (mode, budget_ms) and, for each cell, computes the
 * classification metrics, the per-stage latency percentiles, and the fallback
 * rate. The shape is one flat array of cell objects so the frontend can plot
 * any combination (Pareto curve, fallback line, latency distribution) without
 * re-grouping.
 *
 * Convention: only rows that carry a definite ground truth contribute to the
 * classification metrics. Rows with ground_truth === "unknown" still count
 * toward the latency and fallback statistics so traffic generators that don't
 * label their requests do not silently disappear from the system view.
 */
export const aggregateMatrix = (runId) => {
  const rows = readRun(runId);
  if (rows.length === 0) {
    return { runId, empty: true, total: 0, cells: [] };
  }

  // key = `${mode}|${budget_ms}`
  const groups = new Map();
  const keyOf = (r) => `${r.mode || "unknown"}|${r.budget_ms ?? "unknown"}`;
  const cellInit = (mode, budgetMs) => ({
    mode,
    budget_ms: budgetMs,
    n: 0,
    n_labelled: 0,
    tp: 0,
    fp: 0,
    tn: 0,
    fn: 0,
    fallback_used: 0,
    budget_exceeded: 0,
    detectionLatencies: [],
    ruleLatencies: [],
    aiLatencies: [],
  });

  for (const r of rows) {
    const key = keyOf(r);
    let cell = groups.get(key);
    if (!cell) {
      cell = cellInit(r.mode || "unknown", r.budget_ms ?? null);
      groups.set(key, cell);
    }

    cell.n++;
    if (r.fallback_used) cell.fallback_used++;
    if (r.budget_exceeded) cell.budget_exceeded++;

    if (typeof r.detection_latency_ms === "number") {
      cell.detectionLatencies.push(r.detection_latency_ms);
    }
    if (typeof r.rule?.latency_ms === "number") {
      cell.ruleLatencies.push(r.rule.latency_ms);
    }
    if (r.ai?.called && typeof r.ai?.latency_ms === "number") {
      cell.aiLatencies.push(r.ai.latency_ms);
    }

    if (r.ground_truth === "malicious" || r.ground_truth === "legitimate") {
      cell.n_labelled++;
      const blocked = r.decision === "block";
      if (r.ground_truth === "malicious" && blocked) cell.tp++;
      else if (r.ground_truth === "legitimate" && blocked) cell.fp++;
      else if (r.ground_truth === "legitimate" && !blocked) cell.tn++;
      else if (r.ground_truth === "malicious" && !blocked) cell.fn++;
    }
  }

  // Materialise the cells into a flat array with derived metrics.
  const cells = [];
  for (const cell of groups.values()) {
    const cls = classificationMetrics({
      tp: cell.tp,
      fp: cell.fp,
      tn: cell.tn,
      fn: cell.fn,
    });
    const detection = summarise(cell.detectionLatencies);
    const ruleEngine = summarise(cell.ruleLatencies);
    const aiCall = summarise(cell.aiLatencies);
    cells.push({
      mode: cell.mode,
      budget_ms: cell.budget_ms,
      n: cell.n,
      n_labelled: cell.n_labelled,
      // Classification metrics from cls (already rounded inside it).
      tp: cls.tp,
      fp: cls.fp,
      tn: cls.tn,
      fn: cls.fn,
      accuracy: cls.accuracy,
      precision: cls.precision,
      recall: cls.recall,
      f1: cls.f1,
      fpr: cls.fpr,
      fnr: cls.fnr,
      // Operational metrics
      fallback_rate: round(cell.n === 0 ? 0 : cell.fallback_used / cell.n),
      budget_exceeded_rate: round(
        cell.n === 0 ? 0 : cell.budget_exceeded / cell.n,
      ),
      // Latency summaries (mean / p50 / p90 / p95 / p99 / max already inside)
      latencyMs: {
        detection,
        ruleEngine,
        aiCall,
      },
    });
  }

  // Stable ordering: mode then budget (ascending). Helps the frontend draw
  // line series in a predictable left-to-right sequence.
  const MODE_ORDER = { rule: 0, hybrid: 1, ai: 2 };
  cells.sort((a, b) => {
    const m = (MODE_ORDER[a.mode] ?? 99) - (MODE_ORDER[b.mode] ?? 99);
    if (m !== 0) return m;
    return (a.budget_ms ?? 0) - (b.budget_ms ?? 0);
  });

  return { runId, total: rows.length, cellCount: cells.length, cells };
};

/**
 * Group rows by (mode, attack_family) and compute the recall (detection rate)
 * for each cell. Used by the Results tab's attack-family heatmap.
 *
 * Only rows whose `ground_truth` is "malicious" contribute, because recall is
 * only meaningful on the positive class. Legitimate traffic ends up in a
 * synthetic `attack_family === "benign"` column on the simulation side but we
 * deliberately omit it here so the heatmap shows attack-detection capability
 * cleanly without a benign distractor.
 */
export const aggregateAttackFamily = (runId) => {
  const rows = readRun(runId);
  if (rows.length === 0) {
    return { runId, empty: true, total: 0, cells: [] };
  }

  // key = `${mode}|${family}` — each cell tracks tp and fn over malicious rows
  const groups = new Map();
  const families = new Set();
  const modes = new Set();

  for (const r of rows) {
    if (r.ground_truth !== "malicious") continue;
    const mode = r.mode || "unknown";
    const family = r.attack_family || "unknown";
    if (family === "benign") continue;
    const key = `${mode}|${family}`;
    let cell = groups.get(key);
    if (!cell) {
      cell = { mode, family, tp: 0, fn: 0, n: 0 };
      groups.set(key, cell);
    }
    cell.n++;
    if (r.decision === "block") cell.tp++;
    else cell.fn++;
    families.add(family);
    modes.add(mode);
  }

  const cells = [];
  for (const cell of groups.values()) {
    const denom = cell.tp + cell.fn;
    const recall = denom === 0 ? 0 : cell.tp / denom;
    cells.push({
      mode: cell.mode,
      family: cell.family,
      n: cell.n,
      tp: cell.tp,
      fn: cell.fn,
      recall: round(recall),
    });
  }

  // Stable ordering helps the frontend render the heatmap rows/columns in a
  // predictable layout without re-sorting on the client.
  const MODE_ORDER = { rule: 0, hybrid: 1, ai: 2 };
  cells.sort((a, b) => {
    const m = (MODE_ORDER[a.mode] ?? 99) - (MODE_ORDER[b.mode] ?? 99);
    if (m !== 0) return m;
    return a.family.localeCompare(b.family);
  });

  return {
    runId,
    total: rows.length,
    modes: Array.from(modes).sort(
      (a, b) => (MODE_ORDER[a] ?? 99) - (MODE_ORDER[b] ?? 99),
    ),
    families: Array.from(families).sort(),
    cells,
  };
};
