import { rateLimitPerIp } from "./rateLimitPerIp.js";
import { burstDetector } from "./burstDetector.js";
import { failedAuthBruteForce } from "./failedAuthBruteForce.js";
import { endpointScanning } from "./endpointScanning.js";
import { suspiciousUserAgent } from "./suspiciousUserAgent.js";
import { missingHeaders } from "./missingHeaders.js";
import { ipBlocklist } from "./ipBlocklist.js";
import { sqlInjection } from "./sqlInjection.js";
import { xss } from "./xss.js";
import { pathTraversal } from "./pathTraversal.js";
import { commandInjection } from "./commandInjection.js";
import { oversizedPayload } from "./oversizedPayload.js";
import { httpMethodAbuse } from "./httpMethodAbuse.js";
import { botLikeTiming } from "./botLikeTiming.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

const log = logger.child({ component: "rule-engine" });

// Order matters: cheap exact-match rules first, regex/structural last.
const ALL_RULES = [
  ipBlocklist,
  rateLimitPerIp,
  burstDetector,
  failedAuthBruteForce,
  endpointScanning,
  oversizedPayload,
  httpMethodAbuse,
  missingHeaders,
  suspiciousUserAgent,
  pathTraversal,
  sqlInjection,
  xss,
  commandInjection,
  botLikeTiming,
];

const DISABLED_SET = new Set(
  (config.rules.disabled || []).map((s) => String(s).toLowerCase()),
);

/**
 * The active rule set is `ALL_RULES` minus anything in `DISABLED_RULES`.
 * Filtering happens once at module load time, so the engine's per-request
 * cost is unaffected. The full set remains visible via `ruleCatalog` so the
 * analyser frontend (and the dissertation's Methodology section) can show
 * which rules were active and which were intentionally omitted.
 */
export const rules = ALL_RULES.filter((r) => !DISABLED_SET.has(r.id.toLowerCase()));

export const ruleCatalog = ALL_RULES.map((r) => ({
  id: r.id,
  name: r.name,
  weight: r.weight ?? 1,
  disabled: DISABLED_SET.has(r.id.toLowerCase()),
}));

if (DISABLED_SET.size > 0) {
  log.info("rules_disabled", {
    disabled: Array.from(DISABLED_SET),
    activeCount: rules.length,
    totalCount: ALL_RULES.length,
  });
} else {
  log.info("rules_active", { activeCount: rules.length });
}
