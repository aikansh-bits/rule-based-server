import fs from "node:fs";
import path from "node:path";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Per-run JSONL writer.
 *
 * Every detected request appends one line to `metrics/runs/<run_id>.jsonl`.
 * Writes are buffered and flushed on an interval so we don't fsync on every
 * request (which would itself add measurable latency to the very thing we are
 * measuring). Flushes also happen on process exit signals.
 *
 * Files are JSON Lines because:
 *   - they are append-only and crash-safe (a partial write is one bad line);
 *   - they are trivial to stream/parse from the analyser frontend;
 *   - each row is a self-contained record that can be cited in the dissertation.
 */

const safeRunId = (s) => String(s || "").replace(/[^a-zA-Z0-9_.\-]/g, "_").slice(0, 96);

const buffers = new Map();
const writeStreams = new Map();
const runMeta = new Map();
let flushTimer = null;
let isShuttingDown = false;

const log = logger.child({ component: "metrics/store" });

const ensureDir = () => {
  if (!fs.existsSync(config.metrics.dir)) {
    fs.mkdirSync(config.metrics.dir, { recursive: true });
  }
};

const streamFor = (runId) => {
  const safe = safeRunId(runId);
  if (writeStreams.has(safe)) return writeStreams.get(safe);

  ensureDir();
  const file = path.join(config.metrics.dir, `${safe}.jsonl`);
  const stream = fs.createWriteStream(file, { flags: "a" });
  stream.on("error", (err) => log.error("write_stream_error", { runId: safe, err: err.message }));
  writeStreams.set(safe, stream);
  if (!runMeta.has(safe)) {
    runMeta.set(safe, {
      runId: safe,
      file,
      startedAt: new Date().toISOString(),
      lastWriteAt: null,
      records: 0,
    });
  }
  log.info("run_initialised", { runId: safe, file });
  return stream;
};

const flushOne = (runId) => {
  const buf = buffers.get(runId);
  if (!buf || buf.length === 0) return;
  const stream = streamFor(runId);
  const chunk = buf.map((row) => JSON.stringify(row)).join("\n") + "\n";
  buffers.set(runId, []);
  stream.write(chunk);
  const meta = runMeta.get(safeRunId(runId));
  if (meta) {
    meta.lastWriteAt = new Date().toISOString();
    meta.records += buf.length;
  }
};

const flushAll = () => {
  for (const runId of buffers.keys()) flushOne(runId);
};

const startFlushTimer = () => {
  if (flushTimer) return;
  flushTimer = setInterval(flushAll, config.metrics.flushIntervalMs);
  flushTimer.unref?.();
};

/**
 * Append one detection record. The caller (detection middleware) is responsible
 * for shaping the row; this layer is intentionally agnostic to the schema so
 * we can evolve the record without churning the writer.
 */
export const recordDetection = (row) => {
  if (isShuttingDown) return;
  const runId = safeRunId(row.run_id || config.metrics.runId);
  const buf = buffers.get(runId) || [];
  buf.push(row);
  buffers.set(runId, buf);
  startFlushTimer();
};

/** Force a flush. Useful from tests and from /metrics endpoints before reading. */
export const flushNow = () => flushAll();

/** Currently known runs (those we've written to in this process). */
export const knownRuns = () => Array.from(runMeta.values());

/** Resolve the on-disk file path for a run, regardless of whether we wrote to it. */
export const fileForRun = (runId) =>
  path.join(config.metrics.dir, `${safeRunId(runId)}.jsonl`);

/** List runs by scanning the metrics directory. Used by the /metrics API. */
export const listRunFiles = () => {
  ensureDir();
  return fs
    .readdirSync(config.metrics.dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const full = path.join(config.metrics.dir, f);
      const stat = fs.statSync(full);
      return {
        runId: f.replace(/\.jsonl$/, ""),
        file: full,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
};

export const readRun = (runId) => {
  const file = fileForRun(runId);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return [];
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      log.warn("malformed_jsonl_line", { runId, error: err.message });
    }
  }
  return rows;
};

export const deleteRun = (runId) => {
  const file = fileForRun(runId);
  const safe = safeRunId(runId);
  if (writeStreams.has(safe)) {
    writeStreams.get(safe).end();
    writeStreams.delete(safe);
  }
  buffers.delete(safe);
  runMeta.delete(safe);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
};

/** Close all streams cleanly. Called from the graceful-shutdown path. */
export const shutdownStore = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  flushAll();
  if (flushTimer) clearInterval(flushTimer);
  await Promise.all(
    Array.from(writeStreams.values()).map(
      (s) => new Promise((resolve) => s.end(resolve)),
    ),
  );
  writeStreams.clear();
  log.info("metrics_store_closed");
};
