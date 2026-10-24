"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";

declare global {
  interface Window {
    adsbygoogle?: object[];
  }
}
export function Advertisement({
  config,
}: {
  config: { publisher: string; slot: string; origin: string } | null;
}) {
  const element = useRef<HTMLModElement>(null);
  const requested = useRef(false);
  const [live, setLive] = useState(false);
  useEffect(() => {
    setLive(!!config?.origin && window.location.origin === config.origin);
  }, [config?.origin]);
  const initialize = () => {
    if (
      requested.current ||
      !element.current ||
      element.current.hasAttribute("data-ad-status")
    )
      return;
    requested.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* Ad blockers or unavailable ads must not break the gallery. */
    }
  };
  if (!config) return null;
  return (
    <aside className="advertisement" aria-label="Advertisement">
      <small>Advertisement</small>
      {live ? (
        <>
          <Script
            id="google-adsense"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.publisher}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
            onReady={initialize}
          />
          <ins
            ref={element}
            className="adsbygoogle"
            style={{ display: "block" }}
            data-ad-client={config.publisher}
            data-ad-slot={config.slot}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </>
      ) : (
        <p>Ad space preview · Live ads are disabled locally</p>
      )}
    </aside>
  );
}
