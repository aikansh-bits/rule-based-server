/**
 * Run a (possibly async) detection function under a hard time budget.
 *
 * If the detector resolves within `budgetMs`, its result is returned with
 * `budget_exceeded: false`. If it takes longer, we resolve immediately with the
 * configured `fallback` decision and `budget_exceeded: true`. The detector
 * promise is allowed to resolve in the background but its result is discarded;
 * this matches the "fail-open / fail-closed under SLA" pattern described in
 * the dissertation.
 *
 * Per-request override: callers can pass a custom `budgetMs` (e.g. read from
 * the X-Detection-Budget-Ms header) to support latency sweeps in experiments.
 */
export const withBudget = async (detectionFn, { budgetMs, fallback }) => {
  const start = process.hrtime.bigint();

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ __timedOut: true });
    }, budgetMs);
  });

  let result;
  try {
    result = await Promise.race([
      Promise.resolve().then(() => detectionFn()),
      timeout,
    ]);
  } catch (err) {
    clearTimeout(timer);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      decision: fallback === "block" ? "block" : "allow",
      detection_latency_ms: elapsedMs,
      budget_ms: budgetMs,
      budget_exceeded: false,
      fallback_used: true,
      fallback_reason: `detector_error:${err.message}`,
      detail: null,
    };
  }
  clearTimeout(timer);

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (result && result.__timedOut) {
    return {
      decision: fallback === "block" ? "block" : "allow",
      detection_latency_ms: elapsedMs,
      budget_ms: budgetMs,
      budget_exceeded: true,
      fallback_used: true,
      fallback_reason: "budget_exceeded",
      detail: null,
    };
  }

  // Detector returned in time. Map its decision into our standard envelope.
  return {
    decision: result.blocked ? "block" : "allow",
    detection_latency_ms: elapsedMs,
    budget_ms: budgetMs,
    budget_exceeded: false,
    fallback_used: false,
    fallback_reason: null,
    detail: result,
  };
};
