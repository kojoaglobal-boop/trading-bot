export function getDatabaseConfig(env = process.env) {
  return {
    host: env.POSTGRES_HOST || "localhost",
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || "trading_bot",
    user: env.POSTGRES_USER || "trading_bot",
    passwordSet: Boolean(env.POSTGRES_PASSWORD),
    ssl: env.POSTGRES_SSL === "1"
  };
}

export function formatDatabaseConfig(config = getDatabaseConfig()) {
  return `Database
========
Host: ${config.host}
Port: ${config.port}
Database: ${config.database}
User: ${config.user}
Password: ${config.passwordSet ? "set" : "using local Docker default"}
SSL: ${config.ssl ? "on" : "off"}

Commands:
  npm run db:up       Start Postgres in Docker
  npm run db:status   Check the database container
  npm run db:schema   Re-apply db/schema.sql
  npm run db:down     Stop the database
`;
}
