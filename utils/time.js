/**
 * High-resolution timing helpers used everywhere latency matters.
 *
 * `process.hrtime.bigint()` gives nanosecond resolution and is monotonic, so it
 * is unaffected by NTP adjustments mid-experiment. We expose helpers that
 * return milliseconds as floats (for sub-millisecond fidelity).
 */

export const now = () => process.hrtime.bigint();

export const elapsedMs = (start) => Number(process.hrtime.bigint() - start) / 1e6;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isoTimestamp = () => new Date().toISOString();
