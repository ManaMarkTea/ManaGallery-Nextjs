CREATE TABLE IF NOT EXISTS artwork_viewers (
  artwork_id INTEGER NOT NULL,
  viewer_key TEXT NOT NULL,
  claimed_by TEXT,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY(artwork_id,viewer_key)
);
CREATE INDEX IF NOT EXISTS artwork_unique_counts ON artwork_viewers(artwork_id) WHERE claimed_by IS NULL;
