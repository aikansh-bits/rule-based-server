/**
 * Per-IP rolling state shared across rules.
 * In-memory only; sufficient for the experimental setup of this dissertation.
 */
const ipState = new Map();

const emptyState = () => ({
  timestamps: [], // request times (ms epoch) within the largest tracked window
  paths: [], // [{ path, t }] for endpoint-scanning detection
  loginFails: [], // ms epoch of failed /login attempts
});

export const getIpState = (ip) => {
  let s = ipState.get(ip);
  if (!s) {
    s = emptyState();
    ipState.set(ip, s);
  }
  return s;
};

/**
 * Drop entries older than maxAgeMs across all per-IP buckets.
 * Called by the rule engine on every request to keep memory bounded.
 */
export const pruneIpState = (ip, now, maxAgeMs) => {
  const s = ipState.get(ip);
  if (!s) return;
  s.timestamps = s.timestamps.filter((t) => now - t <= maxAgeMs);
  s.paths = s.paths.filter((p) => now - p.t <= maxAgeMs);
  s.loginFails = s.loginFails.filter((t) => now - t <= maxAgeMs);
};

export const recordFailedLogin = (ip, now = Date.now()) => {
  getIpState(ip).loginFails.push(now);
};

/** For tests / metrics reset. */
export const _resetState = () => ipState.clear();
