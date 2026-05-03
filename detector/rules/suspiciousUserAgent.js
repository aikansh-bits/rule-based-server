const BAD_UA = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /acunetix/i,
  /fuzz/i,
  /\bcurl\//i,
  /\bwget\//i,
  /python-requests/i,
  /go-http-client/i,
  /libwww-perl/i,
];

export const suspiciousUserAgent = {
  id: "suspicious_user_agent",
  name: "Suspicious or missing User-Agent",
  weight: 0.5,
  evaluate(ctx) {
    const ua = (ctx.headers["user-agent"] || "").trim();
    if (!ua) {
      return { fired: true, reason: "missing_user_agent" };
    }
    const hit = BAD_UA.find((re) => re.test(ua));
    if (hit) {
      return {
        fired: true,
        reason: "suspicious_user_agent",
        details: { ua, pattern: hit.toString() },
      };
    }
    return { fired: false };
  },
};
