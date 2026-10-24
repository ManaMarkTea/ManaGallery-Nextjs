CREATE TABLE IF NOT EXISTS legacy_accounts (
  legacy_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password TEXT,
  enabled INTEGER NOT NULL,
  user_id INTEGER UNIQUE REFERENCES users(id),
  migrated TEXT
);
CREATE TABLE IF NOT EXISTS legacy_artwork (
  artwork_id INTEGER PRIMARY KEY,
  legacy_user_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS legacy_artwork_user ON legacy_artwork(legacy_user_id);
