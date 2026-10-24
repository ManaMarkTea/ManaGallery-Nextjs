import Link from "next/link";
import { requireAdmin, getManagedAccounts, getAudit } from "@/lib/admin";
import { loadGallery } from "@/lib/gallery";
import { db } from "@/lib/db";
import { AdminHeading } from "@/components/admin-ui";
import { getBackupHealth } from "@/lib/operations";
export default async function Overview() {
  const user = await requireAdmin();
  const backups = await getBackupHealth();
  const backupFailures = backups.jobs.filter((job) => job.tone === "danger");
  const { items, categories } = await loadGallery();
  const accounts = getManagedAccounts();
  const activities = getAudit(7);
  const commentCount = (
    db().prepare("SELECT count(*) AS n FROM comment_feed").get() as {
      n: number;
    }
  ).n;
  const hidden = items.filter((i) => i.hidden).length;
  const uploads = items
    .filter((i) => i.ownerId)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const top = categories.toSorted((a, b) => b.count - a.count).slice(0, 6);
  const max = Math.max(1, ...top.map((c) => c.count));
  return (
    <>
      <AdminHeading
        eyebrow="YOUR COMMUNITY AT A GLANCE"
        title={`Welcome back, ${user.username}.`}
        description="A little oversight. A lot of imagination."
      >
        <Link className="admin-primary-link" href="/upload">
          + Add artwork
        </Link>
      </AdminHeading>
      <p className="admin-health-shortcut">
        <Link href="/admin/health">
          Check backups, server disk and upload storage →
        </Link>
      </p>
      {backupFailures.length > 0 && (
        <div className="admin-health-notice warning" role="status">
          <strong>Backup attention needed</strong>
          <p>
            {backupFailures
              .map((job) => `${job.name}: ${job.state.toLowerCase()}`)
              .join(" · ")}
          </p>
          <Link href="/admin/health">Review backup status →</Link>
        </div>
      )}
      <div className="admin-stats">
        {[
          [
            items.length,
            "Artworks",
            `${uploads.length} new uploads`,
            "/admin/artworks",
            "▧",
          ],
          [
            accounts.length,
            "Members",
            `${accounts.filter((a) => !a.disabled).length.toLocaleString()} active accounts`,
            "/admin/users",
            "♙",
          ],
          [
            categories.length,
            "Categories",
            "Places for every kind of world",
            "/admin/categories",
            "▦",
          ],
          [
            commentCount,
            "Comments",
            "Keep the conversation welcoming",
            "/admin/comments",
            "☰",
          ],
        ].map(([count, label, note, href, icon]) => (
          <Link className="admin-stat" href={String(href)} key={label}>
            <div>
              <span>{label}</span>
              <i aria-hidden="true">{icon}</i>
            </div>
            <strong>{Number(count).toLocaleString()}</strong>
            <small>{note}</small>
          </Link>
        ))}
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Across the gallery</h2>
              <p>Published artwork by category</p>
            </div>
            <Link href="/admin/categories">Manage ↗</Link>
          </div>
          <div className="admin-category-bars">
            {top.map((c) => (
              <div key={c.id}>
                <div>
                  <span>{c.name}</span>
                  <strong>{c.count.toLocaleString()}</strong>
                </div>
                <div className="admin-bar-track">
                  <span style={{ width: `${(c.count / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Publishing overview</h2>
              <p>What the community can see</p>
            </div>
            <span className="admin-badge success">Gallery online</span>
          </div>
          <div className="admin-publishing-count">
            <strong>{(items.length - hidden).toLocaleString()}</strong>
            <span>published artworks</span>
          </div>
          <div className="admin-summary-row">
            <span>Hidden from the gallery</span>
            <Link href="/admin/artworks?status=hidden">
              {hidden.toLocaleString()} →
            </Link>
          </div>
          <div className="admin-summary-row">
            <span>Members awaiting access</span>
            <Link href="/admin/users?status=disabled">
              {accounts.filter((a) => a.disabled).length.toLocaleString()} →
            </Link>
          </div>
          <p className="admin-card-note">
            Use visibility controls to moderate artwork. Original archive files
            remain preserved.
          </p>
        </section>
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Recent uploads</h2>
              <p>New work from your community</p>
            </div>
            <Link href="/admin/artworks?source=uploads">View all ↗</Link>
          </div>
          {uploads.length ? (
            uploads.slice(0, 4).map((i) => (
              <Link
                className="admin-recent-art"
                href={`/art/${i.id}/edit`}
                key={i.id}
              >
                <img src={i.image} alt="" />
                <div>
                  <strong>{i.title}</strong>
                  <small>
                    by {i.author} · {i.category}
                  </small>
                </div>
                <span>↗</span>
              </Link>
            ))
          ) : (
            <div className="admin-empty">
              <span>▧</span>
              <h3>The next world starts here</h3>
              <p>New uploads will appear in this space.</p>
              <Link href="/upload">Share artwork →</Link>
            </div>
          )}
        </section>
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Recent activity</h2>
              <p>A record of gallery changes</p>
            </div>
            <Link href="/admin/activity">All activity ↗</Link>
          </div>
          {activities.length ? (
            activities.map((a) => (
              <div className="admin-activity-item" key={a.id}>
                <span className="admin-activity-dot" />
                <div>
                  <strong>{a.action}</strong>
                  <p>{a.label}</p>
                  <small>
                    {a.username} · {a.created.slice(0, 16)} UTC
                  </small>
                </div>
              </div>
            ))
          ) : (
            <div className="admin-empty">
              <h3>A fresh start</h3>
              <p>Edits and administrative changes will be recorded here.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
