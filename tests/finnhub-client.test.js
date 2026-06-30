import test from "node:test";
import assert from "node:assert/strict";
import {
  FinnhubClient,
  formatFinnhubCompanyNews,
  normalizeCompanyNews
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
