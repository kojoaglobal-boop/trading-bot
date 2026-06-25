import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadAuditJournal(directory = "logs") {
  let entries = [];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const logs = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = join(directory, entry.name);
    const text = await readFile(filePath, "utf8");
    const audit = JSON.parse(text);
    logs.push({
      filePath,
      ...audit
    });
  }

  logs.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return logs;
}

export function formatJournal(logs, { limit = 12 } = {}) {
  const lines = [];
  lines.push("Trading Bot Audit Journal");
  lines.push("=========================");

  if (!logs.length) {
    lines.push("No audit logs found. Run a command with --audit first.");
    return lines.join("\n");
  }

  for (const log of logs.slice(0, limit)) {
    const account = log.account || {};
    const metrics = log.metrics || {};
    const sources = log.sources || [];

    lines.push("");
    lines.push(`${log.runId || "unknown-run"} (${log.mode || "unknown"})`);
    lines.push(`  created:       ${log.createdAt || "unknown"}`);
    lines.push(`  final equity:  ${money(account.finalEquity || 0)}`);
    lines.push(`  net pnl:       ${money(account.netPnl || 0)} (${pct(account.returnPct || 0)})`);
    lines.push(`  max drawdown:  ${pct(metrics.maxDrawdownPct || 0)}`);
    lines.push(`  closed trades: ${metrics.closedTrades ?? "n/a"}`);
    lines.push(`  win rate:      ${metrics.winRate === undefined ? "n/a" : pct(metrics.winRate)}`);
    lines.push(`  sources:       ${formatSources(sources)}`);
  }

  return lines.join("\n");
}

function formatSources(sources) {
  if (!sources.length) {
    return "unknown";
  }

  return sources
    .map((source) => `${source.provider}:${source.mode}`)
    .filter((item, index, all) => all.indexOf(item) === index)
    .join(", ");
}

function money(value) {
  return `$${Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}

function pct(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}
