import { test, expect } from "@playwright/test";
import { validNewUsername, usernameReviewReason } from "../lib/usernames";

test("new username rules reject punctuation-only and damaged names without rejecting legacy identities", () => {
  for (const name of ["sample_admin", "artist_2", "a-b", "123", "A".repeat(32)])
    expect(validNewUsername(name)).toBe(true);
  for (const name of [
    "??",
    "???",
    "---",
    "___",
    "_artist",
    "artist?",
    "artist\ufffd",
    "a",
    "a".repeat(33),
    "name with spaces",
    "https://spam.example",
  ])
    expect(validNewUsername(name)).toBe(false);
  for (const name of [
    "??",
    "???",
    "artist\ufffd",
    "---",
    "www.spam.example",
    "https://spam.example",
    "a\u200bb",
  ])
    expect(usernameReviewReason(name)).not.toBeNull();
  for (const name of [
    "sample_admin",
    "Bryce Artist",
    "Immanuel Schäfer",
    "画家",
    "a",
  ])
    expect(usernameReviewReason(name)).toBeNull();
});

test("registration form enforces the same username rules in the browser", async ({
  page,
}) => {
  await page.goto("/register");
  const username = page.getByLabel("Username", { exact: true });
  for (const value of ["???", "___", "_artist", "artist?"]) {
    await username.fill(value);
    expect(
      await username.evaluate((input: HTMLInputElement) =>
        input.checkValidity(),
      ),
    ).toBe(false);
  }
  await username.fill("sample_admin");
  expect(
    await username.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(true);
});
