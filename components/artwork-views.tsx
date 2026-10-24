"use client";
import { useEffect, useState } from "react";

const pending = new Map<number, Promise<number | null>>();
function countVisit(id: number) {
  let request = pending.get(id);
  if (!request) {
    request = fetch(`/api/artworks/${id}/view`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json();
        return Number.isSafeInteger(data.views) && data.views >= 0
          ? (data.views as number)
          : null;
      })
      .catch(() => null)
      .finally(() => pending.delete(id));
    pending.set(id, request);
  }
  return request;
}
export function ArtworkViews({
  id,
  initialCount,
}: {
  id: number;
  initialCount: number;
}) {
  const [views, setViews] = useState(initialCount);
  const [recorded, setRecorded] = useState(false);
  useEffect(() => {
    let active = true,
      started = false;
    setViews(initialCount);
    setRecorded(false);
    const record = () => {
      if (started || document.visibilityState !== "visible") return;
      started = true;
      void countVisit(id).then((count) => {
        if (active) {
          if (count !== null) setViews(count);
          setRecorded(true);
        }
      });
    };
    record();
    document.addEventListener("visibilitychange", record);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", record);
    };
  }, [id, initialCount]);
  return (
    <span className="artwork-view-count" aria-live="polite" aria-busy={!recorded}>
        {recorded ? (
          <span className="view-count-value">
            <strong data-testid="unique-views">{views.toLocaleString()}</strong>{" "}
            unique {views === 1 ? "view" : "views"}
          </span>
        ) : (
          <>
            <span className="views-skeleton" data-testid="views-skeleton" aria-hidden="true">
              <span className="views-skeleton-number" />
              <span className="views-skeleton-label" />
            </span>
            <span className="sr-only">Loading unique views</span>
          </>
        )}
    </span>
  );
}
