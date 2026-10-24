"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const sections = [
  ["/admin", "Overview", "◈"],
  ["/admin/artworks", "Artwork", "▧"],
  ["/admin/artworks?status=pending", "Review uploads", "✓"],
  ["/admin/users", "Members", "♙"],
  ["/admin/categories", "Categories", "▦"],
  ["/admin/comments", "Comments", "☰"],
  ["/admin/settings", "Settings", "⚙"],
  ["/admin/health", "Site health", "♡"],
  ["/admin/activity", "Activity log", "↗"],
];
export function AdminShell({
  username,
  children,
}: {
  username: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-logo">
          <span>R</span>
          <div>
            RenderGallery<small>ADMIN WORKSPACE</small>
          </div>
        </Link>
        <div className="admin-nav-label">MANAGE YOUR COMMUNITY</div>
        <nav aria-label="Admin navigation">
          {sections.map(([href, name, icon]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : ""}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="admin-avatar">
            {username.slice(0, 1).toUpperCase()}
          </span>
          <div>
            {username}
            <small>Administrator</small>
          </div>
          <Link href="/" aria-label="Back to gallery">
            ↗
          </Link>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <span>
            Workspace <span>/</span>{" "}
            {sections.find((s) => s[0] === pathname)?.[1] || "Manage"}
          </span>
          <Link href="/">View gallery ↗</Link>
        </header>
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
