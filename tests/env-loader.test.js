import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDotEnv, parseEnvLine } from "../src/core/env-loader.js";

test("parseEnvLine handles comments, blanks, and quoted values", () => {
  assert.equal(parseEnvLine("# hello"), null);
  assert.equal(parseEnvLine(""), null);
  assert.deepEqual(parseEnvLine("OPENAI_API_KEY=\"abc123\""), {
    key: "OPENAI_API_KEY",
    value: "abc123"
  });
});

test("loadDotEnv loads keys without overwriting existing values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trading-bot-env-"));
  const filePath = join(directory, ".env");
  const target = {
    EXISTING: "keep"
  };

  await writeFile(filePath, "EXISTING=replace\nNEW_KEY='new-value'\n", "utf8");
  const result = await loadDotEnv(filePath, target);

  assert.equal(result.loaded, true);
  assert.equal(target.EXISTING, "keep");
  assert.equal(target.NEW_KEY, "new-value");
});
