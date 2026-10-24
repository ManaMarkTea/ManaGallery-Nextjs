import "server-only";
import { db } from "./db";

export function getAdsSettings() {
  const values = Object.fromEntries(
    (
      db()
        .prepare(
          "SELECT key,value FROM site_settings WHERE key IN ('adsenseEnabled','adsensePublisher','adsenseSlot')",
        )
        .all() as { key: string; value: string }[]
    ).map((row) => [row.key, row.value]),
  );
  return {
    enabled: (values.adsenseEnabled ?? process.env.ADSENSE_ENABLED) === "true",
    publisher:
      values.adsensePublisher ??
      process.env.ADSENSE_PUBLISHER_ID ??
      "ca-pub-0000000000000000",
    slot: values.adsenseSlot ?? process.env.ADSENSE_SLOT_ID ?? "0000000000",
  };
}

export function getAdsConfig() {
  const { enabled, publisher, slot } = getAdsSettings();
  if (!enabled || !/^ca-pub-\d{16}$/.test(publisher) || !/^\d{10}$/.test(slot))
    return null;
  let origin = "";
  try {
    const url = new URL(process.env.APP_ORIGIN || "http://localhost:3000");
    const host = url.hostname;
    if (
      process.env.NODE_ENV === "production" &&
      url.protocol === "https:" &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host) &&
      !/(^|\.)(localhost|local|test|internal|invalid|example)$/.test(host)
    )
      origin = url.origin;
  } catch {
    /* Invalid origin leaves live advertising disabled. */
  }
  return { publisher, slot, origin };
}
