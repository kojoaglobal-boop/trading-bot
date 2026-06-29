import test from "node:test";
import assert from "node:assert/strict";
import {
  checkDailyEntryGuard,
  createDailyTradingGuard
} from "../src/core/daily-trading-guard.js";

test("daily trading guard stays active inside daily P/L limits", () => {
  const guard = createDailyTradingGuard({
    account: { portfolioValue: 530 },
    dailyStartEquity: 500,
    now: new Date("2026-01-01T12:00:00Z")
  });

  assert.equal(guard.status, "active");
  assert.equal(guard.blockNewEntries, false);
  assert.equal(checkDailyEntryGuard(guard), null);
});

test("daily trading guard blocks fresh entries at target, stretch, and loss limits", () => {
  const target = createDailyTradingGuard({
    account: { portfolioValue: 550 },
    dailyStartEquity: 500
  });
  const stretch = createDailyTradingGuard({
    account: { portfolioValue: 600 },
    dailyStartEquity: 500
  });
  const loss = createDailyTradingGuard({
    account: { portfolioValue: 450 },
    dailyStartEquity: 500
  });

  assert.equal(target.status, "profit-target-reached");
  assert.match(checkDailyEntryGuard(target), /daily profit target/);
  assert.equal(stretch.status, "profit-stretch-reached");
  assert.match(checkDailyEntryGuard(stretch), /daily profit stretch/);
  assert.equal(loss.status, "loss-limit-reached");
  assert.match(checkDailyEntryGuard(loss), /daily loss limit/);
});
