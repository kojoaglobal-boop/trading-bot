import test from "node:test";
import assert from "node:assert/strict";
import { appendSubmittedEntry, buildTradeFrequencyGuard } from "../src/core/trade-frequency-guard.js";

test("buildTradeFrequencyGuard blocks entries during cooldown", () => {
  const guard = buildTradeFrequencyGuard({
    now: new Date("2026-01-01T10:04:00Z"),
    minMinutesBetweenEntries: 6,
    state: {
      submittedEntries: [{
        submittedAt: "2026-01-01T10:00:00Z"
      }]
    }
  });

  assert.equal(guard.status, "ENTRY_COOLDOWN");
  assert.equal(guard.blocksEntries, true);
});

test("buildTradeFrequencyGuard blocks entries at hourly cap", () => {
  const guard = buildTradeFrequencyGuard({
    now: new Date("2026-01-01T10:30:00Z"),
    maxEntriesPerHour: 2,
    state: {
      submittedEntries: [
        { submittedAt: "2026-01-01T10:00:00Z" },
        { submittedAt: "2026-01-01T10:20:00Z" }
      ]
    }
  });

  assert.equal(guard.status, "MAX_HOURLY_ENTRIES");
  assert.equal(guard.blocksEntries, true);
});

test("appendSubmittedEntry records entry metadata without losing state", () => {
  const state = appendSubmittedEntry({
    date: "2026-01-01",
    submittedEntries: []
  }, {
    submittedAt: "2026-01-01T10:00:00Z",
    barTime: "2026-01-01T09:59:00Z",
    dedupeKey: "key-1",
    epic: "OIL_CRUDE",
    direction: "SELL",
    resolution: "MINUTE",
    setupType: "oil-breakout"
  });

  assert.equal(state.date, "2026-01-01");
  assert.equal(state.submittedEntries.length, 1);
  assert.equal(state.submittedEntries[0].epic, "OIL_CRUDE");
});
