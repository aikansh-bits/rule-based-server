/**
 * Generic shape for every JSON response from the mock API endpoints.
 * Keeps the wire contract uniform so the analyser frontend can rely on a
 * single envelope.
 */
export const createResponse = ({ success, message, data, meta }) => ({
  success,
  message,
  ...(data !== undefined ? { data } : {}),
  ...(meta !== undefined ? { meta } : {}),
});

/** Convenience: ISO-8601 UTC timestamp (the only timezone you should log in). */
export const isoNow = () => new Date().toISOString();
