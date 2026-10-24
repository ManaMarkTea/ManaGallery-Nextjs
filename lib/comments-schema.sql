CREATE TABLE IF NOT EXISTS legacy_comments (
  legacy_id INTEGER PRIMARY KEY CHECK(legacy_id > 0),
  artwork_id INTEGER NOT NULL,
  legacy_user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL,
  created TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS legacy_comments_artwork ON legacy_comments(artwork_id,deleted);
CREATE TABLE IF NOT EXISTS comment_moderation (
  comment_id INTEGER PRIMARY KEY,
  reason TEXT NOT NULL
);
CREATE VIEW IF NOT EXISTS comment_feed AS
SELECT entries.*,m.reason AS moderation_reason FROM (
  SELECT c.id,c.artwork_id,c.user_id,c.body,c.created,u.username,0 AS archived
  FROM comments c JOIN users u ON u.id=c.user_id
  UNION ALL
  SELECT -c.legacy_id,c.artwork_id,l.user_id,c.body,c.created,
    COALESCE(u.username,NULLIF(c.username,''),l.username,'Former member'),1
  FROM legacy_comments c
  LEFT JOIN legacy_accounts l ON l.legacy_id=c.legacy_user_id
  LEFT JOIN users u ON u.id=l.user_id
  WHERE c.deleted=0
) entries LEFT JOIN comment_moderation m ON m.comment_id=entries.id;
