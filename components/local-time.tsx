"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

export function LocalTime({ value }: { value: string | null }) {
  // Keep server HTML and the initial hydration identical; only the browser knows
  // the visitor's actual timezone. UTC remains available before JS loads.
  const zone = useSyncExternalStore(subscribe, browserZone, serverZone);
  if (!value || !Number.isFinite(Date.parse(value))) return <>Not recorded</>;
  const utc = `${value.slice(0, 19).replace("T", " ")} UTC`;
  return (
    <span className="admin-local-time">
      {zone && (
        <time dateTime={value} title={zone}>
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "long",
            timeZone: zone,
          }).format(new Date(value))}{" "}
          <span>(local)</span>
        </time>
      )}
      <time dateTime={value} className={zone ? "admin-time-utc" : undefined}>
        {utc}
      </time>
    </span>
  );
}
