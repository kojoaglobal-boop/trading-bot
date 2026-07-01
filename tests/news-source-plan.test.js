import test from "node:test";
import assert from "node:assert/strict";
import { formatNewsSourcePlan, getNewsSourcePlan } from "../src/core/news-source-plan.js";

test("getNewsSourcePlan keeps Oil catalysts separate from Gold and stocks", () => {
  const plan = getNewsSourcePlan();

  assert.deepEqual(plan.oil.required, ["eia-petroleum", "finnhub-market-news"]);
  assert.deepEqual(plan.gold.required, ["finnhub-market-news"]);
  assert.deepEqual(plan.stock.required, ["finnhub-company-news"]);
});

test("formatNewsSourcePlan prints all section plans", () => {
  const output = formatNewsSourcePlan(getNewsSourcePlan());

  assert.match(output, /OIL/);
  assert.match(output, /eia-petroleum/);
  assert.match(output, /GOLD/);
});
