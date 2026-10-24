import Link from "next/link";
import Image from "next/image";
import { GalleryFilterForm } from "./gallery-filter-form";
import type { GalleryCategory, GalleryItem } from "@/lib/gallery";
import { SOFTWARE, softwareName } from "@/lib/software";

import { GALLERY_PAGE_SIZES } from "@/lib/gallery-pagination";

type Props = {
  categories: GalleryCategory[];
  currentPage: number;
  hasFilters: boolean;
  items: GalleryItem[];
  pageCount: number;
  pageSize: number;
  query: string;
  selectedCategory: string;
  sort: string;
  total: number;
  software?: string;
};

function pageHref(
  page: number,
  query: string,
  category: string,
  sort: string,
  software = "",
  pageSize = 24,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (software) params.set("software", software);
  if (category) params.set("category", category);
  if (sort !== "recent") params.set("sort", sort);
  if (pageSize !== 24) params.set("perPage", String(pageSize));
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/?${search}#gallery` : "/#gallery";
}

export function Gallery({
  categories,
  currentPage,
  hasFilters,
  items,
  pageCount,
  pageSize,
  query,
  selectedCategory,
  sort,
  total,
  software = "",
}: Props) {
  return (
    <>
      <GalleryFilterForm>
        <label className="select-wrap">
          <span className="sr-only">Software</span>
          <select aria-label="Software" name="software" defaultValue={software}>
            <option value="">All software</option>
            {SOFTWARE.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search artworks"
            defaultValue={query}
            name="q"
            placeholder="Search the collection"
            type="search"
          />
        </label>
        <label className="select-wrap">
          <span className="sr-only">Category</span>
          <select
            aria-label="Category"
            defaultValue={selectedCategory}
            name="category"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name} ({category.count})
              </option>
            ))}
          </select>
        </label>
        <label className="select-wrap sort-select">
          <span className="sr-only">Sort artworks</span>
          <select aria-label="Sort artworks" defaultValue={sort} name="sort">
            <option value="recent">Recently added</option>
            <option value="popular">Most viewed</option>
            <option value="rated">Highest rated</option>
          </select>
        </label>
        <label className="select-wrap page-size-select">
          <span>Images per page</span>
          <select name="perPage" defaultValue={pageSize}>
            {GALLERY_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </GalleryFilterForm>

      <div className="result-line">
        <span>
          {total.toLocaleString()}{" "}
          {hasFilters ? "matching images" : "images in the gallery"}
        </span>
        <span>
          {String(currentPage).padStart(2, "0")} <i>/</i>{" "}
          {String(pageCount).padStart(2, "0")}
        </span>
      </div>

      {items.length ? (
        <div className="art-grid">
          {items.map((item, index) => (
            <Link
              className={`art-card card-${index % 6}`}
              href={`/art/${item.id}`}
              key={item.id}
            >
              <span className="software-card-label">
                {softwareName(item.software || "bryce")}
              </span>
              <div className="art-image-wrap">
                {item.image ? (
                  <Image
                    alt={item.title}
                    className="art-image"
                    fill
                    priority={index < 3}
                    sizes="(max-width: 700px) 50vw, (max-width: 980px) 33vw, 25vw"
                    src={item.image}
                    unoptimized
                  />
                ) : (
                  <div
                    aria-label="Artwork preview unavailable"
                    className="art-placeholder"
                    role="img"
                  >
                    <span>✳</span>
                  </div>
                )}
                <span className="art-open" aria-hidden="true">
                  ↗
                </span>
              </div>
              <div className="art-meta">
                <div>
                  <p className="art-category">
                    {item.category}
                    {item.materialDownload && (
                      <span className="material-badge">.MAT download</span>
                    )}
                  </p>
                  <h3>{item.title}</h3>
                </div>
                <span className="art-author">
                  {item.author || "Community artist"}
                </span>
              </div>
              <div className="card-stats">
                <span>{item.date?.slice(0, 10) || "Archive"}</span>
                <span>{item.views.toLocaleString()} unique views</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span aria-hidden="true">✳</span>
          <h3>No worlds found this time.</h3>
          <p>Try a different title or category to keep exploring.</p>
          <Link className="text-link" href="/#gallery">
            Clear your filters ↗
          </Link>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Gallery pages" className="pagination">
          <div className="page-links">
            {[
              { label: "First", target: 1, disabled: currentPage === 1 },
              {
                label: "−10",
                target: currentPage - 10,
                disabled: currentPage === 1,
                title: "Back 10 pages",
              },
              {
                label: "−5",
                target: currentPage - 5,
                disabled: currentPage === 1,
                title: "Back 5 pages",
              },
              {
                label: "← Previous",
                target: currentPage - 1,
                disabled: currentPage === 1,
              },
              {
                label: "Next →",
                target: currentPage + 1,
                disabled: currentPage === pageCount,
              },
              {
                label: "+5",
                target: currentPage + 5,
                disabled: currentPage === pageCount,
                title: "Forward 5 pages",
              },
              {
                label: "+10",
                target: currentPage + 10,
                disabled: currentPage === pageCount,
                title: "Forward 10 pages",
              },
              {
                label: "Last",
                target: pageCount,
                disabled: currentPage === pageCount,
              },
            ].map(({ label, target, disabled, title }) =>
              disabled ? (
                <span
                  key={label}
                  className="page-disabled"
                  aria-disabled="true"
                  aria-label={title}
                >
                  {label}
                </span>
              ) : (
                <Link
                  key={label}
                  aria-label={title}
                  href={pageHref(
                    Math.max(1, Math.min(pageCount, target)),
                    query,
                    selectedCategory,
                    sort,
                    software,
                    pageSize,
                  )}
                >
                  {label}
                </Link>
              ),
            )}
          </div>
          <form action="/#gallery" className="page-jump">
            <input type="hidden" name="q" value={query} />
            <input type="hidden" name="category" value={selectedCategory} />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="software" value={software} />
            <input type="hidden" name="perPage" value={pageSize} />
            <label htmlFor="gallery-page">Page</label>
            <input
              key={currentPage}
              id="gallery-page"
              name="page"
              type="number"
              min="1"
              max={pageCount}
              defaultValue={currentPage}
              required
            />
            <span>of {pageCount.toLocaleString()}</span>
            <button type="submit" className="filter-button">
              Go
            </button>
          </form>
        </nav>
      )}
    </>
  );
}
