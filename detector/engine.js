import { config } from "../config/index.js";
import { rules as defaultRules } from "./rules/index.js";
import { getIpState, pruneIpState } from "./state.js";

/**
 * Build the request context shared by all rules.
 * Rules MUST be pure-ish: they read ctx and return a verdict; they may also
 * push to per-IP state via the helpers in state.js.
 */
const buildContext = (req) => {
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const state = getIpState(ip);

  // Track this request in shared state BEFORE rules run, so sliding windows
  // see the current request as part of their count.
  state.timestamps.push(now);
  state.paths.push({ path: req.path, t: now });

  // Bound the per-IP state to the largest window any rule could care about.
  const maxAgeMs = Math.max(
    config.rules.rateLimit.windowMs,
    config.rules.burst.windowMs,
    config.rules.bruteForce.windowMs,
    config.rules.scan.windowMs,
  );
  pruneIpState(ip, now, maxAgeMs);

  return {
    now,
    ip,
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    headers: req.headers,
    query: req.query || {},
    body: req.body || {},
    state,
    config,
  };
};

const aggregate = (verdicts) => {
  const fired = verdicts.filter((v) => v.fired);
  if (fired.length === 0) {
    return { blocked: false, score: 0, fired: [], decision_source: "none" };
  }

  if (config.ruleEngine.aggregation === "any") {
    return {
      blocked: true,
      score: fired.reduce((a, v) => a + (v.weight || 1), 0),
      fired,
      decision_source: "rule",
    };
  }

  // weighted
  const score = fired.reduce((a, v) => a + (v.weight || 1), 0);
  return {
    blocked: score >= config.ruleEngine.scoreThreshold,
    score,
    fired,
    decision_source: "rule",
  };
};

/**
 * Run all rules synchronously against the request.
 * Synchronous on purpose: the rule engine is the FAST path; any I/O belongs
 * outside it. This keeps the latency budget meaningful.
 */
export const runDetection = (req, rules = defaultRules) => {
  const ctx = buildContext(req);

  const verdicts = [];
  for (const rule of rules) {
    let verdict;
    try {
      verdict = rule.evaluate(ctx);
    } catch (err) {
      verdict = {
        fired: false,
        reason: `rule_error:${err.message}`,
      };
    }
    verdicts.push({
      ruleId: rule.id,
      name: rule.name,
      weight: rule.weight ?? 1,
      fired: !!verdict?.fired,
      reason: verdict?.reason || null,
      details: verdict?.details || null,
    });
  }

  const decision = aggregate(verdicts);

  return {
    ...decision,
    verdicts,
    rulesEvaluated: rules.length,
  };
};
