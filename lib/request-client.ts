import "server-only";
import { isIP } from "node:net";
import { createHash } from "node:crypto";

export function requestClientKey(headers: Pick<Headers, "get">) {
  // Enable only behind a proxy that overwrites this header, never appends
  // an untrusted client-provided value.
  const ip =
    process.env.TRUST_PROXY_HEADERS === "true"
      ? headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
  return ip && isIP(ip)
    ? createHash("sha256").update(ip).digest("hex")
    : "local";
}
