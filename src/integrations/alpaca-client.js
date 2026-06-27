const DEFAULT_PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const DEFAULT_DATA_BASE_URL = "https://data.alpaca.markets";
const TINY_MANUAL_MARKET_ORDER_CAP = 5;
const LOOP_PAPER_MARKET_ORDER_CAP = 100;

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

  async getStockBars({
    symbols,
    timeframe = "1Hour",
    limit = 80,
    feed = "iex",
    start,
    end
  }) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new Error("At least one stock symbol is required.");
    }

    const url = new URL(`${this.dataBaseUrl}/v2/stocks/bars`);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("timeframe", timeframe);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort", "asc");
    if (feed) {
      url.searchParams.set("feed", feed);
    }
    if (start) {
      url.searchParams.set("start", start);
    }
    if (end) {
      url.searchParams.set("end", end);
    }

    return this.requestJson(url);
  }

  async getPositions() {
    return this.requestJson(`${this.paperBaseUrl}/v2/positions`);
  }

  async listOrders({
    status = "open",
    limit = 20,
    after,
    until,
    direction,
    symbols,
    nested
  } = {}) {
    const url = new URL(`${this.paperBaseUrl}/v2/orders`);
    url.searchParams.set("status", status);
    url.searchParams.set("limit", String(limit));
    if (after) {
      url.searchParams.set("after", after);
    }
    if (until) {
      url.searchParams.set("until", until);
    }
    if (direction) {
      url.searchParams.set("direction", direction);
    }
    if (symbols) {
      url.searchParams.set("symbols", Array.isArray(symbols) ? symbols.join(",") : String(symbols));
    }
    if (nested !== undefined) {
      url.searchParams.set("nested", String(Boolean(nested)));
    }
    return this.requestJson(url);
  }

  async getAccountActivities({
    activityType = "FILL",
    after,
    until,
    date,
    direction = "desc",
    pageSize = 100
  } = {}) {
    const safeActivityType = String(activityType || "FILL").trim().toUpperCase();
    const url = new URL(`${this.paperBaseUrl}/v2/account/activities/${safeActivityType}`);
    url.searchParams.set("direction", direction);
    url.searchParams.set("page_size", String(pageSize));
    if (after) {
      url.searchParams.set("after", after);
    }
    if (until) {
      url.searchParams.set("until", until);
    }
    if (date) {
      url.searchParams.set("date", date);
    }
    return this.requestJson(url);
  }

  async getOrder(orderId) {
    if (!orderId) {
      throw new Error("Order ID is required.");
    }
    return this.requestJson(`${this.paperBaseUrl}/v2/orders/${orderId}`);
  }

  async submitOrder(order) {
    validatePaperOrder(order);
    this.assertPaperEndpoint();
    return this.requestJson(`${this.paperBaseUrl}/v2/orders`, {
      method: "POST",
      body: order
    });
  }

  async cancelOrder(orderId) {
    if (!orderId) {
      throw new Error("Order ID is required.");
    }
    return this.requestJson(`${this.paperBaseUrl}/v2/orders/${orderId}`, {
      method: "DELETE"
    });
  }

  assertPaperEndpoint() {
    if (!this.paperBaseUrl.includes("paper-api.alpaca.markets") && !this.paperBaseUrl.includes("paper.")) {
      throw new Error(`Refusing to submit orders because Alpaca base URL does not look like paper trading: ${this.paperBaseUrl}`);
    }
  }

  async requestJson(input, { method = "GET", body } = {}) {
    if (!this.isConfigured()) {
      throw new Error(`Missing Alpaca keys: ${this.missingKeys().join(", ")}`);
    }

    if (!this.fetchFn) {
      throw new Error("Fetch API is not available in this Node runtime.");
    }

    const requestOptions = {
      method,
      headers: {
        "APCA-API-KEY-ID": this.apiKey,
        "APCA-API-SECRET-KEY": this.secretKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    };

    if (body !== undefined) {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await this.fetchFn(input, requestOptions);

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = payload.message || payload.error || response.statusText;
      throw new Error(`Alpaca request failed (${response.status}): ${message}`);
    }

    return payload;
  }
}

export function createLimitCancelSmokeOrder({
  symbol = "AAPL",
  side = "buy",
  qty = "1",
  limitPrice = "1.00"
} = {}) {
  return {
    symbol: normalizeSymbol(symbol),
    qty: String(qty),
    side: normalizeSide(side),
    type: "limit",
    time_in_force: "day",
    limit_price: String(limitPrice),
    client_order_id: `tb-smoke-${Date.now()}`
  };
}

export function createTinyMarketOrder({
  symbol = "AAPL",
  side = "buy",
  notional = "1.00"
} = {}) {
  return {
    symbol: normalizeSymbol(symbol),
    notional: String(notional),
    side: normalizeSide(side),
    type: "market",
    time_in_force: "day",
    client_order_id: `tb-market-${Date.now()}`
  };
}

