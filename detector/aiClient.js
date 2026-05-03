import axios from "axios";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { elapsedMs, now } from "../utils/time.js";

/**
 * HTTP client for the AI-based detection server.
 *
 * Design notes:
 *   - The HTTP-level timeout is set to the per-call AI budget rather than the
 *     overall detection budget, so a slow AI server can't blow past the
 *     latency SLA on its own. The outer `withBudget` wrapper still enforces
 *     the *overall* budget across rules + AI.
 *   - We intentionally do NOT retry on timeout: a retry would only burn more
 *     of the latency budget. Retries are reserved for connection-reset
 *     failures, which usually indicate a transient socket issue rather than
 *     an overload.
 *   - The client surfaces precise latency (rounded to 3 dp ms) so the
 *     dissertation can attribute time spent to the AI subsystem accurately.
 */

const log = logger.child({ component: "ai-client" });

const client = axios.create({
  baseURL: config.aiServer.baseUrl,
  timeout: config.aiServer.timeoutMs,
  headers: { "content-type": "application/json" },
  // Don't throw on 4xx/5xx — we handle those explicitly so we can log structure.
  validateStatus: () => true,
});

let circuitOpenUntil = 0;
let consecutiveFailures = 0;

const tripCircuit = () => {
  consecutiveFailures += 1;
  if (consecutiveFailures >= config.aiServer.circuitBreaker.failureThreshold) {
    circuitOpenUntil = Date.now() + config.aiServer.circuitBreaker.openMs;
    log.warn("circuit_breaker_opened", {
      consecutiveFailures,
      reopensAt: new Date(circuitOpenUntil).toISOString(),
    });
  }
};

const resetCircuit = () => {
  if (consecutiveFailures > 0 || circuitOpenUntil > 0) {
    log.info("circuit_breaker_reset", { afterFailures: consecutiveFailures });
  }
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
};

const isCircuitOpen = () => Date.now() < circuitOpenUntil;

/**
 * Call the AI server's /detect endpoint.
 *
 * `payload` should be the feature dictionary expected by the AI server. We let
 * the AI server own its own schema; this client is deliberately a thin
 * pass-through so that updating the model's input does not require code
 * changes here.
 *
 * Returns a tagged result envelope:
 *   { ok: true,  data, latency_ms, status }
 *   { ok: false, error, latency_ms, status }
 */
export const callAiDetector = async (payload, opts = {}) => {
  const start = now();
  const timeoutMs = opts.timeoutMs ?? config.aiServer.timeoutMs;

  if (isCircuitOpen()) {
    return {
      ok: false,
      error: "circuit_open",
      latency_ms: 0,
      status: 0,
    };
  }

  try {
    const res = await client.post("/detect", payload, { timeout: timeoutMs });
    const latency_ms = round(elapsedMs(start));

    if (res.status < 200 || res.status >= 300) {
      tripCircuit();
      return {
        ok: false,
        error: `http_${res.status}`,
        latency_ms,
        status: res.status,
        body: typeof res.data === "object" ? res.data : null,
      };
    }

    resetCircuit();
    return {
      ok: true,
      data: res.data,
      latency_ms,
      status: res.status,
    };
  } catch (err) {
    const latency_ms = round(elapsedMs(start));
    const code = err.code || (err.message?.includes("timeout") ? "ETIMEDOUT" : "EUNKNOWN");
    tripCircuit();
    log.warn("ai_call_failed", { code, message: err.message, latency_ms });
    return {
      ok: false,
      error: code,
      latency_ms,
      status: 0,
    };
  }
};

/** Cheap probe used by /ready to verify the AI server is reachable. */
export const pingAiServer = async (timeoutMs = 1500) => {
  const start = now();
  try {
    const res = await client.get("/health", { timeout: timeoutMs });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      latency_ms: round(elapsedMs(start)),
      body: res.data,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latency_ms: round(elapsedMs(start)),
      error: err.message,
    };
  }
};

export const aiCircuitState = () => ({
  open: isCircuitOpen(),
  consecutiveFailures,
  reopensAt: circuitOpenUntil ? new Date(circuitOpenUntil).toISOString() : null,
});

const round = (n, d = 3) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
