import "server-only";
import { db } from "./db";

export type Account = {
  id: number;
  username: string;
  role: "admin" | "member";
  disabled: number;
  autoApprove: number;
  legacyId: number | null;
};
export const accountQuery = `SELECT u.id,u.username,l.legacy_id AS legacyId,
  COALESCE(p.role,lp.role,CASE WHEN l.is_admin=1 THEN 'admin' ELSE 'member' END) AS role,
  COALESCE(p.disabled,lp.disabled,CASE WHEN l.enabled=0 THEN 1 ELSE 0 END) AS disabled,
  COALESCE(p.auto_approve,lp.auto_approve,0) AS autoApprove
  FROM users u LEFT JOIN legacy_accounts l ON l.user_id=u.id
  LEFT JOIN account_policy p ON p.account_key='local:'||u.id
  LEFT JOIN account_policy lp ON lp.account_key='legacy:'||l.legacy_id`;
export function getAccount(id: number) {
  return db().prepare(`${accountQuery} WHERE u.id=?`).get(id) as
    Account | undefined;
}
export function accountEnabled(id: number) {
  const user = getAccount(id);
  return !!user && !user.disabled;
}