export function createPaperMarketOrderFromRiskOrder({
  order,
  maxBuyNotional = 5
} = {}) {
  if (!order) {
    throw new Error("Risk order is required.");
  }

  const side = normalizeSide(order.side);
  const symbol = normalizeSymbol(order.symbol);
  const clientOrderId = `tb-loop-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (side === "buy") {
    const requestedNotional = Number(order.quantity || 0) * Number(order.expectedPrice || 0);
    const notional = Math.min(requestedNotional, Number(maxBuyNotional || 5));

    if (!Number.isFinite(notional) || notional <= 0) {
      throw new Error("Buy order has invalid notional.");
    }

    return {
      symbol,
      notional: notional.toFixed(2),
      side,
      type: "market",
      time_in_force: "day",
      client_order_id: clientOrderId
    };
  }

  return {
    symbol,
    qty: formatQty(order.quantity),
    side,
    type: "market",
    time_in_force: "day",
    client_order_id: clientOrderId
  };
}

export function formatOrder(order) {
  const lines = [];
  lines.push("Alpaca Paper Order");
  lines.push("==================");
  lines.push(`ID:              ${order.id || "unknown"}`);
  lines.push(`Client Order ID: ${order.client_order_id || "unknown"}`);
  lines.push(`Symbol:          ${order.symbol || "unknown"}`);
  lines.push(`Side:            ${order.side || "unknown"}`);
  lines.push(`Type:            ${order.type || "unknown"}`);
  lines.push(`Status:          ${order.status || "unknown"}`);
  lines.push(`Qty:             ${order.qty || "n/a"}`);
  lines.push(`Notional:        ${order.notional ? money(order.notional) : "n/a"}`);
  lines.push(`Limit Price:     ${order.limit_price ? money(order.limit_price) : "n/a"}`);
  lines.push(`Filled Qty:      ${order.filled_qty || "0"}`);
  lines.push(`Filled Avg:      ${order.filled_avg_price ? money(order.filled_avg_price) : "n/a"}`);
  return lines.join("\n");
}

export function formatOrders(orders) {
  const lines = [];
  lines.push("Alpaca Paper Orders");
  lines.push("===================");

  if (!orders.length) {
    lines.push("No orders returned.");
    return lines.join("\n");
  }

  for (const order of orders) {
    lines.push(
      `${String(order.symbol || "unknown").padEnd(6)} ${String(order.side || "?").padEnd(4)} ${String(order.type || "?").padEnd(6)} ${String(order.status || "?").padEnd(12)} id=${order.id || "unknown"}`
    );
  }

  return lines.join("\n");
}

export function formatPositions(positions) {
  const lines = [];
  lines.push("Alpaca Paper Positions");
  lines.push("======================");

  if (!positions.length) {
    lines.push("No open positions.");
    return lines.join("\n");
  }

  for (const position of positions) {
    lines.push(
      `${String(position.symbol || "unknown").padEnd(6)} qty=${position.qty || "0"} avg=${money(position.avg_entry_price)} value=${money(position.market_value)} upl=${money(position.unrealized_pl)}`
    );
  }

  return lines.join("\n");
}

export function formatActivities(activities, { title = "Alpaca Account Activities" } = {}) {
  const lines = [];
  lines.push(title);
  lines.push("=".repeat(title.length));

  if (!activities.length) {
    lines.push("No activities returned.");
    return lines.join("\n");
  }

  for (const activity of activities) {
    lines.push(
      `${String(activity.transaction_time || activity.date || "unknown").padEnd(28)} ${String(activity.symbol || "?").padEnd(6)} ${String(activity.side || "?").padEnd(4)} qty=${activity.qty || "0"} price=${money(activity.price)} order=${activity.order_id || "unknown"}`
    );
  }

  return lines.join("\n");
}

export function formatSmokeOrderResult({ submitted, cancelStatus, afterCancel }) {
  const lines = [];
  lines.push("Alpaca Paper Smoke Order");
  lines.push("========================");
  lines.push(`Submitted: ${submitted.id || "unknown"} ${submitted.symbol} ${submitted.side} ${submitted.type}`);
  lines.push(`Initial status: ${submitted.status || "unknown"}`);
  lines.push(`Cancel status:  ${cancelStatus}`);
  if (afterCancel) {
    lines.push(`Final status:   ${afterCancel.status || "unknown"}`);
  }
  return lines.join("\n");
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

function validatePaperOrder(order) {
  if (!order || typeof order !== "object") {
    throw new Error("Order payload is required.");
  }

  if (!order.symbol) {
    throw new Error("Order symbol is required.");
  }

  if (!["buy", "sell"].includes(order.side)) {
    throw new Error("Order side must be buy or sell.");
  }

  if (!["market", "limit"].includes(order.type)) {
    throw new Error("Only market and limit paper orders are supported by this client.");
  }

  if (order.type === "market" && !order.notional && !order.qty) {
    throw new Error("Market order requires notional or qty.");
  }

  if (order.type === "limit" && (!order.qty || !order.limit_price)) {
    throw new Error("Limit order requires qty and limit_price.");
  }

  if (order.notional) {
    const maxNotional = isLoopPaperOrder(order)
      ? LOOP_PAPER_MARKET_ORDER_CAP
      : TINY_MANUAL_MARKET_ORDER_CAP;
    if (Number(order.notional) > maxNotional) {
      throw new Error(`Paper market orders are capped at $${maxNotional} notional.`);
    }
  }
}

function isLoopPaperOrder(order) {
  return String(order.client_order_id || "").startsWith("tb-loop-");
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function normalizeSide(side) {
  const normalized = String(side || "").trim().toLowerCase();
  if (!["buy", "sell"].includes(normalized)) {
    throw new Error("Side must be buy or sell.");
  }
  return normalized;
}

function formatQty(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Order quantity must be positive.");
  }
  return number.toFixed(6).replace(/\.?0+$/, "");
}

function money(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}
