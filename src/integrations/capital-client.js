const CAPITAL_BASE_URLS = {
  demo: "https://demo-api-capital.backend-capital.com",
  live: "https://api-capital.backend-capital.com"
};

export class CapitalClient {
  constructor({ env = process.env, fetchFn = globalThis.fetch } = {}) {
    this.environment = String(env.CAPITAL_ENV || "demo").trim().toLowerCase();
    this.identifier = env.CAPITAL_IDENTIFIER || "";
    this.apiKey = env.CAPITAL_API_KEY || "";
    this.password = env.CAPITAL_PASSWORD || "";
    this.baseUrl = trimTrailingSlash(
      env.CAPITAL_BASE_URL || CAPITAL_BASE_URLS[this.environment] || CAPITAL_BASE_URLS.demo
    );
    this.fetchFn = fetchFn;
    this.cst = env.CAPITAL_CST || "";
    this.securityToken = env.CAPITAL_SECURITY_TOKEN || "";
  }

  isConfigured() {
    return Boolean(this.identifier && this.apiKey && this.password);
  }

  missingKeys() {
    const missing = [];
    if (!this.identifier) missing.push("CAPITAL_IDENTIFIER");
    if (!this.apiKey) missing.push("CAPITAL_API_KEY");
    if (!this.password) missing.push("CAPITAL_PASSWORD");
    return missing;
  }

  async createSession() {
    if (!this.isConfigured()) {
      throw new Error(`Missing Capital.com keys: ${this.missingKeys().join(", ")}`);
    }

    const response = await this.rawRequest({
      method: "POST",
      path: "/api/v1/session",
      auth: false,
      headers: {
        "X-CAP-API-KEY": this.apiKey,
        "Content-Type": "application/json"
      },
      body: {
        identifier: this.identifier,
        password: this.password,
        encryptedPassword: false
      }
    });

    this.cst = getHeader(response.headers, "CST");
    this.securityToken = getHeader(response.headers, "X-SECURITY-TOKEN");

    if (!this.cst || !this.securityToken) {
      throw new Error("Capital.com session did not return CST and X-SECURITY-TOKEN headers.");
    }

    return response.payload;
  }

  async getAccounts() {
    return this.requestJson({
      method: "GET",
      path: "/api/v1/accounts"
    });
  }

  async getMarkets({ searchTerm = "gold" } = {}) {
    return this.requestJson({
      method: "GET",
      path: "/api/v1/markets",
      query: {
        searchTerm
      }
    });
  }

  async getPrices({
    epic,
    resolution = "MINUTE_5",
    max = 120,
    from,
    to
  } = {}) {
    if (!epic) {
      throw new Error("Capital.com market epic is required.");
    }

    const query = {
      resolution: normalizeCapitalResolution(resolution)
    };
    if (max !== undefined && max !== null && max !== "") {
      query.max = String(max);
    }
    if (from) {
      query.from = from;
    }
    if (to) {
      query.to = to;
    }

    return this.requestJson({
      method: "GET",
      path: `/api/v1/prices/${encodeURIComponent(epic)}`,
      query
    });
  }

  async requestJson({ method = "GET", path, query, body } = {}) {
    await this.ensureSession();
    const response = await this.rawRequest({
      method,
      path,
      query,
      body,
      auth: true
    });
    return response.payload;
  }

  async ensureSession() {
    if (this.cst && this.securityToken) {
      return;
    }
    await this.createSession();
  }

  async rawRequest({
    method = "GET",
    path,
    query,
    body,
    auth = true,
    headers = {}
  } = {}) {
    if (!this.fetchFn) {
      throw new Error("Fetch API is not available in this Node runtime.");
    }

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const requestHeaders = {
      Accept: "application/json",
      ...headers
    };
    if (auth) {
      requestHeaders.CST = this.cst;
      requestHeaders["X-SECURITY-TOKEN"] = this.securityToken;
    }

    const response = await this.fetchFn(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = payload.errorCode || payload.message || response.statusText;
      throw new Error(`Capital.com request failed (${response.status}): ${message}`);
    }

    return {
      payload,
      headers: response.headers
    };
  }
}

