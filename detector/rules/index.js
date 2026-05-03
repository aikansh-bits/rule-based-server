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

// Order matters: cheap exact-match rules first, regex/structural last.
export const rules = [
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

export const ruleCatalog = rules.map((r) => ({
  id: r.id,
  name: r.name,
  weight: r.weight ?? 1,
}));
