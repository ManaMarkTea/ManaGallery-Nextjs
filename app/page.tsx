import { Gallery } from "@/components/gallery";
import { getGalleryPage } from "@/lib/gallery";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { getAdsConfig } from "@/lib/ads";
import { Advertisement } from "@/components/advertisement";
import { SOFTWARE } from "@/lib/software";
import { DISCORD_URL } from "@/lib/community";

type SearchParams = Promise<{
  q?: string;
  category?: string;
  sort?: string;
  page?: string;
  software?: string;
  perPage?: string;
}>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { items, categories, total, pageCount, page, pageSize } =
    await getGalleryPage({
      query: params.q?.trim() ?? "",
      category: params.category ?? "",
      sort: params.sort ?? "recent",
      page: Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
      software: params.software || "",
      perPage: params.perPage,
    });
  const hasFilters = Boolean(params.q || params.category || params.software);
  const categoryHref = (id?: number) => {
    const query = new URLSearchParams();
    if (params.software) query.set("software", params.software);
    if (pageSize !== 24) query.set("perPage", String(pageSize));
    if (id) query.set("category", String(id));
    return query.size ? `/?${query}` : "/";
  };
  const user = await getUser();

  return (
    <main className="home-shell">
      <div className="gallery-titlebar">
        <span>Bryce roots. A world of rendering tools.</span>
        <span>Landscapes · Abstract · Sci-fi · 3D art</span>
      </div>
      <nav className="software-nav" aria-label="Software galleries">
        <Link
          href={pageSize === 24 ? "/" : `/?perPage=${pageSize}`}
          aria-current={!params.software ? "page" : undefined}
        >
          All software
        </Link>
        {SOFTWARE.map((s) => (
          <Link
            key={s.id}
            href={`/?software=${s.id}${pageSize === 24 ? "" : `&perPage=${pageSize}`}`}
            aria-current={params.software === s.id ? "page" : undefined}
          >
            {s.name}
          </Link>
        ))}
      </nav>
      <div className="gallery-shell">
        <aside className="sidebar">
          <section className="sidebar-panel">
            <h2>{user ? "Your account" : "Welcome, visitor"}</h2>
            <div className="sidebar-body">
              {user ? (
                <>
                  <p>
                    Signed in as <strong>{user.username}</strong>
                  </p>
                  <Link href="/account">My gallery & favorites</Link>
                  <Link href="/upload">Upload an image →</Link>
                </>
              ) : (
                <>
                  <p>
                    A home for worlds made in Bryce, Blender and beyond, and the
                    artists who imagine them.
                  </p>
                  <Link href="/login">Sign in</Link>
                  <Link href="/register">Become a member →</Link>
                </>
              )}
            </div>
          </section>
          <section className="sidebar-panel">
            <h2>Gallery categories</h2>
            <nav aria-label="Categories">
              <Link
                className={!params.category ? "selected" : ""}
                href={categoryHref()}
              >
                All artwork{" "}
                <span>
                  {categories.reduce((n, c) => n + c.count, 0).toLocaleString()}
                </span>
              </Link>
              {categories.map((c) => (
                <Link
                  className={params.category === String(c.id) ? "selected" : ""}
                  href={categoryHref(c.id)}
                  key={c.id}
                >
                  {c.name}
                  <span>{c.count.toLocaleString()}</span>
                </Link>
              ))}
            </nav>
          </section>
          <section className="sidebar-panel">
            <h2>The Bryce5 archive</h2>
            <div className="sidebar-body">
              <p>
                Years of renders, experiments, and imagination from the Bryce
                community.
              </p>
              <a href="https://gallery.example.com/">Visit RenderGallery ↗</a>
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                Join our Discord community ↗
              </a>
            </div>
          </section>
        </aside>
        <section className="gallery-section" id="gallery">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {params.software === "bryce"
                  ? "THE BRYCE COMMUNITY"
                  : "THE RENDERING COMMUNITY"}
              </p>
              <h1>
                {categories.find((c) => String(c.id) === params.category)
                  ?.name || "Image gallery"}
              </h1>
              <p>Explore the archive. Share your next world.</p>
            </div>
            <Link className="button button-light" href="/upload">
              Upload artwork +
            </Link>
          </div>
          <Gallery
            categories={categories}
            currentPage={page}
            hasFilters={hasFilters}
            items={items}
            pageCount={pageCount}
            pageSize={pageSize}
            query={params.q ?? ""}
            selectedCategory={params.category ?? ""}
            sort={params.sort ?? "recent"}
            total={total}
            software={params.software || ""}
          />
        </section>
      </div>
      {!user && <Advertisement config={getAdsConfig()} />}
    </main>
  );
}
