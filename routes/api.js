import express from "express";
import { v4 as uuidv4 } from "uuid";
import { createResponse, isoNow } from "../utils/helper.js";
import { sleep, elapsedMs, now } from "../utils/time.js";
import { noteFailedLogin } from "../middleware/detection.js";

const router = express.Router();

/**
 * Mock business endpoints used as targets for both legitimate and malicious
 * traffic in the experiments. The implementations are deliberately simple but
 * model realistic latency profiles so that response times include both
 * detection time and "real work" time.
 */

const trackInternalLatency = (req, ms) => {
  if (req.ctx) req.ctx.internalLatencyMs = round(ms);
};

const setEndpointClass = (req, name) => {
  if (req.ctx) req.ctx.endpointClass = name;
};

// POST /api/login
router.post("/login", async (req, res) => {
  setEndpointClass(req, "/login");
  const start = now();

  const { username, password } = req.body || {};
  if (!username || !password) {
    noteFailedLogin(req);
    trackInternalLatency(req, elapsedMs(start));
    return res.status(400).json(
      createResponse({
        success: false,
        message: "Username and password are required",
        meta: { requestId: req.id },
      }),
    );
  }

  await sleep(20 + Math.random() * 60);

  // Treat any password equal to "password" or starting with "test" as valid for
  // the simulation. Everything else fails — this lets the brute-force rule fire
  // naturally during malicious-traffic experiments.
  const valid = password === "password" || /^test/i.test(password);
  if (!valid) {
    noteFailedLogin(req);
    trackInternalLatency(req, elapsedMs(start));
    return res.status(401).json(
      createResponse({
        success: false,
        message: "Invalid credentials",
        meta: { requestId: req.id },
      }),
    );
  }

  trackInternalLatency(req, elapsedMs(start));
  return res.status(200).json(
    createResponse({
      success: true,
      message: "User logged in successfully",
      data: { userId: uuidv4(), token: uuidv4() },
      meta: { requestId: req.id, endpoint: "/login", timestamp: isoNow() },
    }),
  );
});

// GET /api/data
router.get("/data", async (req, res) => {
  setEndpointClass(req, "/data");
  const start = now();
  await sleep(10 + Math.random() * 80);
  trackInternalLatency(req, elapsedMs(start));

  return res.status(200).json(
    createResponse({
      success: true,
      message: "Data fetched successfully",
      data: {
        items: ["item1", "item2", "item3"].map((label) => ({
          id: uuidv4(),
          label,
        })),
      },
      meta: { requestId: req.id, endpoint: "/data", timestamp: isoNow() },
    }),
  );
});

// POST /api/payment
router.post("/payment", async (req, res) => {
  setEndpointClass(req, "/payment");
  const start = now();

  const { amount, currency = "USD" } = req.body || {};
  if (!Number.isFinite(amount) || amount <= 0) {
    trackInternalLatency(req, elapsedMs(start));
    return res.status(400).json(
      createResponse({
        success: false,
        message: "Invalid amount",
        meta: { requestId: req.id },
      }),
    );
  }

  await sleep(80 + Math.random() * 220);
  trackInternalLatency(req, elapsedMs(start));

  return res.status(200).json(
    createResponse({
      success: true,
      message: "Payment processed successfully",
      data: {
        transactionId: uuidv4(),
        amount,
        currency,
        status: "completed",
      },
      meta: { requestId: req.id, endpoint: "/payment", timestamp: isoNow() },
    }),
  );
});

// GET /api/search?q=...
router.get("/search", async (req, res) => {
  setEndpointClass(req, "/search");
  const start = now();
  await sleep(5 + Math.random() * 40);
  const q = String(req.query.q || "");
  trackInternalLatency(req, elapsedMs(start));
  return res.status(200).json(
    createResponse({
      success: true,
      message: "Search completed",
      data: { query: q, results: q ? [`${q} result A`, `${q} result B`] : [] },
      meta: { requestId: req.id, endpoint: "/search", timestamp: isoNow() },
    }),
  );
});

// GET /api/profile/:id
router.get("/profile/:id", async (req, res) => {
  setEndpointClass(req, "/profile/:id");
  const start = now();
  await sleep(15 + Math.random() * 60);
  trackInternalLatency(req, elapsedMs(start));
  return res.status(200).json(
    createResponse({
      success: true,
      message: "Profile fetched",
      data: {
        id: req.params.id,
        name: `User ${req.params.id}`,
        joinedAt: "2025-01-15T10:00:00Z",
      },
      meta: { requestId: req.id, endpoint: "/profile/:id", timestamp: isoNow() },
    }),
  );
});

// GET /api/echo - useful for traffic generators
router.get("/echo", (req, res) => {
  setEndpointClass(req, "/echo");
  return res.status(200).json(
    createResponse({
      success: true,
      message: "echo",
      data: { headers: req.headers, query: req.query },
      meta: { requestId: req.id, endpoint: "/echo", timestamp: isoNow() },
    }),
  );
});

const round = (n, d = 3) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export default router;
