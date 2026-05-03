export const endpointScanning = {
  id: "endpoint_scanning",
  name: "Endpoint scanning (many distinct paths in short time)",
  weight: 1.0,
  evaluate(ctx) {
    const { state, now, config } = ctx;
    const { windowMs, distinctPaths } = config.rules.scan;
    const distinct = new Set(
      state.paths.filter((p) => now - p.t <= windowMs).map((p) => p.path),
    );

    if (distinct.size >= distinctPaths) {
      return {
        fired: true,
        reason: "endpoint_scanning",
        details: { distinct: distinct.size, windowMs, threshold: distinctPaths },
      };
    }
    return { fired: false };
  },
};
