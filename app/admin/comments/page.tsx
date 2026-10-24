import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { loadGallery } from "@/lib/gallery";
import {
  AdminHeading,
  AdminPagination,
  queryValues,
} from "@/components/admin-ui";
import { DeleteAdminComment } from "@/components/admin-forms";
import { publishComment } from "@/app/admin/actions";
export default async function Comments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = queryValues(await searchParams),
    q = `%${params.q || ""}%`;
  const condition = params.status === "pending" ? "moderation_reason IS NOT NULL" : params.status === "published" ? "moderation_reason IS NULL" : "1=1";
  const pending = (db().prepare("SELECT count(*) AS n FROM comment_feed WHERE moderation_reason IS NOT NULL").get() as { n: number }).n;
  const count = (
    db()
      .prepare(
        `SELECT count(*) AS n FROM comment_feed WHERE (body LIKE ? OR username LIKE ?) AND ${condition}`,
      )
      .get(q, q) as { n: number }
  ).n;
  const pages = Math.max(1, Math.ceil(count / 30)),
    page = Math.min(
      pages,
      Math.max(1, Number.parseInt(params.page || "1") || 1),
    );
  const rows = db()
    .prepare(
      `SELECT id,body,artwork_id,created,username,archived,moderation_reason FROM comment_feed WHERE (body LIKE ? OR username LIKE ?) AND ${condition} ORDER BY created DESC,id DESC LIMIT 30 OFFSET ?`,
    )
    .all(q, q, (page - 1) * 30) as {
    id: number;
    body: string;
    artwork_id: number;
    created: string;
    username: string;
    archived: number;
    moderation_reason: string | null;
  }[];
  const { items } = await loadGallery();
  const titles = new Map(items.map((i) => [i.id, i.title]));
  return (
    <>
      <AdminHeading
        title="Community conversations"
        description="Review recent comments and keep the gallery welcoming."
      />
      <section className="admin-card admin-library">
        <form action="/admin/comments" className="admin-filters">
          <select name="status" aria-label="Comment status" defaultValue={params.status || "all"}>
            <option value="all">All comments</option>
            <option value="pending">Needs review ({pending})</option>
            <option value="published">Published</option>
          </select>
          <input
            name="q"
            type="search"
            aria-label="Search comments"
            defaultValue={params.q}
            placeholder="Search comments or usernames…"
          />
          <button>Search</button>
        </form>
        <div className="admin-list-count">
          {count.toLocaleString()} comments · <Link href="/admin/comments?status=pending">{pending.toLocaleString()} need review</Link>
        </div>
        {rows.map((c) => (
          <article key={c.id} className="admin-comment">
            <div className="admin-comment-heading">
              <span className="admin-avatar">
                {c.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{c.username}</strong>
                <small>
                  {c.created} UTC{c.archived ? " · Archived" : ""} ·{" "}
                  <Link href={`/art/${c.artwork_id}`}>
                    {titles.get(c.artwork_id) || `Artwork #${c.artwork_id}`}
                  </Link>
                </small>
              </div>
            </div>
            <p>{c.body}</p>
            {c.moderation_reason && <>
              <p role="status">Held for review: {c.moderation_reason}</p>
              <form action={publishComment}>
                <input type="hidden" name="id" value={c.id} />
                <button>Approve comment</button>
              </form>
            </>}
            <DeleteAdminComment id={c.id} />
          </article>
        ))}
        {!rows.length && (
          <div className="admin-empty">
            <span>☰</span>
            <h3>All quiet here</h3>
            <p>New comments will appear here for review.</p>
          </div>
        )}
        <AdminPagination
          page={page}
          pages={pages}
          base="/admin/comments"
          params={params}
        />
      </section>
    </>
  );
}
