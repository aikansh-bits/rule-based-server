import { buildApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { shutdownStore } from "./metrics/store.js";

/**
 * Process entrypoint. Responsible for:
 *   - listening on the configured port
 *   - logging unhandled errors
 *   - flushing the JSONL writer cleanly on shutdown so no records are lost
 */

const log = logger.child({ component: "server" });

const app = buildApp();

const server = app.listen(config.port, () => {
  log.info("listening", {
    port: config.port,
    env: config.env,
    service: config.serviceName,
    version: config.serviceVersion,
    runId: config.metrics.runId,
    detection: {
      mode: config.detection.defaultMode,
      budgetMs: config.detection.budgetMs,
      fallback: config.detection.fallbackDecision,
    },
    aiServer: config.aiServer.baseUrl,
  });
});

server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;

const shutdown = async (signal) => {
  log.warn("shutdown_signal_received", { signal });
  server.close(async () => {
    await shutdownStore();
    log.info("shutdown_complete");
    process.exit(0);
  });
  setTimeout(() => {
    log.error("shutdown_timeout_force_exit");
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log.error("unhandled_rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (err) => {
  log.fatal("uncaught_exception", { error: err.message, stack: err.stack });
  shutdown("uncaughtException");
});
