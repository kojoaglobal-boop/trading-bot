import { CoinbaseClient, formatCoinbaseBars, normalizeCoinbaseCandles } from "../integrations/coinbase-client.js";
import { KrakenClient, formatKrakenBars, normalizeKrakenOhlc } from "../integrations/kraken-client.js";

const GRANULARITY_TO_SECONDS = {
  ONE_MINUTE: 60,
  FIVE_MINUTE: 5 * 60,
  FIFTEEN_MINUTE: 15 * 60,
  THIRTY_MINUTE: 30 * 60,
  ONE_HOUR: 60 * 60,
  TWO_HOUR: 2 * 60 * 60,
  FOUR_HOUR: 4 * 60 * 60,
  SIX_HOUR: 6 * 60 * 60,
  ONE_DAY: 24 * 60 * 60
};

export async function fetchCryptoBars({
  provider = "coinbase",
  product = "BTC-USD",
  pair = "BTC/USD",
  granularity = "ONE_HOUR",
  interval = 60,
  limit = 120,
  lookbackDays = 30,
  now = new Date(),
  coinbaseClient = new CoinbaseClient(),
  krakenClient = new KrakenClient()
} = {}) {
  if (provider === "coinbase") {
    const endSeconds = Math.floor(now.getTime() / 1000);
    const requestedStartSeconds = endSeconds - Number(lookbackDays) * 24 * 60 * 60;
    const maxWindowSeconds = Number(limit) * (GRANULARITY_TO_SECONDS[granularity] || 60 * 60);
    const startSeconds = Math.max(requestedStartSeconds, endSeconds - maxWindowSeconds);
    const payload = await coinbaseClient.getPublicProductCandles({
      productId: product,
      start: startSeconds,
      end: endSeconds,
      granularity,
      limit
    });
    return {
      provider,
      bars: normalizeCoinbaseCandles(payload, {
        productId: product,
        granularity
      })
    };
  }

  if (provider === "kraken") {
    const since = Math.floor((now.getTime() - Number(lookbackDays) * 24 * 60 * 60 * 1000) / 1000);
    const payload = await krakenClient.getOhlc({
      pair,
      interval,
      since
    });
    return {
      provider,
      bars: normalizeKrakenOhlc(payload, {
        requestedPair: pair,
        interval
      }).slice(-Number(limit))
    };
  }

  throw new Error(`Unsupported crypto data provider: ${provider}`);
}

export function formatCryptoBars({ provider, bars }) {
  if (provider === "coinbase") {
    return formatCoinbaseBars(bars);
  }

  if (provider === "kraken") {
    return formatKrakenBars(bars);
  }

  return `Unknown crypto provider: ${provider}`;
}
