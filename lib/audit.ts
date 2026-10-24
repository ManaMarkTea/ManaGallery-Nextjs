import "server-only";
import { db } from "./db";
export function audit(
  actor: number,
  action: string,
  target: string,
  label: string,
) {
  db()
    .prepare(
      "INSERT INTO audit_log(actor_id,action,target,label) VALUES (?,?,?,?)",
    )
    .run(actor, action, target, label.slice(0, 160));
}
