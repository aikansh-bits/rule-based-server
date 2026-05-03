import { logger } from "../utils/logger.js";
import { createResponse } from "../utils/helper.js";

const log = logger.child({ component: "error-handler" });

/**
 * Central error handler.
 *
 * Express identifies error middleware by its arity (4), so the unused `next`
 * parameter is mandatory and intentional. We never leak stack traces in
 * production responses but we always log them server-side.
 */
export const errorHandler = (err, req, res, _next) => {
  const status = Number(err.status || err.statusCode) || 500;

  log.error({
    msg: "request_failed",
    requestId: req.id,
    method: req.method,
    path: req.path,
    status,
    error: err.message,
    stack: err.stack,
  });

  if (res.headersSent) return;

  res.status(status).json(
    createResponse({
      success: false,
      message: status >= 500 ? "Internal server error" : err.message,
      meta: { requestId: req.id },
    }),
  );
};
