import Link from "next/link";

export default function NotFound() {
  return (
    <main className="form-page panel">
      <h1>This page isn’t available</h1>
      <p>The link may be outdated, or this artwork may no longer be public.</p>
      <Link className="button button-light" href="/">
        Explore the gallery
      </Link>
    </main>
  );
}
