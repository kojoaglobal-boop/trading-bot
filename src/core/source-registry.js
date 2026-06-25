import { sourceCatalog } from "../config/sources.js";

export function getSourceStatuses(env = process.env, catalog = sourceCatalog) {
  return catalog.map((source) => {
    const missingEnv = (source.requiredEnv || []).filter((key) => !env[key]);

    return {
      ...source,
      configured: missingEnv.length === 0,
      missingEnv
    };
  });
}

export function formatSourceStatuses(statuses) {
  const lines = [];

  lines.push("Trading Bot Sources");
  lines.push("===================");

  for (const source of statuses) {
    const status = source.configured ? "configured" : "missing keys";
    lines.push("");
    lines.push(`${source.label} [${status}]`);
    lines.push(`  id:      ${source.id}`);
    lines.push(`  kind:    ${source.kind}`);
    lines.push(`  mode:    ${source.mode}`);
    lines.push(`  covers:  ${source.covers.join(", ")}`);
    lines.push(`  cost:    ${source.cost}`);
    lines.push(`  purpose: ${source.purpose}`);

    if (source.missingEnv.length) {
      lines.push(`  missing: ${source.missingEnv.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function summarizeBarSources(bars) {
  const summary = new Map();

  for (const bar of bars) {
    const source = bar.source || {
      provider: "unknown",
      mode: "unknown"
    };
    const key = [
      source.provider || "unknown",
      source.mode || "unknown",
      bar.venue || "unknown"
    ].join("|");

    const existing = summary.get(key) || {
      provider: source.provider || "unknown",
      mode: source.mode || "unknown",
      venue: bar.venue || "unknown",
      symbols: new Set(),
      assetClasses: new Set(),
      bars: 0,
      firstTime: bar.time,
      lastTime: bar.time
    };

    existing.symbols.add(bar.symbol);
    existing.assetClasses.add(bar.assetClass);
    existing.bars += 1;
    if (Date.parse(bar.time) < Date.parse(existing.firstTime)) {
      existing.firstTime = bar.time;
    }
    if (Date.parse(bar.time) > Date.parse(existing.lastTime)) {
      existing.lastTime = bar.time;
    }
    summary.set(key, existing);
  }

  return [...summary.values()].map((item) => ({
    ...item,
    symbols: [...item.symbols].sort(),
    assetClasses: [...item.assetClasses].sort()
  }));
}
