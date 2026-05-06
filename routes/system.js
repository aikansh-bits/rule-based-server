import express from "express";
import os from "node:os";
import { config } from "../config/index.js";
import { ruleCatalog } from "../detector/rules/index.js";
import { aiCircuitState, pingAiServer } from "../detector/aiClient.js";
import { createResponse, isoNow } from "../utils/helper.js";

const router = express.Router();

/**
 * Liveness probe — does *not* depend on the AI server. As long as this
 * process can answer, the rule-based pipeline is operable (rules can run
 * without the AI; the AI mode will simply degrade to fallback).
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: config.serviceName,
    version: config.serviceVersion,
    uptimeSec: Math.round(process.uptime()),
    timestamp: isoNow(),
  });
});

/**
 * Readiness probe — also pings the AI server so deployers can distinguish
 * "process up" from "downstream healthy". Returns 200 either way; the
 * `aiServer.reachable` flag carries the truth so the dashboard can show
 * a degraded state rather than a hard failure.
 *
 * The AI ping uses a generous 8 second timeout because Render's free tier
 * puts services to sleep after 15 minutes idle. A typical cold start
 * takes 30-60 s, but even an 8 s wait is enough to confirm the AI is up
 * once it has finished waking — this prevents a freshly-loaded dashboard
 * from showing "AI unreachable" for the entire wake-up window.
 */
router.get("/ready", async (req, res) => {
  const aiPing = await pingAiServer(8000);
  res.status(200).json({
    status: "ready",
    service: config.serviceName,
    version: config.serviceVersion,
    aiServer: {
      url: config.aiServer.baseUrl,
      reachable: aiPing.ok,
      status: aiPing.status,
      latencyMs: aiPing.latency_ms,
      circuit: aiCircuitState(),
    },
    timestamp: isoNow(),
  });
});

router.get("/version", (req, res) => {
  res.status(200).json({
    service: config.serviceName,
    version: config.serviceVersion,
    env: config.env,
    node: process.version,
    pid: process.pid,
    host: os.hostname(),
    timestamp: isoNow(),
  });
});

/**
 * Catalog of detection capabilities. Used by the analyser frontend to render
 * which rules are configured and what their weights are, so legends/tooltips
 * stay in sync with the server without hard-coding.
 */
router.get("/catalog", (req, res) => {
  res.status(200).json(
    createResponse({
      success: true,
      message: "Detection catalog",
      data: {
        rules: ruleCatalog,
        ruleEngine: config.ruleEngine,
        detection: {
          defaultMode: config.detection.defaultMode,
          defaultBudgetMs: config.detection.budgetMs,
          fallbackDecision: config.detection.fallbackDecision,
          allowHeaderOverrides: config.detection.allowHeaderOverrides,
        },
        aiServer: {
          url: config.aiServer.baseUrl,
          timeoutMs: config.aiServer.timeoutMs,
          scoreThreshold: config.aiServer.scoreThreshold,
        },
      },
    }),
  );
});

export default router;
