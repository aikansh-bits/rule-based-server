# rule-based-server

Rule-based API abuse detection server with **latency-budgeted** hybrid escalation
to an AI-based detector. Built as the primary detection pipeline for the
dissertation **"Experimental Analysis of Latency–Accuracy Trade-offs in
Real-Time API Abuse Detection Systems."**

The service exposes a small mock API (`/api/login`, `/api/data`, `/api/payment`,
`/api/search`, `/api/profile/:id`, `/api/echo`) and runs every incoming request
through a configurable detection pipeline before it reaches the route handler.

---

## Highlights

- **14-rule detection engine** covering rate-limiting, burst behaviour, brute
  force, endpoint scanning, payload size, HTTP method abuse, suspicious
  user-agents, missing headers, IP blocklists, SQL injection, XSS, path
  traversal, command injection, and bot-like timing.
- **Three detection modes**: `rule`, `ai`, `hybrid` — switchable per-request via
  the `X-Detection-Mode` header.
- **Strict latency budget** (`X-Detection-Budget-Ms`) enforced via
  `Promise.race` with a clean fallback path. Every request records whether
  the budget was exceeded and which fallback was applied.
- **Per-request ground truth** (`X-Ground-Truth: malicious|legitimate`) so the
  experiment harness in the analyser frontend can compute precision, recall,
  FPR, and F1 directly from the JSONL output.
- **JSONL metrics** written to `metrics/runs/<run-id>.jsonl`; one row per
  detection. Read back via the `/metrics` API and rendered by the analyser
  dashboard.
- **AI client with circuit breaker** so a slow or unavailable AI server can't
  drag the rule pipeline below its SLA.
- **Production-shaped middleware stack**: CORS, security headers, structured
  JSON logging, correlation IDs, central error handler, graceful shutdown.

---

## Quickstart

```bash
cp .env.example .env
npm install
npm run dev      # node --watch
# or
npm start        # plain node
```

Server defaults to `http://localhost:3000`.

A few smoke calls:

```bash
# Healthy
curl -s localhost:3000/health | jq

# Mode + budget per request
curl -s -X POST localhost:3000/api/login \
  -H 'content-type: application/json' \
  -H 'x-detection-mode: rule' \
  -H 'x-detection-budget-ms: 25' \
  -H 'x-ground-truth: legitimate' \
  -H 'x-run-id: smoke-test' \
  -d '{"username":"alice","password":"password"}' | jq

# Trigger SQLi rule
curl -s "localhost:3000/api/search?q=1%27%20OR%20%271%27%3D%271" \
  -H 'x-ground-truth: malicious' \
  -H 'x-run-id: smoke-test' | jq
```

Then read the run back:

```bash
curl -s "localhost:3000/metrics/runs/smoke-test/summary" | jq
```

---

## Endpoints

### Mock business API (`/api/*`) — subject to detection
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/login` | Mock login. Bad credentials feed the brute-force rule. |
| `GET`  | `/api/data` | Returns sample items. |
| `POST` | `/api/payment` | Mock payment, slower latency. |
| `GET`  | `/api/search` | Echoes the `q` query (a common SQLi/XSS surface). |
| `GET`  | `/api/profile/:id` | Profile lookup by id. |
| `GET`  | `/api/echo` | Echo headers/query — useful for traffic generators. |

### System
| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service banner |
| `GET` | `/health` | Liveness — does not depend on the AI server |
| `GET` | `/ready` | Readiness — pings AI server, reports circuit state |
| `GET` | `/version` | Runtime info (node, pid, host) |
| `GET` | `/catalog` | Rules + detection config (used by analyser legends) |

### Metrics
| Method | Path | Description |
|---|---|---|
| `GET` | `/metrics` | Overview + recent runs |
| `GET` | `/metrics/runs` | List of all runs on disk |
| `GET` | `/metrics/runs/:id` | Raw JSONL rows (paginated via `?limit=&offset=`) |
| `GET` | `/metrics/runs/:id/summary` | Aggregated stats (accuracy, p95 latency, etc.) |
| `DEL` | `/metrics/runs/:id` | Delete a run (disabled in prod by default) |

---

## Per-request control headers

The simulation panel uses these to drive experiments:

| Header | Values | Effect |
|---|---|---|
| `X-Detection-Mode` | `rule` \| `ai` \| `hybrid` | Override the default pipeline |
| `X-Detection-Budget-Ms` | integer (ms) | Override the latency budget |
| `X-Ground-Truth` | `malicious` \| `legitimate` \| `unknown` | Label this request for accuracy metrics |
| `X-Run-Id` | string | Group records into a named run file |
| `X-Scenario` | string | Free-form tag stored on each row |
| `X-Request-Id` | string | Reuse a client-side correlation id |

All can be disabled in one place by setting `ALLOW_HEADER_OVERRIDES=false`.

The server echoes these response headers for client-side analysis without
having to parse the JSON body:

| Response header | Meaning |
|---|---|
| `X-Request-Id` | Correlation id |
| `X-Decision` | `allow` \| `block` |
| `X-Decision-Source` | `rule` \| `ai` \| `fallback` \| `none` |
| `X-Detection-Latency-Ms` | High-resolution server-side detection time |

---

## JSONL row shape

Each detected request is appended as a single line to
`metrics/runs/<run-id>.jsonl`:

```jsonc
{
  "run_id": "experiment-A",
  "request_id": "ad1c…",
  "ts": "2026-05-02T12:34:56.789Z",
  "ip": "127.0.0.1",
  "method": "POST",
  "path": "/api/login",
  "endpoint_class": "/login",
  "status": 429,
  "ground_truth": "malicious",
  "mode": "hybrid",
  "budget_ms": 50,
  "scenario": "burst-100",
  "decision": "block",
  "decision_source": "rule",
  "blocked": true,
  "fallback_used": false,
  "fallback_reason": null,
  "budget_exceeded": false,
  "rule": { "evaluated": 14, "fired_ids": ["burst_detector"], "fired_count": 1, "score": 1, "latency_ms": 0.43 },
  "ai":   { "called": false, "is_anomaly": false, "score": 0, "latency_ms": 0, "error": null },
  "detection_latency_ms": 0.51,
  "internal_latency_ms": null,
  "response_time_ms": 0.92,
  "user_agent": "node-fetch/1.0",
  "request_size": 41
}
```

---

## Architecture

```
       ┌─────────────────────────────────────────────────────────┐
       │                     Express app                         │
       │                                                         │
