PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT UNIQUE,
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  phone_verified_at TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'operator', 'admin')),
  display_name TEXT,
  invoice_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  locale TEXT NOT NULL DEFAULT 'en-IN',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  referral_code TEXT NOT NULL UNIQUE,
  referred_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_prefix TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, feature, source, starts_at)
);
CREATE INDEX entitlements_lookup_idx ON entitlements(user_id, feature, starts_at, expires_at);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('signup', 'refill', 'promotion', 'debit', 'refund', 'adjustment', 'referral')),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  expires_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, reference_type, reference_id, kind)
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger(user_id, created_at);

CREATE TRIGGER credit_ledger_prevent_negative
BEFORE INSERT ON credit_ledger
WHEN NEW.amount < 0 AND (
  COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = NEW.user_id AND (expires_at IS NULL OR expires_at > NEW.created_at)), 0)
  + NEW.amount
) < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_CREDITS');
END;

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  latest_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_version > 0),
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX strategies_user_idx ON strategies(user_id, deleted_at, archived_at, updated_at DESC);

CREATE TABLE strategy_versions (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  schema_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(strategy_id, version),
  UNIQUE(strategy_id, config_hash)
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('strategy_version', 'basket', 'builder_strategy')),
  resource_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX share_links_owner_idx ON share_links(user_id, resource_type, resource_id);

CREATE TABLE baskets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  notes TEXT,
  common_config_json TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX baskets_user_idx ON baskets(user_id, folder_id, archived_at, updated_at DESC);

CREATE TABLE basket_items (
  id TEXT PRIMARY KEY,
  basket_id TEXT NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  multiplier INTEGER NOT NULL DEFAULT 1 CHECK (multiplier BETWEEN 1 AND 100),
  selected INTEGER NOT NULL DEFAULT 1 CHECK (selected IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(basket_id, strategy_version_id)
);
CREATE INDEX basket_items_order_idx ON basket_items(basket_id, position);

CREATE TABLE datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('synthetic', 'licensed', 'user_provider', 'sample')),
  rights_json TEXT NOT NULL,
  quality_grade TEXT NOT NULL CHECK (quality_grade IN ('A', 'B', 'C', 'D', 'F')),
  instrument_master_version TEXT NOT NULL,
  calendar_version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(name, version)
);

CREATE TABLE dataset_partitions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  quality_grade TEXT NOT NULL CHECK (quality_grade IN ('A', 'B', 'C', 'D', 'F')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(dataset_id, symbol, trade_date)
);
CREATE INDEX dataset_partitions_manifest_idx ON dataset_partitions(dataset_id, symbol, trade_date);

CREATE TABLE backtest_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_version_id TEXT REFERENCES strategy_versions(id),
  basket_id TEXT REFERENCES baskets(id),
  dataset_id TEXT REFERENCES datasets(id),
  state TEXT NOT NULL CHECK (state IN ('draft', 'validated', 'preparing_data', 'running', 'aggregating', 'completed', 'validation_failed', 'data_failed', 'cancelled', 'failed')),
  adapter TEXT NOT NULL CHECK (adapter IN ('browser_worker', 'local_cli', 'hosted_job')),
  request_hash TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  manifest_json TEXT,
  summary_json TEXT,
  result_object_key TEXT,
  result_sha256 TEXT,
  quality_grade TEXT CHECK (quality_grade IS NULL OR quality_grade IN ('A', 'B', 'C', 'D', 'F')),
  credit_cost INTEGER NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((strategy_version_id IS NOT NULL) <> (basket_id IS NOT NULL))
);
CREATE INDEX backtest_runs_user_idx ON backtest_runs(user_id, created_at DESC);

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(user_id, scope, idempotency_key)
);

CREATE TABLE paper_portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  starting_capital_paise INTEGER NOT NULL CHECK (starting_capital_paise >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE broker_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error')),
  encrypted_token_object_key TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id, broker, mode)
);

CREATE TABLE trade_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id TEXT REFERENCES paper_portfolios(id),
  broker_connection_id TEXT REFERENCES broker_connections(id),
  mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'entry_pending', 'open', 'exit_pending', 'closed', 'partial', 'failed', 'cancelled')),
  symbol TEXT NOT NULL,
  draft_orders_json TEXT NOT NULL,
  quote_as_of TEXT NOT NULL,
  confirmation_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX trade_groups_user_idx ON trade_groups(user_id, created_at DESC);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  trade_group_id TEXT NOT NULL REFERENCES trade_groups(id) ON DELETE CASCADE,
  client_order_id TEXT NOT NULL,
  broker_order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'submitted', 'acknowledged', 'partial', 'filled', 'cancelled', 'rejected', 'unknown')),
  request_json TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(trade_group_id, client_order_id)
);

CREATE TABLE fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider_fill_id TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  fees_paise INTEGER NOT NULL DEFAULT 0 CHECK (fees_paise >= 0),
  filled_at TEXT NOT NULL,
  UNIQUE(order_id, provider_fill_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  trace_id TEXT NOT NULL,
  ip_prefix TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX audit_events_resource_idx ON audit_events(resource_type, resource_id, created_at);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_user_id, created_at);

CREATE TRIGGER audit_events_immutable_update
BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_EVENTS_ARE_IMMUTABLE'); END;
CREATE TRIGGER audit_events_immutable_delete
BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_EVENTS_ARE_IMMUTABLE'); END;
CREATE TRIGGER strategy_versions_immutable_update
BEFORE UPDATE ON strategy_versions BEGIN SELECT RAISE(ABORT, 'STRATEGY_VERSIONS_ARE_IMMUTABLE'); END;
CREATE TRIGGER strategy_versions_immutable_delete
BEFORE DELETE ON strategy_versions BEGIN SELECT RAISE(ABORT, 'STRATEGY_VERSIONS_ARE_IMMUTABLE'); END;

CREATE TABLE rate_limit_windows (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limit_expiry_idx ON rate_limit_windows(expires_at);

CREATE TABLE system_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  reason TEXT,
  updated_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

INSERT INTO system_flags(key, value, reason, updated_at)
VALUES ('global_trading_kill_switch', 'true', 'Live trading is disabled until the regulatory release gate is approved.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO datasets(
  id, name, version, source_type, rights_json, quality_grade, instrument_master_version,
  calendar_version, active, published_at, created_at
) VALUES (
  'dset_synthetic_v1', 'Dokimi Synthetic Index Options', '1.0.0', 'synthetic',
  '{"display":true,"redistribution":true,"purpose":"demo-only"}', 'A', 'synthetic-1.0.0',
  'demo-nse-1.0.0', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
