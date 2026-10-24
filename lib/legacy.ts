import "server-only";
import { db } from "./db";
import { hashPassword } from "./auth";
import { verifyLegacyPassword } from "./legacy-password";

type LegacyAccount = {
  legacy_id: number;
  username: string;
  password: string | null;
  enabled: number;
  user_id: number | null;
};
export async function migrateLegacyLogin(
  username: string,
  password: string,
  linkTo?: number,
): Promise<{ id?: number; error?: string }> {
  const account = db()
    .prepare(
      "SELECT l.legacy_id,l.username,l.password,l.user_id,1-COALESCE(p.disabled,1-l.enabled) AS enabled FROM legacy_accounts l LEFT JOIN account_policy p ON p.account_key='legacy:'||l.legacy_id WHERE l.username=?",
    )
    .get(username) as LegacyAccount | undefined;
  if (
    !account ||
    !account.enabled ||
    !account.password ||
    account.user_id ||
    !verifyLegacyPassword(password, account.password)
  )
    return {};
  const collision = db()
    .prepare("SELECT id FROM users WHERE username=?")
    .get(account.username) as { id: number } | undefined;
  if (linkTo === undefined && collision)
    return {
      error:
        "This Bryce username overlaps an existing local account. Sign in with its local password, then link your Bryce account in My account.",
    };
  if (
    linkTo !== undefined &&
    db().prepare("SELECT 1 FROM legacy_accounts WHERE user_id=?").get(linkTo)
  )
    return { error: "This local account is already linked to Bryce." };
  const hash = linkTo === undefined ? await hashPassword(password) : null;
  db().exec("BEGIN IMMEDIATE");
  try {
    // Recheck inside the transaction so concurrent sign-ins cannot claim twice.
    const current = db()
      .prepare(
        "SELECT l.user_id,l.password,1-COALESCE(p.disabled,1-l.enabled) AS enabled FROM legacy_accounts l LEFT JOIN account_policy p ON p.account_key='legacy:'||l.legacy_id WHERE l.legacy_id=?",
      )
      .get(account.legacy_id) as LegacyAccount;
    if (
      current.user_id ||
      !current.enabled ||
      current.password !== account.password
    ) {
      db().exec("ROLLBACK");
      return {};
    }
    const id =
      linkTo ??
      Number(
        db()
          .prepare("INSERT INTO users(username,password) VALUES (?,?)")
          .run(account.username, hash!).lastInsertRowid,
      );
    db()
      .prepare(
        "UPDATE legacy_accounts SET user_id=?,password=NULL,migrated=? WHERE legacy_id=?",
      )
      .run(id, new Date().toISOString(), account.legacy_id);
    db().exec("COMMIT");
    return { id };
  } catch (error) {
    db().exec("ROLLBACK");
    if (String(error).includes("UNIQUE"))
      return {
        error:
          "An account with that name already exists. Sign in with its local password and link Bryce from My account.",
      };
    throw error;
  }
}
