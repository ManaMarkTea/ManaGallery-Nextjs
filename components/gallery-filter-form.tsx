"use client";

import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function GalleryFilterForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const [pending, startTransition] = useTransition();
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function apply(form: HTMLFormElement) {
    cancel();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      const text = String(value).trim();
      if (text) params.set(key, text);
    }
    startTransition(() =>
      router.replace(`/?${params}#gallery`, { scroll: false }),
    );
  }

  return (
    <form
      action="/#gallery"
      className="gallery-controls"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        apply(event.currentTarget);
      }}
      onCompositionStart={() => {
        composing.current = true;
        cancel();
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        const form = event.currentTarget;
        cancel();
        timer.current = setTimeout(() => apply(form), 350);
      }}
      onChange={(event) => {
        const form = event.currentTarget;
        cancel();
        if (composing.current) return;
        if (event.target instanceof HTMLSelectElement) apply(form);
        else timer.current = setTimeout(() => apply(form), 350);
      }}
    >
      {children}
      <noscript>
        <button className="filter-button" type="submit">
          Find art
        </button>
      </noscript>
      <span className="sr-only" role="status">
        {pending ? "Updating gallery…" : ""}
      </span>
    </form>
  );
}
