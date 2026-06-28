const OANDA_BASE_URLS = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com"
};

export class OandaClient {
  constructor({ env = process.env, fetchFn = globalThis.fetch } = {}) {
    this.environment = String(env.OANDA_ENV || "practice").trim().toLowerCase();
    this.accountId = env.OANDA_ACCOUNT_ID || "";
    this.apiToken = env.OANDA_API_TOKEN || "";
    this.baseUrl = trimTrailingSlash(
      env.OANDA_BASE_URL || OANDA_BASE_URLS[this.environment] || OANDA_BASE_URLS.practice
    );
    this.fetchFn = fetchFn;
  }

  isConfigured() {
    return Boolean(this.accountId && this.apiToken);
  }

  missingKeys() {
    const missing = [];
    if (!this.accountId) missing.push("OANDA_ACCOUNT_ID");
    if (!this.apiToken) missing.push("OANDA_API_TOKEN");
    return missing;
  }

  async getAccountSummary({ accountId = this.accountId } = {}) {
    if (!accountId) {
      throw new Error("OANDA account ID is required.");
    }
    return this.requestJson(`${this.baseUrl}/v3/accounts/${encodeURIComponent(accountId)}/summary`);
  }

  async getAccountInstruments({ accountId = this.accountId } = {}) {
    if (!accountId) {
      throw new Error("OANDA account ID is required.");
    }
    return this.requestJson(`${this.baseUrl}/v3/accounts/${encodeURIComponent(accountId)}/instruments`);
  }

  async getInstrumentCandles({
    instrument,
    granularity = "H1",
    count = 120,
    price = "M",
    from,
    to
  } = {}) {
    if (!instrument) {
      throw new Error("OANDA instrument is required.");
    }

    const url = new URL(`${this.baseUrl}/v3/instruments/${encodeURIComponent(normalizeInstrument(instrument))}/candles`);
    url.searchParams.set("granularity", String(granularity).toUpperCase());
    url.searchParams.set("price", String(price || "M").toUpperCase());
    if (count !== undefined && count !== null && count !== "") {
      url.searchParams.set("count", String(count));
    }
    if (from) {
      url.searchParams.set("from", from);
    }
    if (to) {
      url.searchParams.set("to", to);
    }

    return this.requestJson(url);
  }

  async requestJson(input) {
    if (!this.isConfigured()) {
      throw new Error(`Missing OANDA keys: ${this.missingKeys().join(", ")}`);
    }

    if (!this.fetchFn) {
      throw new Error("Fetch API is not available in this Node runtime.");
    }

    const response = await this.fetchFn(input, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        Accept: "application/json"
      }
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = payload.errorMessage || payload.errorCode || response.statusText;
      throw new Error(`OANDA request failed (${response.status}): ${message}`);
    }

    return payload;
  }
}

export function normalizeOandaCandles(payload, {
  instrument = payload.instrument,
  granularity = payload.granularity,
  environment = "practice"
} = {}) {
  const normalizedInstrument = normalizeInstrument(instrument);
  const symbol = instrumentToSymbol(normalizedInstrument);
  const assetClass = inferAssetClass(normalizedInstrument);
  const candles = payload.candles || [];

  return candles
    .filter((candle) => candle.complete !== false)
    .map((candle) => {
      const price = candle.mid || midpointPrice(candle.bid, candle.ask);

      return {
        time: new Date(candle.time).toISOString(),
        symbol,
        assetClass,
        venue: `oanda-${environment}`,
        open: Number(price.o),
        high: Number(price.h),
        low: Number(price.l),
        close: Number(price.c),
        volume: Number(candle.volume || 0),
        bid: candle.bid ? Number(candle.bid.c) : undefined,
        ask: candle.ask ? Number(candle.ask.c) : undefined,
        source: {
          provider: "oanda",
          mode: `${environment}-market-data`,
          instrument: normalizedInstrument,
          granularity
        }
      };
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function formatOandaCandles(bars, { limit = 8 } = {}) {
  const lines = [];
  lines.push("OANDA Candle Bars");
  lines.push("=================");

  if (!bars.length) {
    lines.push("No bars returned.");
    return lines.join("\n");
  }

  for (const bar of bars.slice(-limit)) {
    lines.push(
      `${bar.time} ${bar.symbol.padEnd(8)} ${bar.assetClass.padEnd(5)} close=${money(bar.close)} high=${money(bar.high)} low=${money(bar.low)} volume=${formatNumber(bar.volume)}`
    );
  }

  return lines.join("\n");
}

export function formatOandaAccountSummary(payload) {
  const account = payload.account || {};
  const lines = [];
  lines.push("OANDA Account Summary");
  lines.push("=====================");
  lines.push(`Alias:        ${account.alias || "n/a"}`);
  lines.push(`Currency:     ${account.currency || "n/a"}`);
  lines.push(`Balance:      ${money(account.balance)}`);
  lines.push(`NAV:          ${money(account.NAV)}`);
  lines.push(`Margin Used:  ${money(account.marginUsed)}`);
  lines.push(`Open Trades:  ${account.openTradeCount || 0}`);
  lines.push(`Open Positions: ${account.openPositionCount || 0}`);
  lines.push(`Pending Orders: ${account.pendingOrderCount || 0}`);
  return lines.join("\n");
}

export function formatOandaInstruments(payload, { limit = 30, focus = "XAU_USD" } = {}) {
  const instruments = payload.instruments || [];
  const focusInstrument = instruments.find((instrument) => instrument.name === focus);
  const rows = focusInstrument
    ? [focusInstrument, ...instruments.filter((instrument) => instrument.name !== focus).slice(0, Math.max(0, limit - 1))]
    : instruments.slice(0, limit);
  const lines = [];

  lines.push("OANDA Tradable Instruments");
  lines.push("==========================");
  lines.push(`Returned: ${instruments.length}`);

  if (!rows.length) {
    lines.push("No instruments returned.");
    return lines.join("\n");
  }

  for (const instrument of rows) {
    lines.push(
      `${String(instrument.name || "unknown").padEnd(12)} ${String(instrument.type || "unknown").padEnd(12)} ${instrument.displayName || ""}`
    );
  }

  return lines.join("\n");
}

export function normalizeInstrument(instrument) {
  return String(instrument || "").trim().toUpperCase().replace("/", "_").replace("-", "_");
}

export function instrumentToSymbol(instrument) {
  return normalizeInstrument(instrument).replace("_", "/");
}

function inferAssetClass(instrument) {
  const normalized = normalizeInstrument(instrument);
  if (normalized === "XAU_USD") {
    return "gold";
  }
  return "forex";
}

function midpointPrice(bid = {}, ask = {}) {
  return {
    o: average(bid.o, ask.o),
    h: average(bid.h, ask.h),
    l: average(bid.l, ask.l),
    c: average(bid.c, ask.c)
  };
}

function average(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return (a + b) / 2;
  }
  return Number.isFinite(a) ? a : b;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function money(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString("en-US", {
    maximumFractionDigits: number < 1 ? 8 : 2,
    minimumFractionDigits: 2
  })}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}
