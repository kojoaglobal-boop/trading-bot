import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatJournal, loadAuditJournal } from "../src/core/journal.js";

test("audit journal loads and formats saved run logs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trading-bot-journal-"));
  await writeFile(
    join(directory, "run.json"),
    JSON.stringify({
      runId: "run-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      mode: "paper",
      account: {
        finalEquity: 101000,
        netPnl: 1000,
        returnPct: 0.01
      },
      metrics: {
        maxDrawdownPct: 0.02,
        closedTrades: 4,
        winRate: 0.75
      },
      sources: [
        {
          provider: "sample-generator",
          mode: "simulation"
        }
      ]
    }),
    "utf8"
  );

  const logs = await loadAuditJournal(directory);
  const output = formatJournal(logs);

  assert.equal(logs.length, 1);
  assert.match(output, /run-1/);
  assert.match(output, /\$101,000.00/);
  assert.match(output, /sample-generator:simulation/);
});
