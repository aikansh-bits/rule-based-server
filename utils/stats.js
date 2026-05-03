/**
 * Statistical helpers used by the metrics aggregator.
 * All functions are non-mutating and tolerate empty inputs.
 */

export const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export const mean = (xs) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

export const min = (xs) => (xs.length === 0 ? 0 : Math.min(...xs));

export const max = (xs) => (xs.length === 0 ? 0 : Math.max(...xs));

export const stddev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
};

/**
 * Percentile via linear interpolation (NIST type 7, the default in NumPy).
 * `p` is in [0, 100]. Empty input -> 0.
 */
export const percentile = (xs, p) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
};

/** Convenience wrapper: returns p50/p90/p95/p99/mean/stddev/min/max in one pass. */
export const summarise = (xs) => ({
  count: xs.length,
  mean: round(mean(xs)),
  stddev: round(stddev(xs)),
  min: round(min(xs)),
  p50: round(percentile(xs, 50)),
  p90: round(percentile(xs, 90)),
  p95: round(percentile(xs, 95)),
  p99: round(percentile(xs, 99)),
  max: round(max(xs)),
});

const round = (n, d = 3) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

/**
 * Confusion-matrix derived classification metrics.
 * Convention: positive class = "malicious".
 *
 *   tp: ground_truth=malicious & decision=block
 *   fp: ground_truth=legitimate & decision=block
 *   tn: ground_truth=legitimate & decision=allow
 *   fn: ground_truth=malicious & decision=allow
 */
export const classificationMetrics = ({ tp, fp, tn, fn }) => {
  const total = tp + fp + tn + fn;
  const accuracy = total === 0 ? 0 : (tp + tn) / total;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const specificity = tn + fp === 0 ? 0 : tn / (tn + fp);
  const fpr = tn + fp === 0 ? 0 : fp / (tn + fp);
  const fnr = tp + fn === 0 ? 0 : fn / (tp + fn);
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    tp,
    fp,
    tn,
    fn,
    total,
    accuracy: round(accuracy, 4),
    precision: round(precision, 4),
    recall: round(recall, 4),
    specificity: round(specificity, 4),
    fpr: round(fpr, 4),
    fnr: round(fnr, 4),
    f1: round(f1, 4),
  };
};
