import "server-only";
import { notFound, redirect } from "next/navigation";
import { getUser } from "./auth";
import { db } from "./db";
import { accountQuery } from "./accounts";
import { usernameReviewReason } from "./usernames";
import type { Account } from "./accounts";

export async function requireAdmin() {
  const user = await getUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") notFound();
  return user;
}
export type ManagedAccount = {
  key: string;
  id: number | null;
  username: string;
  role: "admin" | "member";
  disabled: number;
  source: string;
  reviewReason: string | null;
  created: string | null;
  legacyJoined: number | null;
  legacyLastVisit: number | null;
  lastLogin: number | null;
  lastSeen: number | null;
  loginCount: number;
  loginMethod: string | null;
  autoApprove: boolean;
  uploads: number;
  pendingUploads: number;
  archiveArtworks: number;
  comments: number;
  favorites: number;
  passkeys: number;
  sessions: number;
};
export function getManagedAccounts(): ManagedAccount[] {
  const counts = (sql: string, ...args: number[]) =>
    new Map(
      (
        db()
          .prepare(sql)
          .all(...args) as { id: number; n: number }[]
      ).map((r) => [r.id, r.n]),
    );
  const uploads = counts(
    "SELECT user_id AS id,count(*) AS n FROM uploads GROUP BY user_id",
  );
  const pendingUploads = counts(
    "SELECT user_id AS id,count(*) AS n FROM uploads WHERE approved=0 GROUP BY user_id",
  );
  const archive = counts(
    "SELECT legacy_user_id AS id,count(*) AS n FROM legacy_artwork GROUP BY legacy_user_id",
  );
  const comments = counts(
    "SELECT user_id AS id,count(*) AS n FROM comment_feed WHERE moderation_reason IS NULL GROUP BY user_id",
  );
  const legacyComments = counts("SELECT legacy_user_id AS id,count(*) AS n FROM legacy_comments c LEFT JOIN comment_moderation m ON m.comment_id=-c.legacy_id WHERE c.deleted=0 AND m.comment_id IS NULL GROUP BY legacy_user_id");
  const favorites = counts(
    "SELECT user_id AS id,count(*) AS n FROM favorites GROUP BY user_id",
  );
  const passkeys = counts(
    "SELECT user_id AS id,count(*) AS n FROM passkeys GROUP BY user_id",
  );
  const sessions = counts(
    "SELECT user_id AS id,count(*) AS n FROM sessions WHERE expires>? GROUP BY user_id",
    Date.now(),
  );
  const local = db()
    .prepare(
      accountQuery.replace(
        "SELECT u.id,u.username,",
        "SELECT u.id,u.username,u.created,a.last_login AS lastLogin,a.last_seen AS lastSeen,a.login_count AS loginCount,a.login_method AS loginMethod,d.joined AS legacyJoined,d.last_visit AS legacyLastVisit,",
      ) +
        " LEFT JOIN account_activity a ON a.user_id=u.id LEFT JOIN legacy_account_dates d ON d.legacy_id=l.legacy_id",
    )
    .all() as (Account & {
    created: string;
    lastLogin: number | null;
    lastSeen: number | null;
    loginCount: number | null;
    loginMethod: string | null;
    legacyJoined: number | null;
    legacyLastVisit: number | null;
  })[];
  const pending = db()
    .prepare(
      `SELECT l.legacy_id,l.username,d.joined AS legacyJoined,d.last_visit AS legacyLastVisit,COALESCE(p.auto_approve,0) AS autoApprove,COALESCE(p.role,CASE WHEN l.is_admin=1 THEN 'admin' ELSE 'member' END) AS role,COALESCE(p.disabled,1-l.enabled) AS disabled FROM legacy_accounts l LEFT JOIN account_policy p ON p.account_key='legacy:'||l.legacy_id LEFT JOIN legacy_account_dates d ON d.legacy_id=l.legacy_id WHERE l.user_id IS NULL`,
    )
    .all() as {
    legacy_id: number;
    username: string;
    role: "admin" | "member";
    disabled: number;
    legacyJoined: number | null;
    legacyLastVisit: number | null;
    autoApprove: number;
  }[];
  return [
    ...local.map((u) => ({
      key: `local:${u.id}`,
      id: u.id,
      username: u.username,
      role: u.role,
      disabled: u.disabled,
      source: u.legacyId ? "Bryce · linked" : "Local",
      created: u.created,
      legacyJoined: u.legacyJoined,
      legacyLastVisit: u.legacyLastVisit,
      lastLogin: u.lastLogin,
      lastSeen: u.lastSeen,
      loginCount: u.loginCount || 0,
      loginMethod: u.loginMethod,
      autoApprove: u.role === "admin" || !!u.autoApprove,
      uploads: uploads.get(u.id) || 0,
      pendingUploads: pendingUploads.get(u.id) || 0,
      archiveArtworks: u.legacyId ? archive.get(u.legacyId) || 0 : 0,
      comments: comments.get(u.id) || 0,
      favorites: favorites.get(u.id) || 0,
      passkeys: passkeys.get(u.id) || 0,
      sessions: sessions.get(u.id) || 0,
    })),
    ...pending.map((u) => ({
      key: `legacy:${u.legacy_id}`,
      id: null,
      username: u.username,
      role: u.role,
      disabled: u.disabled,
      source: "Bryce · not signed in",
      created: null,
      legacyJoined: u.legacyJoined,
      legacyLastVisit: u.legacyLastVisit,
      lastLogin: null,
      lastSeen: null,
      loginCount: 0,
      loginMethod: null,
      autoApprove: u.role === "admin" || !!u.autoApprove,
      uploads: 0,
      pendingUploads: 0,
      archiveArtworks: archive.get(u.legacy_id) || 0,
      comments: legacyComments.get(u.legacy_id) || 0,
      favorites: 0,
      passkeys: 0,
      sessions: 0,
    })),
  ]
    .map((a) => ({ ...a, reviewReason: usernameReviewReason(a.username) }))
    .sort((a, b) => a.username.localeCompare(b.username));
}
export function getAudit(limit = 50) {
  return db()
    .prepare(
      "SELECT a.id,a.action,a.target,a.label,a.created,u.username FROM audit_log a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ?",
    )
    .all(limit) as {
    id: number;
    action: string;
    target: string;
    label: string;
    created: string;
    username: string;
  }[];
}
