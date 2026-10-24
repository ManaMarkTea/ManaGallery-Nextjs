import { requireAdmin, getAudit } from "@/lib/admin";
import { AdminHeading } from "@/components/admin-ui";
export default async function Activity() {
  await requireAdmin();
  const rows = getAudit(100);
  return (
    <>
      <AdminHeading
        title="Activity log"
        description="The latest 100 edits, moderation decisions, and administrative changes."
      />
      <section className="admin-card admin-library">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Details</th>
                <th>By</th>
                <th>When (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.action}</strong>
                    <small className="admin-source">{a.target}</small>
                  </td>
                  <td>{a.label}</td>
                  <td>{a.username}</td>
                  <td className="admin-nowrap">{a.created}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="admin-empty">
            No activity recorded yet. Gallery changes will appear here.
          </div>
        )}
      </section>
    </>
  );
}