client │   correlationId → CORS → securityHeaders → bodyParser   │
──────►│   → httpLogger → requestContext → responseTimer         │
       │   ─── (system & metrics routes)                         │
       │   ─── (api routes guarded by detectionMiddleware) ──┐   │
       └─────────────────────────────────────────────────────┼───┘
                                                             │
                          ┌──────────────────────────────────┘
                          ▼
                 ┌────────────────┐    rules fire? block.
                 │  rule engine   │────────────────────────────► 429
                 │ (14 rules)     │
                 └────────┬───────┘
                          │ (mode = hybrid or ai)
                          ▼
                 ┌────────────────┐    is_anomaly or score≥thr?
                 │   AI client    │─────────► AI-based-server
                 │ + circuit br.  │           (Python/FastAPI)
                 └────────┬───────┘
                          │
                  withBudget(rules + ai, budgetMs)
                          │
                          ▼
                  decision → headers + JSONL row
```

---

## Configuration

All settings come from environment variables; see [`.env.example`](./.env.example)
for the full list. Notable groups:

- **Detection**: `DETECTION_BUDGET_MS`, `FALLBACK_DECISION`, `DETECTION_MODE`
- **Rule engine**: `RULE_AGGREGATION`, `RULE_SCORE_THRESHOLD`
- **Per-rule thresholds**: `RATE_LIMIT_*`, `BURST_*`, `BRUTE_FORCE_*`, `SCAN_*`
- **AI server**: `AI_SERVER_URL`, `AI_SERVER_TIMEOUT_MS`, `AI_SCORE_THRESHOLD`, `AI_CB_*`
- **Metrics**: `METRICS_DIR`, `METRICS_FLUSH_INTERVAL_MS`, `RUN_ID`

---

## Docker

```bash
docker build -t rule-based-server .
docker run --rm -p 3000:3000 \
  -e AI_SERVER_URL=http://host.docker.internal:8000 \
  -e CORS_ORIGINS=http://localhost:3001 \
  -v "$PWD/metrics/runs":/app/metrics/runs \
  rule-based-server
```

---

## Project layout

```
rule-based-server/
├── server.js                  # process entry: bind port, graceful shutdown
├── app.js                     # Express app factory (testable)
├── config/                    # env-driven, typed configuration
├── detector/
│   ├── engine.js              # rule runner + aggregation
│   ├── state.js               # per-IP rolling state
│   ├── aiClient.js            # axios client + circuit breaker
│   └── rules/                 # 14 rules + index + catalog
├── latency/
│   └── withBudget.js          # Promise.race + fallback envelope
├── metrics/
│   ├── store.js               # JSONL writer with buffered flush
│   ├── aggregator.js          # per-run accuracy/latency stats
│   └── runs/                  # output JSONL files (gitignored)
├── middleware/
│   ├── correlationId.js
│   ├── cors.js
│   ├── securityHeaders.js
│   ├── httpLogger.js
│   ├── requestContext.js
│   ├── responseTimer.js
│   ├── detection.js           # ← orchestrates rules + AI under budget
│   ├── notFound.js
│   └── errorHandler.js
├── routes/
│   ├── api.js                 # mock business endpoints
│   ├── system.js              # /health /ready /version /catalog
│   └── metrics.js             # JSONL read API
└── utils/
    ├── logger.js              # structured JSON logger
    ├── time.js                # hrtime helpers
    ├── stats.js               # percentile + classification metrics
    └── helper.js              # response envelope
```

---

## License

MIT — academic use.
