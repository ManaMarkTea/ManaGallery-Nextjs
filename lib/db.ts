import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const dataDirectory = path.resolve(
  process.env.RENDERGALLERY_DATA_DIR || path.join(process.cwd(), "storage"),
);
const globalDb = globalThis as typeof globalThis & {
  galleryDb?: DatabaseSync;
  legacySchemaReady?: boolean;
  adminSchemaVersion?: number;
  viewSchemaReady?: boolean;
  memberSchemaReady?: boolean;
  softwareSchemaReady?: boolean;
  commentsSchemaReady?: boolean;
};
export function db() {
  if (!globalDb.galleryDb) {
    mkdirSync(dataDirectory, { recursive: true });
    const connection = new DatabaseSync(
      path.join(dataDirectory, "gallery.sqlite"),
    );
    connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL, category_id INTEGER NOT NULL, filename TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, artwork_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS favorites (artwork_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(artwork_id,user_id));
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
    connection.exec(`CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS challenges (token TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id INTEGER, kind TEXT NOT NULL, expires INTEGER NOT NULL);`);
    globalDb.galleryDb = connection;
  }
  if (!globalDb.legacySchemaReady) {
    globalDb.galleryDb.exec(
      readFileSync(
        path.join(process.cwd(), "lib", "legacy-schema.sql"),
        "utf8",
      ),
    );
    globalDb.legacySchemaReady = true;
  }
  if (!globalDb.commentsSchemaReady) {
    globalDb.galleryDb.exec(readFileSync(path.join(process.cwd(), "lib", "comments-schema.sql"), "utf8"));
    globalDb.commentsSchemaReady = true;
  }
  if (globalDb.adminSchemaVersion !== 3) {
    const columns = globalDb.galleryDb
      .prepare("PRAGMA table_info(legacy_accounts)")
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "is_admin"))
      globalDb.galleryDb.exec(
        "ALTER TABLE legacy_accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
      );
    globalDb.galleryDb.exec(
      readFileSync(path.join(process.cwd(), "lib", "admin-schema.sql"), "utf8"),
    );
    const metadataColumns = globalDb.galleryDb
      .prepare("PRAGMA table_info(artwork_metadata)")
      .all() as { name: string }[];
    if (!metadataColumns.some((c) => c.name === "moderated"))
      globalDb.galleryDb.exec(
        "ALTER TABLE artwork_metadata ADD COLUMN moderated INTEGER NOT NULL DEFAULT 0",
      );
    const policyColumns = globalDb.galleryDb
      .prepare("PRAGMA table_info(account_policy)")
      .all() as { name: string }[];
    if (!policyColumns.some((c) => c.name === "auto_approve"))
      globalDb.galleryDb.exec(
        "ALTER TABLE account_policy ADD COLUMN auto_approve INTEGER CHECK(auto_approve IN (0,1))",
      );
    const uploadColumns = globalDb.galleryDb
      .prepare("PRAGMA table_info(uploads)")
      .all() as { name: string }[];
    if (!uploadColumns.some((c) => c.name === "approved"))
      globalDb.galleryDb.exec(
        "ALTER TABLE uploads ADD COLUMN approved INTEGER NOT NULL DEFAULT 1",
      );
    globalDb.adminSchemaVersion = 3;
  }
  if (!globalDb.viewSchemaReady) {
    globalDb.galleryDb.exec(
      readFileSync(path.join(process.cwd(), "lib", "view-schema.sql"), "utf8"),
    );
    globalDb.viewSchemaReady = true;
  }
  if (!globalDb.memberSchemaReady) {
    globalDb.galleryDb.exec(
      readFileSync(
        path.join(process.cwd(), "lib", "member-schema.sql"),
        "utf8",
      ),
    );
    globalDb.memberSchemaReady = true;
  }
  if (!globalDb.softwareSchemaReady) {
    globalDb.galleryDb.exec(
      readFileSync(
        path.join(process.cwd(), "lib", "software-schema.sql"),
        "utf8",
      ),
    );
    globalDb.softwareSchemaReady = true;
  }
  return globalDb.galleryDb;
}

export function rateLimit(key: string, limit: number, seconds: number) {
  const now = Date.now();
  db().prepare("DELETE FROM attempts WHERE expires < ?").run(now);
  const row = db()
    .prepare(
      `INSERT INTO attempts(key,count,expires) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,
    )
    .get(key, now + seconds * 1000) as { count: number };
  return row.count <= limit;
}
