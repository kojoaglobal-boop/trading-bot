import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function writeAuditLog(report, { directory = "logs" } = {}) {
  const runId = createRunId(report);
  const audit = {
    runId,
    createdAt: new Date().toISOString(),
    mode: report.mode,
    account: report.account,
    metrics: report.metrics,
    sources: report.sources,
    positions: report.positions,
    fills: report.fills,
    rejections: report.rejections
  };

  await mkdir(directory, { recursive: true });
  const filePath = resolve(directory, `${runId}.json`);
  await writeFile(filePath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  return filePath;
}

function createRunId(report) {
  const safeMode = String(report.mode || "run").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${safeMode}`;
}
