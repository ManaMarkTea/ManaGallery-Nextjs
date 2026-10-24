import type { ManagedAccount } from "@/lib/admin";

function date(value: string | number | null) {
  if (value === null) return "Not recorded";
  const parsed = new Date(
    typeof value === "string" && !value.includes("T")
      ? value.replace(" ", "T") + "Z"
      : value,
  );
  return Number.isNaN(parsed.getTime())
    ? "Not recorded"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(parsed) + " UTC";
}
export function MemberActivity({ account: a }: { account: ManagedAccount }) {
  return (
    <details className="admin-member-details">
      <summary>
        {a.lastSeen ? `Active ${date(a.lastSeen)}` : "Dates & activity"}
      </summary>
      <dl>
        <dt>Joined Bryce</dt>
        <dd>{date(a.legacyJoined)}</dd>
        <dt>Local account created</dt>
        <dd>{date(a.created)}</dd>
        <dt>Last login</dt>
        <dd>{date(a.lastLogin)}</dd>
        <dt>Last active</dt>
        <dd>{date(a.lastSeen)}</dd>
        <dt>Successful logins</dt>
        <dd>{a.loginCount} since tracking began</dd>
        <dt>Last login method</dt>
        <dd>{a.loginMethod || "Not recorded"}</dd>
        <dt>Last Bryce visit</dt>
        <dd>{date(a.legacyLastVisit)}</dd>
        <dt>Active sessions</dt>
        <dd>{a.sessions}</dd>
        <dt>Passkeys</dt>
        <dd>{a.passkeys}</dd>
      </dl>
    </details>
  );
}
