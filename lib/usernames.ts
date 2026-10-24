// Shared by the registration form and server validation. Escape the hyphen for
// HTML's Unicode-set pattern syntax as well as JavaScript regular expressions.
export const USERNAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9_\\-]{2,31}";
export const USERNAME_HELP =
  "Use 3–32 letters, numbers, underscores or hyphens, starting with a letter or number.";
export function validNewUsername(value: string) {
  return new RegExp(`^(?:${USERNAME_PATTERN})$`).test(value);
}

// Legacy accounts keep their original login names. Flags are advisory so a
// damaged historical name cannot silently lose account or artwork ownership.
export function usernameReviewReason(value: string): string | null {
  if (/[?\ufffd]/u.test(value))
    return "Contains question marks or replacement characters; may be damaged legacy text.";
  if (/[\p{Cc}\p{Cf}]/u.test(value))
    return "Contains control or invisible formatting characters.";
  if (/https?:\/\/|www\./iu.test(value))
    return "Contains a web address; check for a spam account.";
  if (!/[\p{L}\p{N}]/u.test(value)) return "Contains no letters or numbers.";
  return null;
}
