import { formatOandaCandles, normalizeOandaCandles, OandaClient } from "../integrations/oanda-client.js";

export async function fetchOandaCandles({
  instrument = "XAU_USD",
  granularity = "H1",
  count = 120,
  price = "M",
  from,
  to,
  client = new OandaClient()
} = {}) {
  const payload = await client.getInstrumentCandles({
    instrument,
    granularity,
    count,
    price,
    from,
    to
  });

  return {
    provider: "oanda",
    instrument,
    granularity,
    bars: normalizeOandaCandles(payload, {
      instrument,
      granularity,
      environment: client.environment || "practice"
    })
  };
}

export function formatOandaMarketData({ bars }) {
  return formatOandaCandles(bars);
}
