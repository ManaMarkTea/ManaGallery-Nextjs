import Link from "next/link";
export function AdminHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="admin-page-heading">
      <div>
        <div className="admin-eyebrow">{eyebrow || "GALLERY MANAGEMENT"}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function AdminPagination({
  page,
  pages,
  base,
  params,
}: {
  page: number;
  pages: number;
  base: string;
  params: Record<string, string>;
}) {
  const href = (p: number) => {
    const query = new URLSearchParams({ ...params, page: String(p) });
    return `${base}?${query}`;
  };
  return (
    <nav className="admin-pagination" aria-label="Admin pages">
      {page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : <span />}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
export function queryValues(
  params: Record<string, string | string[] | undefined>,
) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "string" ? value : "",
    ]),
  );
}
