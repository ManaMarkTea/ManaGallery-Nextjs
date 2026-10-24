import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";

export function browserViewKey(token: string) {
  return "b:" + createHash("sha256").update(token).digest("hex");
}
export function uniqueViewCount(id: number) {
  return (
    db()
      .prepare(
        "SELECT COUNT(*) AS n FROM artwork_viewers WHERE artwork_id=? AND claimed_by IS NULL",
      )
      .get(id) as { n: number }
  ).n;
}

export function recordUniqueView(
  id: number,
  browserKey: string,
  userId?: number,
) {
  const accountKey =
    userId === undefined
      ? null
      : "u:" + createHash("sha256").update(`account:${userId}`).digest("hex");
  db().exec("BEGIN IMMEDIATE");
  try {
    if (accountKey) {
      db()
        .prepare(
          "INSERT OR IGNORE INTO artwork_viewers(artwork_id,viewer_key,first_seen) VALUES (?,?,?)",
        )
        .run(id, accountKey, Date.now());
      // An anonymous visit belongs to the first account subsequently used in
      // that browser. Claim it instead of counting the same visit twice.
      // Other accounts sharing the browser still receive their own unique view.
      db()
        .prepare(
          `INSERT INTO artwork_viewers(artwork_id,viewer_key,claimed_by,first_seen) VALUES (?,?,?,?) ON CONFLICT(artwork_id,viewer_key) DO UPDATE SET claimed_by=COALESCE(artwork_viewers.claimed_by,excluded.claimed_by)`,
        )
        .run(id, browserKey, accountKey, Date.now());
    } else {
      db()
        .prepare(
          "INSERT OR IGNORE INTO artwork_viewers(artwork_id,viewer_key,first_seen) VALUES (?,?,?)",
        )
        .run(id, browserKey, Date.now());
    }
    const views = uniqueViewCount(id);
    db().exec("COMMIT");
    return views;
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
