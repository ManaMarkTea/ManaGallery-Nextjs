CREATE TABLE IF NOT EXISTS account_policy (
  account_key TEXT PRIMARY KEY,
  role TEXT CHECK(role IN ('admin','member')),
  disabled INTEGER CHECK(disabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS artwork_metadata (
  artwork_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  moderated INTEGER NOT NULL DEFAULT 0,
  updated TEXT NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS category_overrides (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
