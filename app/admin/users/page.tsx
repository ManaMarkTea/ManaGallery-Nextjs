import { requireAdmin, getManagedAccounts } from "@/lib/admin";
import {
  AdminHeading,
  AdminPagination,
  queryValues,
} from "@/components/admin-ui";
import { AccountAccessForm } from "@/components/admin-forms";
import { MemberActivity } from "@/components/admin-member-info";
export default async function Users({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdmin(),
    params = queryValues(await searchParams);
  const accounts = getManagedAccounts().filter(
    (a) =>
      (!params.q ||
        a.username.toLowerCase().includes(params.q.toLowerCase())) &&
      (!params.role || a.role === params.role) &&
      (!params.status || !!a.disabled === (params.status === "disabled")) &&
      (params.review !== "flagged" || !!a.reviewReason),
  );
  if (params.sort === "active")
    accounts.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  if (params.sort === "newest")
    accounts.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  if (params.sort === "uploads")
    accounts.sort(
      (a, b) => b.uploads + b.archiveArtworks - (a.uploads + a.archiveArtworks),
    );
  const pages = Math.max(1, Math.ceil(accounts.length / 25)),
    page = Math.min(
      pages,
      Math.max(1, Number.parseInt(params.page || "1") || 1),
    );
  return (
    <>
      <AdminHeading
        title="Community members"
        description="Manage membership and administrator access across local and Bryce accounts."
      />
      <section className="admin-card admin-library">
        <form action="/admin/users" className="admin-filters">
          <input
            name="q"
            aria-label="Search members"
            type="search"
            defaultValue={params.q}
            placeholder="Find a member by username…"
          />
          <select
            name="role"
            aria-label="Filter role"
            defaultValue={params.role}
          >
            <option value="">All roles</option>
            <option value="admin">Administrators</option>
            <option value="member">Members</option>
          </select>
          <select
            name="status"
            aria-label="Filter account status"
            defaultValue={params.status}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          <select
            name="review"
            aria-label="Filter username review"
            defaultValue={params.review}
          >
            <option value="">All usernames</option>
            <option value="flagged">Names needing review</option>
          </select>
          <button>Search</button>
          <select
            name="sort"
            aria-label="Sort members"
            defaultValue={params.sort}
          >
            <option value="">Username</option>
            <option value="active">Recently active</option>
            <option value="newest">Newest local accounts</option>
            <option value="uploads">Most artwork</option>
          </select>
        </form>
        <div className="admin-list-count">
          {accounts.length.toLocaleString()} members
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Account</th>
                <th>Dates & activity</th>
                <th>Contributions</th>
                <th>Access controls</th>
              </tr>
            </thead>
            <tbody>
              {accounts.slice((page - 1) * 25, page * 25).map((a) => (
                <tr key={a.key}>
                  <td>
                    <div className="admin-member-name">
                      <span className="admin-avatar">
                        {a.username.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{a.username}</strong>
                        <small>
                          {a.role === "admin"
                            ? "Administrator"
                            : "Community member"}
                        </small>
                        {a.reviewReason && (
                          <span
                            className="admin-badge muted"
                            title={a.reviewReason}
                          >
                            Needs name review
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`admin-badge ${a.disabled ? "muted" : "success"}`}
                    >
                      {a.disabled ? "Disabled" : "Active"}
                    </span>
                    <small className="admin-source">{a.source}</small>
                    <small className="admin-source">
                      {a.key} · Auto upload {a.autoApprove ? "on" : "off"}
                    </small>
                  </td>
                  <td>
                    <MemberActivity account={a} />
                  </td>
                  <td>
                    <strong>{a.uploads + a.archiveArtworks} artworks</strong>
                    <small className="admin-source">
                      {a.uploads} uploads · {a.archiveArtworks} archived
                    </small>
                    <small className="admin-source">
                      {a.pendingUploads} awaiting approval
                    </small>
                    <small className="admin-source">
                      {a.comments} comments · {a.favorites} favorites
                    </small>
                  </td>
                  <td>
                    <AccountAccessForm account={a} self={a.id === user.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!accounts.length && (
          <div className="admin-empty">No members match your filters.</div>
        )}
        <AdminPagination
          page={page}
          pages={pages}
          base="/admin/users"
          params={params}
        />
      </section>
      <p className="admin-footnote">
        Dates are UTC. Login totals start with the new activity tracker; older
        successful logins cannot be reconstructed. Last active reflects
        authenticated requests, updated at most once a minute. Historical Bryce
        visits are separate from new-site logins. Name-review flags identify
        possible legacy text damage or spam; they do not automatically disable
        accounts. Disabling a member revokes their sessions. Changes apply
        immediately and survive account re-imports. Your own administrative
        access is protected.
      </p>
    </>
  );
}
