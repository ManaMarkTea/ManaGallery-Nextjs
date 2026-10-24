import "server-only";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "./db";
import { getAccount, accountEnabled } from "./accounts";

const scrypt = promisify(scryptCallback);
const cookieName = "rendergallery_session";
export type User = { id: number; username: string; role: "admin" | "member" };
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(stored)) return false;
  const [salt, value] = stored.split(":");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const session = db()
    .prepare("SELECT user_id FROM sessions WHERE token=? AND expires>?")
    .get(digest(token), Date.now()) as { user_id: number } | undefined;
  if (!session) return null;
  const user = getAccount(session.user_id);
  if (user && !user.disabled) {
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO account_activity(user_id,last_seen) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen WHERE account_activity.last_seen < ?",
      )
      .run(user.id, now, now - 60_000);
  }
  return user && !user.disabled
    ? { id: user.id, username: user.username, role: user.role }
    : null;
}
export async function createSession(
  userId: number,
  method?: "password" | "passkey" | "registration",
) {
  if (!accountEnabled(userId)) throw new Error("This account is inactive.");
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 14;
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db()
    .prepare("INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)")
    .run(digest(token), userId, expires);
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.SESSION_COOKIE_SECURE === "true" ||
      !!process.env.APP_ORIGIN?.startsWith("https:"),
    path: "/",
    expires: new Date(expires),
  });
  if (method) {
    const now = Date.now();
    if (method === "registration")
      db()
        .prepare(
          "INSERT INTO account_activity(user_id,last_seen) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen",
        )
        .run(userId, now);
    else
      db()
        .prepare(
          "INSERT INTO account_activity(user_id,last_login,last_seen,login_count,login_method) VALUES (?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET last_login=excluded.last_login,last_seen=excluded.last_seen,login_count=account_activity.login_count+1,login_method=excluded.login_method",
        )
        .run(userId, now, now, method);
  }
}
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token)
    db().prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
  jar.delete(cookieName);
}
