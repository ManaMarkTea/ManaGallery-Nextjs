import { requireAdmin } from "@/lib/admin";
import { loadGallery } from "@/lib/gallery";
import {
  AdminHeading,
  AdminPagination,
  queryValues,
} from "@/components/admin-ui";
import { ArtworkAdminTable } from "@/components/admin-forms";
import { getAccount } from "@/lib/accounts";
export default async function Artworks({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = queryValues(await searchParams);
  const { items, categories } = await loadGallery();
  let filtered = items.filter(
    (i) =>
      (!params.q ||
        `${i.title} ${i.author} ${i.tags} ${i.id}`
          .toLowerCase()
          .includes(params.q.toLowerCase())) &&
      (!params.category || String(i.categoryId) === params.category) &&
      (!params.status ||
        (params.status === "pending"
          ? i.pending
          : params.status === "hidden"
            ? i.hidden
            : !i.hidden)) &&
      (!params.source ||
        (params.source === "uploads" ? i.ownerId : !i.ownerId)),
  );
  filtered = filtered.toSorted(
    params.sort === "title"
      ? (a, b) => a.title.localeCompare(b.title)
      : (a, b) => (b.date || "").localeCompare(a.date || ""),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 30)),
    page = Math.min(
      pages,
      Math.max(1, Number.parseInt(params.page || "1") || 1),
    );
  return (
    <>
      <AdminHeading
        title={
          params.status === "pending" ? "Review uploads" : "Artwork library"
        }
        description="Find a render, refine its details, or decide what appears in the gallery."
      />
      {params.status === "pending" && (
        <p>
          Publish selected uploads after reviewing them. Auto upload controls
          future uploads by that member; it does not approve existing
          submissions.
        </p>
      )}
      <section className="admin-card admin-library">
        <form className="admin-filters" action="/admin/artworks">
          <input
            aria-label="Search artwork"
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="Search title, artist, tag, or ID…"
          />
          <select
            aria-label="Filter category"
            name="category"
            defaultValue={params.category}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter visibility"
            name="status"
            defaultValue={params.status}
          >
            <option value="">All statuses</option>
            <option value="public">Published</option>
            <option value="pending">Awaiting approval</option>
            <option value="hidden">Hidden</option>
          </select>
          <select
            aria-label="Filter source"
            name="source"
            defaultValue={params.source}
          >
            <option value="">All artwork</option>
            <option value="uploads">New uploads</option>
            <option value="archive">Bryce archive</option>
          </select>
          <select
            aria-label="Sort artwork"
            name="sort"
            defaultValue={params.sort}
          >
            <option value="recent">Newest first</option>
            <option value="title">Title A–Z</option>
          </select>
          <button>Search</button>
        </form>
        <div className="admin-list-count">
          {filtered.length.toLocaleString()} artworks{" "}
          <span>
            · Showing {(page - 1) * 30 + Math.min(1, filtered.length)}–
            {Math.min(page * 30, filtered.length)}
          </span>
        </div>
        <ArtworkAdminTable
          items={filtered.slice((page - 1) * 30, page * 30)}
          approvalByUser={Object.fromEntries(
            filtered
              .filter((i) => i.ownerId)
              .map((i) => [i.ownerId!, !!getAccount(i.ownerId!)?.autoApprove]),
          )}
        />
        <AdminPagination
          page={page}
          pages={pages}
          base="/admin/artworks"
          params={params}
        />
      </section>
    </>
  );
}
