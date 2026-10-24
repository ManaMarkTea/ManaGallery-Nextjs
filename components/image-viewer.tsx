"use client";

import { useEffect, useRef, useState } from "react";

export function ImageViewer({ src, title }: { src: string; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        className="button button-dark"
        type="button"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        View full-size image ⛶
      </button>
      <dialog
        ref={dialog}
        className="image-viewer"
        aria-label={`${title} — full-size image`}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {open && <img src={src} alt={title} />}
        <button
          type="button"
          className="image-viewer-close"
          aria-label="Close full-size image"
          onClick={() => dialog.current?.close()}
        >
          Close · Esc <span aria-hidden="true">×</span>
        </button>
      </dialog>
    </>
  );
}
