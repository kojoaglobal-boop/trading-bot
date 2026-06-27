import test from "node:test";
import assert from "node:assert/strict";
import { formatDatabaseConfig, getDatabaseConfig } from "../src/core/database-config.js";

test("getDatabaseConfig uses safe local defaults", () => {
  assert.deepEqual(getDatabaseConfig({}), {
    host: "localhost",
    port: 5432,
    database: "trading_bot",
    user: "trading_bot",
    passwordSet: false,
    ssl: false
  });
});

test("getDatabaseConfig reads explicit environment settings", () => {
  assert.deepEqual(
    getDatabaseConfig({
      POSTGRES_HOST: "db.internal",
      POSTGRES_PORT: "15432",
      POSTGRES_DB: "bot",
      POSTGRES_USER: "runner",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_SSL: "1"
    }),
    {
      host: "db.internal",
      port: 15432,
      database: "bot",
      user: "runner",
      passwordSet: true,
      ssl: true
    }
  );
});

test("formatDatabaseConfig prints commands without revealing a password", () => {
  const output = formatDatabaseConfig(getDatabaseConfig({ POSTGRES_PASSWORD: "secret" }));

  assert.match(output, /Password: set/);
  assert.doesNotMatch(output, /secret/);
  assert.match(output, /npm run db:up/);
});
