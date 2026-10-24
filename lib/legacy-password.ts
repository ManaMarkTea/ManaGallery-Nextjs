import { createHash, timingSafeEqual } from "node:crypto";

// Reproduce legacy gallery' MD5 and nine-character-salt MD5 formats only for migration.
export function verifyLegacyPassword(
  password: string,
  stored: string,
): boolean {
  const match = /^(?:([^:\r\n]{9}):)?([a-f0-9]{32})$/i.exec(stored);
  if (!match) return false;
  const plain = password.replace(
    /^[\x00\x09\x0a\x0b\x0d\x20]+|[\x00\x09\x0a\x0b\x0d\x20]+$/g,
    "",
  );
  const expected = Buffer.from(match[2], "hex");
  const value = (match[1] || "") + plain;
  // The old gallery used ISO-8859-1 pages; support UTF-8 submissions as well.
  const utf8 = createHash("md5").update(value, "utf8").digest();
  const latin1 = createHash("md5").update(value, "latin1").digest();
  const utf8Valid = timingSafeEqual(utf8, expected);
  const latin1Valid = timingSafeEqual(latin1, expected);
  return (
    utf8Valid ||
    (Array.from(value).every((c) => c.charCodeAt(0) <= 255) && latin1Valid)
  );
}
