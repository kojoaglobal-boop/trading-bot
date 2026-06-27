import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function writeAuditLog(report, { directory = "logs" } = {}) {
  const audit = createAuditRecord(report);
  return writeAuditRecord(audit, { directory });
}

export async function writeAuditRecord(audit, { directory = "logs" } = {}) {
  await mkdir(directory, { recursive: true });
  const filePath = resolve(directory, `${audit.runId}.json`);
  await writeFile(filePath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  return filePath;
}

export function createAuditRecord(report, createdAt = new Date()) {
  return {
    runId: createRunId(report, createdAt),
    createdAt: createdAt.toISOString(),
    mode: report.mode,
    account: report.account,
    metrics: report.metrics,
    sources: report.sources,
    positions: report.positions,
    fills: report.fills,
    rejections: report.rejections
  };
}

function createRunId(report, createdAt = new Date()) {
  const safeMode = String(report.mode || "run").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${safeMode}`;
}
