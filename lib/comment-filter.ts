import rules from "./comment-rules.json";

export function commentReviewReason(body: string, trusted = false): string | null {
  const text = body.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").toLowerCase();
  if (rules.profanity.some(word => new RegExp(`\\b${word}\\b`, "iu").test(text))) return "Possible profanity";
  if (rules.spamPhrases.some(phrase => text.includes(phrase))) return "Possible advertising spam";
  const links = text.match(/https?:\/\/|www\.|\[url[=\]]/g) || [];
  if (links.length >= 3 || (!trusted && links.length)) return "Links need review";
  if (/(.)\1{29,}/u.test(text)) return "Repetitive text";
  return null;
}
