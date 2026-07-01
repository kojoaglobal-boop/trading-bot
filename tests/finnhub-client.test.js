import test from "node:test";
import assert from "node:assert/strict";
import {
  FinnhubClient,
  formatFinnhubCompanyNews,
  formatFinnhubMarketNews,
  normalizeCompanyNews,
  normalizeMarketNews
} from "../src/integrations/finnhub-client.js";

test("FinnhubClient reports missing API key before requests", async () => {
  const client = new FinnhubClient({
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    }
  });

  await assert.rejects(
    () => client.getCompanyNews({
      symbol: "TSLA",
      from: "2026-06-01",
      to: "2026-06-30"
    }),
    /Missing FINNHUB_API_KEY/
  );
});

test("FinnhubClient requests company news with token auth", async () => {
  let requestedUrl;
  const client = new FinnhubClient({
    apiKey: "secret-token",
    baseUrl: "https://example.test/api/v1",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return [{
            id: 1,
            datetime: 1782750000,
            headline: "TSLA moves on catalyst",
            summary: "Market-moving news summary.",
            source: "Example"
          }];
        }
      };
    }
  });

  const news = await client.getCompanyNews({
    symbol: "tsla",
    from: "2026-06-01",
    to: "2026-06-30"
  });

  assert.equal(requestedUrl.searchParams.get("symbol"), "TSLA");
  assert.equal(requestedUrl.searchParams.get("from"), "2026-06-01");
  assert.equal(requestedUrl.searchParams.get("to"), "2026-06-30");
  assert.equal(requestedUrl.searchParams.get("token"), "secret-token");
  assert.equal(news[0].symbol, "TSLA");
  assert.equal(news[0].headline, "TSLA moves on catalyst");
});

test("FinnhubClient requests market news with token auth", async () => {
  let requestedUrl;
  const client = new FinnhubClient({
    apiKey: "secret-token",
    baseUrl: "https://example.test/api/v1",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return [{
            id: 11,
            datetime: 1782750000,
            headline: "Oil jumps after inventory surprise",
            summary: "Crude oil moved on a macro catalyst.",
            source: "Example"
          }];
        }
      };
    }
  });

  const news = await client.getMarketNews({
    category: "forex",
    minId: 10
  });

  assert.equal(requestedUrl.searchParams.get("category"), "forex");
  assert.equal(requestedUrl.searchParams.get("minId"), "10");
  assert.equal(requestedUrl.searchParams.get("token"), "secret-token");
  assert.equal(news[0].category, "forex");
  assert.equal(news[0].headline, "Oil jumps after inventory surprise");
});

test("normalizeCompanyNews and formatter map Finnhub rows safely", () => {
  const news = normalizeCompanyNews([{
    id: 7,
    datetime: 1782750000,
    headline: "Headline",
    summary: "Summary",
    source: "Source"
  }], { symbol: "NVDA" });

  assert.equal(news[0].id, "7");
  assert.equal(news[0].symbol, "NVDA");
  assert.equal(news[0].datetime, "2026-06-29T16:20:00.000Z");
  const output = formatFinnhubCompanyNews(news, { symbol: "NVDA" });
  assert.match(output, /Finnhub Company News: NVDA/);
  assert.match(output, /Headline/);
  assert.doesNotMatch(output, /FINNHUB_API_KEY/);
});

test("normalizeMarketNews and formatter map Finnhub market rows safely", () => {
  const news = normalizeMarketNews([{
    id: 12,
    datetime: 1782750000,
    headline: "Macro headline",
    summary: "Summary",
    source: "Source"
  }], { category: "general" });

  assert.equal(news[0].id, "12");
  assert.equal(news[0].category, "general");
  assert.equal(news[0].datetime, "2026-06-29T16:20:00.000Z");
  const output = formatFinnhubMarketNews(news, { category: "general" });
  assert.match(output, /Finnhub Market News: general/);
  assert.match(output, /Macro headline/);
  assert.doesNotMatch(output, /FINNHUB_API_KEY/);
});
