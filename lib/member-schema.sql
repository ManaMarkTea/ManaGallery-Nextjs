CREATE TABLE IF NOT EXISTS account_activity (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_login INTEGER,
  last_seen INTEGER NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 0,
  login_method TEXT
);
CREATE TABLE IF NOT EXISTS legacy_account_dates (
  legacy_id INTEGER PRIMARY KEY,
  joined INTEGER,
  last_visit INTEGER
);
