import test from "node:test";
import assert from "node:assert/strict";
import {
  CapitalClient,
  formatCapitalDealResult,
  formatCapitalMarkets,
  formatCapitalPositions,
  formatCapitalPrices,
  normalizeCapitalPrices,
  normalizeCapitalResolution
} from "../src/integrations/capital-client.js";

test("CapitalClient reports missing credentials before requests", async () => {
  const client = new CapitalClient({
    env: {},
    fetchFn: async () => {
      throw new Error("should not request");
    }
  });

  assert.deepEqual(client.missingKeys(), ["CAPITAL_IDENTIFIER", "CAPITAL_API_KEY", "CAPITAL_PASSWORD"]);
  await assert.rejects(
    () => client.getAccounts(),
    /Missing Capital.com keys/
  );
});

test("CapitalClient creates a session and sends CST security headers", async () => {
  const requests = [];
  const client = new CapitalClient({
    env: {
      CAPITAL_ENV: "demo",
      CAPITAL_IDENTIFIER: "kojo@example.com",
      CAPITAL_API_KEY: "api-key-1",
      CAPITAL_PASSWORD: "password-1"
    },
    fetchFn: async (input, options) => {
      requests.push({ input, options });
      if (String(input).endsWith("/api/v1/session")) {
        return {
          ok: true,
          headers: new Headers({
            CST: "cst-1",
            "X-SECURITY-TOKEN": "security-1"
          }),
          async text() {
            return JSON.stringify({ status: "OK" });
          }
        };
      }

      return {
        ok: true,
        headers: new Headers(),
        async text() {
          return JSON.stringify({ accounts: [] });
        }
      };
    }
  });

  await client.getAccounts();

  assert.equal(requests.length, 2);
  assert.equal(new URL(String(requests[0].input)).origin, "https://demo-api-capital.backend-capital.com");
  assert.equal(requests[0].options.headers["X-CAP-API-KEY"], "api-key-1");
  assert.equal(JSON.parse(requests[0].options.body).identifier, "kojo@example.com");
  assert.equal(requests[1].options.headers.CST, "cst-1");
  assert.equal(requests[1].options.headers["X-SECURITY-TOKEN"], "security-1");
  assert.equal(requests[1].options.headers["Content-Type"], "application/json");
});

test("CapitalClient can list, create, update, confirm, and close demo positions", async () => {
  const requests = [];
  const client = new CapitalClient({
    env: {
      CAPITAL_ENV: "demo",
      CAPITAL_IDENTIFIER: "kojo@example.com",
      CAPITAL_API_KEY: "api-key-1",
      CAPITAL_PASSWORD: "password-1"
    },
    fetchFn: async (input, options) => {
      const url = new URL(String(input));
      requests.push({ url, options });

      if (url.pathname === "/api/v1/session") {
        return jsonResponse({ status: "OK" }, {
          CST: "cst-1",
          "X-SECURITY-TOKEN": "security-1"
        });
      }

      if (url.pathname === "/api/v1/positions" && options.method === "GET") {
        return jsonResponse({
          positions: [{
            market: { epic: "GOLD" },
            position: {
              dealId: "deal-1",
              direction: "BUY",
              size: 0.01,
              level: 4030,
              upl: 1.25
            }
          }]
        });
      }

      if (url.pathname === "/api/v1/positions" && options.method === "POST") {
        return jsonResponse({ dealReference: "ref-1" });
      }

      if (url.pathname === "/api/v1/positions/deal-1" && options.method === "PUT") {
        return jsonResponse({ dealReference: "update-ref-1" });
      }

      if (url.pathname === "/api/v1/confirms/ref-1") {
        return jsonResponse({
          dealReference: "ref-1",
          dealId: "deal-1",
          dealStatus: "ACCEPTED",
          epic: "GOLD",
          direction: "BUY",
          size: 0.01,
          level: 4030
        });
      }

      if (url.pathname === "/api/v1/positions/deal-1" && options.method === "DELETE") {
        return jsonResponse({ dealReference: "close-ref-1" });
      }

      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    }
  });

  const positions = await client.getPositions();
  const created = await client.createPosition({
    epic: "GOLD",
    direction: "BUY",
    size: 0.01,
    stopDistance: 10,
    profitDistance: 20
  });
  const updated = await client.updatePosition("deal-1", {
    stopLevel: 4035,
    profitLevel: 4070
  });
  const confirm = await client.getConfirm(created.dealReference);
  const closed = await client.closePosition("deal-1");

  assert.equal(positions.positions.length, 1);
  assert.equal(created.dealReference, "ref-1");
  assert.equal(updated.dealReference, "update-ref-1");
  assert.equal(confirm.dealStatus, "ACCEPTED");
  assert.equal(closed.dealReference, "close-ref-1");
  const createRequest = requests.find((request) => request.options.method === "POST" && request.url.pathname === "/api/v1/positions");
  const updateRequest = requests.find((request) => request.options.method === "PUT" && request.url.pathname === "/api/v1/positions/deal-1");
  assert.equal(JSON.parse(createRequest.options.body).profitDistance, 20);
  assert.deepEqual(JSON.parse(updateRequest.options.body), {
    stopLevel: 4035,
    profitLevel: 4070
  });
  assert.match(formatCapitalPositions(positions), /GOLD/);
  assert.match(formatCapitalDealResult(confirm), /ACCEPTED/);
});

test("normalizeCapitalPrices maps GOLD prices to internal gold bars", () => {
  const bars = normalizeCapitalPrices({
    prices: [{
      snapshotTimeUTC: "2026-01-01T10:00:00",
      openPrice: { bid: 2399, ask: 2401 },
      highPrice: { bid: 2409, ask: 2411 },
      lowPrice: { bid: 2394, ask: 2396 },
      closePrice: { bid: 2404, ask: 2406 },
      lastTradedVolume: 25
    }]
  }, {
    epic: "GOLD",
    resolution: "M5",
    environment: "demo"
  });

  assert.equal(bars.length, 1);
  assert.equal(bars[0].symbol, "XAU/USD");
  assert.equal(bars[0].assetClass, "gold");
  assert.equal(bars[0].venue, "capital-demo");
  assert.equal(bars[0].close, 2405);
  assert.equal(bars[0].source.provider, "capital");
  assert.equal(bars[0].source.resolution, "MINUTE_5");
  assert.match(formatCapitalPrices(bars), /XAU\/USD/);
});

test("Capital helpers normalize resolutions and format market search results", () => {
  assert.equal(normalizeCapitalResolution("M5"), "MINUTE_5");
  assert.equal(normalizeCapitalResolution("H1"), "HOUR");
  assert.match(formatCapitalMarkets({
    markets: [{
      epic: "GOLD",
      instrumentName: "Gold",
      marketStatus: "TRADEABLE",
      bid: 2400,
      offer: 2401
    }]
  }), /GOLD/);
});

function jsonResponse(payload, headers = {}) {
  return {
    ok: true,
    headers: new Headers(headers),
    async text() {
      return JSON.stringify(payload);
    }
  };
}
