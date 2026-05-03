import express from "express";
import { config } from "./config/index.js";

import { correlationId } from "./middleware/correlationId.js";
import { corsMiddleware, originGuard } from "./middleware/cors.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { httpLogger } from "./middleware/httpLogger.js";
import { requestContext } from "./middleware/requestContext.js";
import { responseTimer } from "./middleware/responseTimer.js";
import { detectionMiddleware } from "./middleware/detection.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";

import apiRoutes from "./routes/api.js";
import systemRoutes from "./routes/system.js";
import metricsRoutes from "./routes/metrics.js";
import { createResponse, isoNow } from "./utils/helper.js";

/**
 * Build the Express application.
 *
 * The factory pattern (vs constructing the app at module top-level) makes the
 * app trivially testable: tests can spin up isolated instances without
 * binding to a port.
 *
 * Middleware order (matters):
 *   1. trust proxy        — so req.ip reflects the real client behind Render/Vercel
 *   2. correlationId      — every log line and metric row carries this id
 *   3. corsMiddleware     — must run before any route or 404 handler
 *   4. securityHeaders    — cheap, applied everywhere
 *   5. body parsers       — capped to bodyLimit
 *   6. httpLogger         — access log (skips noisy paths)
 *   7. requestContext     — establish ctx, read header overrides
 *   8. responseTimer      — register `finish` hook BEFORE any responder
 *   9. system & metrics   — public, not subject to detection
 *  10. detectionMiddleware + apiRoutes — the experiment surface
 *  11. notFound, errorHandler — terminal handlers
 */
export const buildApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.set("etag", false);

  app.use(correlationId);
  app.use(corsMiddleware);
  app.use(originGuard);
  app.use(securityHeaders);

  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

  app.use(httpLogger);
  app.use(requestContext);
  app.use(responseTimer);

  app.get("/", (req, res) => {
    res.status(200).json(
      createResponse({
        success: true,
        message: `${config.serviceName} running`,
        data: {
          version: config.serviceVersion,
          env: config.env,
          docs: ["/health", "/ready", "/version", "/catalog", "/metrics", "/api/*"],
        },
        meta: { requestId: req.id, timestamp: isoNow() },
      }),
    );
  });

  app.use(systemRoutes);
  app.use("/metrics", metricsRoutes);

  app.use("/api", detectionMiddleware, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};
