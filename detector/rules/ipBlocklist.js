export const ipBlocklist = {
  id: "ip_blocklist",
  name: "IP blocklist",
  weight: 1.0,
  evaluate(ctx) {
    const list = ctx.config.rules.ipBlocklist;
    if (!list || list.length === 0) return { fired: false };

    if (list.includes(ctx.ip)) {
      return { fired: true, reason: "ip_blocklisted", details: { ip: ctx.ip } };
    }
    return { fired: false };
  },
};
