import { v4 as uuidv4 } from "uuid";

/**
 * Attaches a correlation ID to every request and echoes it on the response so
 * the simulation panel can stitch its client-side timing back to the JSONL
 * record on the server. Honours an inbound `X-Request-Id` if the caller
 * supplies one (useful for log correlation across services).
 */
export const correlationId = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const id = incoming && /^[a-zA-Z0-9_\-]{8,128}$/.test(incoming) ? incoming : uuidv4();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
};
