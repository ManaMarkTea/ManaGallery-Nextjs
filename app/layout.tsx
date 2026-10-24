import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getUser } from "@/lib/auth";
import { logout } from "./actions";
import { getSiteSettings } from "@/lib/settings";
import { DISCORD_URL } from "@/lib/community";

export async function generateMetadata(): Promise<Metadata> {
  const settings = getSiteSettings();
  return {
    metadataBase: new URL("https://gallery.example.com"),
    title: {
      default: settings.siteName,
      template: `%s — ${settings.siteName}`,
    },
    description: settings.description,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser();
  const settings = getSiteSettings();
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link aria-label="RenderGallery home" className="brand" href="/">
            <span aria-hidden="true" className="brand-mark">
              <span />
              <span />
              <span />
            </span>
            <span>
              {settings.siteName === "RenderGallery" ? (
                <>
                  render<span className="brand-light">gallery</span>
                </>
              ) : (
                settings.siteName
              )}
            </span>
          </Link>
          <nav aria-label="Main navigation" className="main-nav">
            <Link href="/">Gallery</Link>
            <Link href="/?sort=popular">Top images</Link>
            <Link href="/upload">Upload</Link>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
              Discord
            </a>
            {user?.role === "admin" && <Link href="/admin">Admin</Link>}
          </nav>
          <div className="header-account">
            {user ? (
              <>
                <Link href="/account">{user.username}</Link>
                <form action={logout}>
                  <button className="quiet-button">Sign out</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link className="header-cta" href="/register">
                  Register
                </Link>
              </>
            )}
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <span className="footer-note">
            RenderGallery · Rendering community & Bryce5 archive · Artwork
            belongs to its respective creators.{" "}
            <a href="https://gallery.example.com/" rel="noreferrer">
              Visit the original RenderGallery ↗
            </a>
            {" · "}
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
              Join our Discord community ↗
            </a>
          </span>
        </footer>
      </body>
    </html>
  );
}
