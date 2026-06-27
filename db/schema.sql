CREATE TABLE IF NOT EXISTS bot_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  strategy TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  starting_cash NUMERIC(18, 6),
  ending_equity NUMERIC(18, 6),
  max_drawdown_pct NUMERIC(10, 6),
  win_rate_pct NUMERIC(10, 6),
  profit_factor NUMERIC(18, 6),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS market_bars (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  venue TEXT,
  bar_time TIMESTAMPTZ NOT NULL,
  open NUMERIC(18, 8) NOT NULL,
  high NUMERIC(18, 8) NOT NULL,
  low NUMERIC(18, 8) NOT NULL,
  close NUMERIC(18, 8) NOT NULL,
  volume NUMERIC(24, 8) DEFAULT 0,
  bid NUMERIC(18, 8),
  ask NUMERIC(18, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, mode, symbol, bar_time)
);

CREATE TABLE IF NOT EXISTS strategy_signals (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT REFERENCES bot_runs(run_id) ON DELETE CASCADE,
  signal_time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence NUMERIC(10, 6),
  reason TEXT,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT REFERENCES bot_runs(run_id) ON DELETE CASCADE,
  decision_time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  requested_action TEXT NOT NULL,
  approved BOOLEAN NOT NULL,
  rule TEXT NOT NULL,
  reason TEXT,
  risk_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_orders (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT REFERENCES bot_runs(run_id) ON DELETE SET NULL,
  broker TEXT NOT NULL,
  broker_order_id TEXT,
  client_order_id TEXT,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  time_in_force TEXT,
  qty NUMERIC(24, 8),
  notional NUMERIC(18, 6),
  limit_price NUMERIC(18, 8),
  status TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fills (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES broker_orders(id) ON DELETE CASCADE,
  broker_fill_id TEXT,
  fill_time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty NUMERIC(24, 8) NOT NULL,
  price NUMERIC(18, 8) NOT NULL,
  commission NUMERIC(18, 8) DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  snapshot_time TIMESTAMPTZ NOT NULL,
  cash NUMERIC(18, 6),
  buying_power NUMERIC(18, 6),
  equity NUMERIC(18, 6),
  daily_pnl NUMERIC(18, 6),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_bars_symbol_time
  ON market_bars (symbol, bar_time DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_run_time
  ON strategy_signals (run_id, signal_time DESC);

CREATE INDEX IF NOT EXISTS idx_risk_decisions_run_time
  ON risk_decisions (run_id, decision_time DESC);

CREATE INDEX IF NOT EXISTS idx_broker_orders_status
  ON broker_orders (broker, status, updated_at DESC);
