import pg from "pg";
import { getDatabaseConfig } from "./database-config.js";

const { Pool } = pg;

export function createDatabasePool(env = process.env) {
  if (env.DATABASE_URL) {
    return new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.POSTGRES_SSL === "1" ? { rejectUnauthorized: false } : undefined
    });
  }

  const config = getDatabaseConfig(env);
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: env.POSTGRES_PASSWORD || "trading_bot_dev_password",
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined
  });
}

export async function withDatabaseClient(work, { pool = createDatabasePool() } = {}) {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}
