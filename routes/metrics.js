import express from "express";
import { listRunFiles, readRun, deleteRun, flushNow } from "../metrics/store.js";
import { aggregateRun } from "../metrics/aggregator.js";
import { createResponse } from "../utils/helper.js";
import { config } from "../config/index.js";

const router = express.Router();

/**
 * Read-only metrics API consumed by the analyser frontend.
 *
 *   GET /metrics                    -> server-level metrics overview
 *   GET /metrics/runs               -> list of all runs on disk
 *   GET /metrics/runs/:id           -> raw JSONL rows for a run (paginated)
 *   GET /metrics/runs/:id/summary   -> aggregated stats for a run
 *   DEL /metrics/runs/:id           -> remove a run (off by default in prod)
 */

router.get("/", (req, res) => {
  flushNow();
  const runs = listRunFiles();
  const totalBytes = runs.reduce((a, r) => a + r.sizeBytes, 0);
  res.status(200).json(
    createResponse({
      success: true,
      message: "Metrics overview",
      data: {
        activeRunId: config.metrics.runId,
        directory: config.metrics.dir,
        runCount: runs.length,
        totalBytes,
        runs: runs.slice(0, 25),
      },
    }),
  );
});

router.get("/runs", (req, res) => {
  flushNow();
  res.status(200).json(
    createResponse({
      success: true,
      message: "Runs",
      data: { runs: listRunFiles() },
    }),
  );
});

router.get("/runs/:id", (req, res) => {
  flushNow();
  const limit = clamp(Number(req.query.limit) || 1000, 1, 50_000);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = readRun(req.params.id);
  const total = rows.length;
  res.status(200).json(
    createResponse({
      success: true,
      message: `Run ${req.params.id}`,
      data: {
        runId: req.params.id,
        total,
        offset,
        limit,
        rows: rows.slice(offset, offset + limit),
      },
    }),
  );
});

router.get("/runs/:id/summary", (req, res) => {
  flushNow();
  const summary = aggregateRun(req.params.id);
  res.status(200).json(
    createResponse({
      success: true,
      message: `Summary for ${req.params.id}`,
      data: summary,
    }),
  );
});

router.delete("/runs/:id", (req, res) => {
  if (config.isProd && process.env.METRICS_ALLOW_DELETE !== "1") {
    return res.status(403).json(
      createResponse({
        success: false,
        message: "Delete disabled in production. Set METRICS_ALLOW_DELETE=1 to enable.",
      }),
    );
  }
  const ok = deleteRun(req.params.id);
  res.status(ok ? 200 : 404).json(
    createResponse({
      success: ok,
      message: ok ? `Run ${req.params.id} deleted` : `Run ${req.params.id} not found`,
    }),
  );
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export default router;
