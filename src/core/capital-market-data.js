import {
  CapitalClient,
  formatCapitalPrices,
  normalizeCapitalPrices,
  normalizeCapitalResolution
} from "../integrations/capital-client.js";

export async function fetchCapitalPrices({
  epic = "GOLD",
  resolution = "MINUTE_5",
  count = 120,
  from,
  to,
  symbol,
  client = new CapitalClient()
} = {}) {
  const normalizedResolution = normalizeCapitalResolution(resolution);
  const payload = await client.getPrices({
    epic,
    resolution: normalizedResolution,
    max: count,
    from,
    to
  });

  return {
    provider: "capital",
    epic,
    resolution: normalizedResolution,
    bars: normalizeCapitalPrices(payload, {
      epic,
      resolution: normalizedResolution,
      environment: client.environment || "demo",
      symbol
    })
  };
}

export function formatCapitalMarketData({ bars }) {
  return formatCapitalPrices(bars);
}