export function normalizeCapitalPrices(payload, {
  epic = payload.instrument?.epic || payload.epic || "GOLD",
  resolution = payload.resolution || "MINUTE_5",
  environment = "demo",
  symbol
} = {}) {
  const normalizedSymbol = symbol || inferSymbolFromEpic(epic);
  const assetClass = inferAssetClass(normalizedSymbol, epic);
  const prices = payload.prices || [];

  return prices
    .map((price) => ({
      time: normalizeCapitalTime(price.snapshotTimeUTC || price.snapshotTime),
      symbol: normalizedSymbol,
      assetClass,
      venue: `capital-${environment}`,
      open: extractPrice(price.openPrice),
      high: extractPrice(price.highPrice),
      low: extractPrice(price.lowPrice),
      close: extractPrice(price.closePrice),
      volume: Number(price.lastTradedVolume || 0),
      bid: price.closePrice?.bid !== undefined ? Number(price.closePrice.bid) : undefined,
      ask: price.closePrice?.ask !== undefined ? Number(price.closePrice.ask) : undefined,
      source: {
        provider: "capital",
        mode: `${environment}-market-data`,
        epic,
        resolution: normalizeCapitalResolution(resolution)
      }
    }))
    .filter((bar) => Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function formatCapitalAccounts(payload) {
  const accounts = payload.accounts || [];
  const lines = [];
  lines.push("Capital.com Accounts");
  lines.push("====================");

  if (!accounts.length) {
    lines.push("No accounts returned.");
    return lines.join("\n");
  }

  for (const account of accounts) {
    lines.push(
      `${String(account.accountId || "unknown").padEnd(16)} ${String(account.accountName || "").padEnd(20)} ${String(account.currency || "").padEnd(4)} balance=${money(account.balance?.balance)} available=${money(account.balance?.available)}`
    );
  }

  return lines.join("\n");
}

export function formatCapitalMarkets(payload, { limit = 30 } = {}) {
  const markets = payload.markets || [];
  const lines = [];
  lines.push("Capital.com Markets");
  lines.push("===================");
  lines.push(`Returned: ${markets.length}`);

  if (!markets.length) {
    lines.push("No markets returned. Try --search gold, --search xau, or --search eur/usd.");
    return lines.join("\n");
  }

  for (const market of markets.slice(0, limit)) {
    lines.push(
      `${String(market.epic || "unknown").padEnd(18)} ${String(market.instrumentName || market.instrumentType || "").padEnd(28)} ${String(market.marketStatus || "").padEnd(12)} bid=${formatMaybePrice(market.bid)} ask=${formatMaybePrice(market.offer)}`
    );
  }

  return lines.join("\n");
}

export function formatCapitalPrices(bars, { limit = 8 } = {}) {
  const lines = [];
  lines.push("Capital.com Price Bars");
  lines.push("======================");

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

export function normalizeCapitalResolution(value) {
  const normalized = String(value || "MINUTE_5").trim().toUpperCase().replace("-", "_");
  const aliases = {
    M1: "MINUTE",
    "1M": "MINUTE",
    MINUTE_1: "MINUTE",
    M5: "MINUTE_5",
    "5M": "MINUTE_5",
    M15: "MINUTE_15",
    "15M": "MINUTE_15",
    M30: "MINUTE_30",
    "30M": "MINUTE_30",
    H1: "HOUR",
    "1H": "HOUR",
    H4: "HOUR_4",
    "4H": "HOUR_4",
    D: "DAY",
    D1: "DAY",
    "1D": "DAY"
  };
  return aliases[normalized] || normalized;
}

function extractPrice(value = {}) {
  const last = Number(value.last);
  if (Number.isFinite(last)) {
    return last;
  }
  return average(value.bid, value.ask);
}

function average(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return (a + b) / 2;
  }
  return Number.isFinite(a) ? a : b;
}

function inferSymbolFromEpic(epic) {
  const normalized = String(epic || "").toUpperCase();
  if (normalized.includes("GOLD") || normalized.includes("XAU")) {
    return "XAU/USD";
  }
  return normalized.replace(/[_-]/g, "/");
}

function inferAssetClass(symbol, epic) {
  const value = `${symbol} ${epic}`.toUpperCase();
  if (value.includes("XAU") || value.includes("GOLD")) {
    return "gold";
  }
  return "forex";
}

function normalizeCapitalTime(value) {
  if (!value) {
    return new Date(0).toISOString();
  }
  const text = String(value);
  const date = new Date(text.endsWith("Z") ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function getHeader(headers, name) {
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || "";
  }

  return headers[name] || headers[name.toLowerCase()] || "";
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

function formatMaybePrice(value) {
  return value === undefined || value === null ? "n/a" : money(value);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(8);
}
