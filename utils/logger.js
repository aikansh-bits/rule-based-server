import { config } from "../config/index.js";

/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line on stdout, which makes the logs trivially
 * parseable by Render/Vercel/CloudWatch and easy to grep during experiments.
 * In development, falls back to a colourised pretty form for readability.
 */

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LEVEL_NAMES = Object.fromEntries(
  Object.entries(LEVELS).map(([k, v]) => [v, k.toUpperCase()]),
);

const activeLevel = LEVELS[(config.logLevel || "info").toLowerCase()] ?? LEVELS.info;
const isDev = config.env !== "production";

const COLORS = {
  TRACE: "\x1b[90m",
  DEBUG: "\x1b[36m",
  INFO: "\x1b[32m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
  FATAL: "\x1b[35m",
  RESET: "\x1b[0m",
  DIM: "\x1b[2m",
};

const format = (levelNum, msg, fields) => {
  const levelName = LEVEL_NAMES[levelNum];
  const time = new Date().toISOString();

  if (!isDev) {
    return JSON.stringify({ time, level: levelName.toLowerCase(), msg, ...fields });
  }

  const c = COLORS[levelName] || "";
  const reset = COLORS.RESET;
  const dim = COLORS.DIM;
  const tag = `${c}${levelName.padEnd(5)}${reset}`;
  const tail = fields && Object.keys(fields).length
    ? ` ${dim}${JSON.stringify(fields)}${reset}`
    : "";
  return `${dim}${time}${reset} ${tag} ${msg}${tail}`;
};

const log = (levelNum, msg, fields) => {
  if (levelNum < activeLevel) return;
  const line = format(levelNum, msg, fields);
  if (levelNum >= LEVELS.error) {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
};

const make = (levelNum) => (msgOrObj, maybeFields) => {
  if (typeof msgOrObj === "string") return log(levelNum, msgOrObj, maybeFields);
  const { msg = "", ...rest } = msgOrObj || {};
  return log(levelNum, msg, rest);
};

export const logger = {
  trace: make(LEVELS.trace),
  debug: make(LEVELS.debug),
  info: make(LEVELS.info),
  warn: make(LEVELS.warn),
  error: make(LEVELS.error),
  fatal: make(LEVELS.fatal),
  child: (bindings) => ({
    trace: (m, f) => logger.trace(m, { ...bindings, ...f }),
    debug: (m, f) => logger.debug(m, { ...bindings, ...f }),
    info: (m, f) => logger.info(m, { ...bindings, ...f }),
    warn: (m, f) => logger.warn(m, { ...bindings, ...f }),
    error: (m, f) => logger.error(m, { ...bindings, ...f }),
    fatal: (m, f) => logger.fatal(m, { ...bindings, ...f }),
  }),
};
