"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="form-page panel" role="alert">
      <h1>Something interrupted the gallery</h1>
      <p>
        Please try again. If this keeps happening, let an administrator know.
      </p>
      <button className="button button-light" onClick={reset}>
        Try again
      </button>{" "}
      <Link href="/">Back to the gallery</Link>
    </main>
  );
}
