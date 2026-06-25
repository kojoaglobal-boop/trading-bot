const DEFAULT_PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const DEFAULT_DATA_BASE_URL = "https://data.alpaca.markets";

export class AlpacaClient {
  constructor({ env = process.env, fetchFn = globalThis.fetch } = {}) {
    this.apiKey = env.ALPACA_API_KEY_ID || env.APCA_API_KEY_ID || "";
    this.secretKey = env.ALPACA_API_SECRET_KEY || env.APCA_API_SECRET_KEY || "";
    this.paperBaseUrl = trimTrailingSlash(
      env.ALPACA_BASE_URL || env.APCA_API_BASE_URL || DEFAULT_PAPER_BASE_URL
    );
    this.dataBaseUrl = trimTrailingSlash(env.ALPACA_DATA_BASE_URL || DEFAULT_DATA_BASE_URL);
    this.fetchFn = fetchFn;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.secretKey);
  }

  missingKeys() {
    const missing = [];
    if (!this.apiKey) missing.push("ALPACA_API_KEY_ID");
    if (!this.secretKey) missing.push("ALPACA_API_SECRET_KEY");
    return missing;
  }

  async getAccount() {
    return this.requestJson(`${this.paperBaseUrl}/v2/account`);
  }

  async getLatestStockBars({ symbols, feed = "iex" }) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new Error("At least one stock symbol is required.");
    }

    const url = new URL(`${this.dataBaseUrl}/v2/stocks/bars/latest`);
    url.searchParams.set("symbols", symbols.join(","));
    if (feed) {
      url.searchParams.set("feed", feed);
    }

    return this.requestJson(url);
  }

  async requestJson(input) {
    if (!this.isConfigured()) {
      throw new Error(`Missing Alpaca keys: ${this.missingKeys().join(", ")}`);
    }

    if (!this.fetchFn) {
      throw new Error("Fetch API is not available in this Node runtime.");
    }

    const response = await this.fetchFn(input, {
      headers: {
        "APCA-API-KEY-ID": this.apiKey,
        "APCA-API-SECRET-KEY": this.secretKey,
        Accept: "application/json"
      }
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = payload.message || payload.error || response.statusText;
      throw new Error(`Alpaca request failed (${response.status}): ${message}`);
    }

    return payload;
  }
}

export function formatAlpacaAccount(account) {
  const lines = [];
  lines.push("Alpaca Paper Account");
  lines.push("====================");
  lines.push(`Account ID:     ${account.id || "unknown"}`);
  lines.push(`Status:         ${account.status || "unknown"}`);
  lines.push(`Currency:       ${account.currency || "USD"}`);
  lines.push(`Buying Power:   ${money(account.buying_power)}`);
  lines.push(`Portfolio Value:${money(account.portfolio_value)}`);
  lines.push(`Cash:           ${money(account.cash)}`);
  lines.push(`Pattern Day Trader: ${String(Boolean(account.pattern_day_trader))}`);
  return lines.join("\n");
}

export function formatLatestBars(payload) {
  const bars = payload.bars || {};
  const symbols = Object.keys(bars).sort();
  const lines = [];
  lines.push("Alpaca Latest Stock Bars");
  lines.push("========================");

  if (!symbols.length) {
    lines.push("No bars returned.");
    return lines.join("\n");
  }

  for (const symbol of symbols) {
    const bar = bars[symbol];
    lines.push(
      `${symbol.padEnd(6)} close=${money(bar.c)} high=${money(bar.h)} low=${money(bar.l)} volume=${bar.v ?? "n/a"} time=${bar.t || "unknown"}`
    );
  }

  return lines.join("\n");
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function money(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}
