import { test, expect } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { commentReviewReason } from "../lib/comment-filter";

test("comment filtering avoids word fragments and flags advertising, profanity and untrusted links", () => {
  expect(
    commentReviewReason("A classic glass render from Scunthorpe."),
  ).toBeNull();
  expect(commentReviewReason("This is SHIT")).toBe("Possible profanity");
  expect(commentReviewReason("buy viagra now", true)).toBe(
    "Possible advertising spam",
  );
  expect(commentReviewReason("Reference https://example.com")).toBe(
    "Links need review",
  );
  expect(commentReviewReason("Reference https://example.com", true)).toBeNull();
});

test("archived comments and new held comments appear in admin review and preserve deletion on reimport", async ({
  page,
}, testInfo) => {
  const storage = testInfo.config.metadata.dataDirectory as string;
  const database = openTestDatabase(path.join(storage, "gallery.sqlite"));
  const source = path.resolve("test-results/comment-export.json");
  writeFileSync(
    source,
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: 90001,
          artworkId: 57,
          legacyUserId: 0,
          username: "Former guest",
          body: "Fictional archived comment",
          created: "2004-01-01 00:00:00",
          reviewReason: null,
        },
        {
          id: 90002,
          artworkId: 57,
          legacyUserId: 777,
          username: "Former owner",
          body: "Fictional owned archive comment",
          created: "2004-01-02 00:00:00",
          reviewReason: null,
        },
      ],
    }),
  );
  const runImport = () => {
    const result = spawnSync(
      "python",
      [
        "scripts/import-comments.py",
        source,
        "--database",
        path.join(storage, "gallery.sqlite"),
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  };
  runImport();
  runImport();
  await page.goto("/art/57");
  await expect(
    page.getByText("Fictional archived comment", { exact: true }),
  ).toBeVisible();
  await page.goto("/register");
  await page.getByLabel("Username", { exact: true }).fill("comment_reviewer");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional reviewer password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/account");
  try {
    const owner = database
      .prepare("SELECT id FROM users WHERE username='comment_reviewer'")
      .get() as { id: number };
    database
      .prepare(
        "INSERT INTO legacy_accounts(legacy_id,username,enabled,user_id) VALUES(777,'Former owner',1,?)",
      )
      .run(owner.id);
    await page.goto("/art/57");
    const guestComment = page
      .locator(".comment")
      .filter({ hasText: "Fictional archived comment" });
    await expect(
      guestComment.getByRole("button", { name: "Delete comment", exact: true }),
    ).toHaveCount(0);
    await page
      .locator(".comment")
      .filter({ hasText: "Fictional owned archive comment" })
      .getByRole("button", { name: "Delete comment", exact: true })
      .click();
    await expect(
      page.getByText("Fictional owned archive comment", { exact: true }),
    ).toHaveCount(0);
    runImport();
    await page.reload();
    await expect(
      page.getByText("Fictional owned archive comment", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Leave a comment")
      .fill("Reference https://example.com/comment-review");
    await page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "submitted for admin review",
    );
    await page.reload();
    await expect(
      page
        .locator(".comment")
        .filter({ hasText: "https://example.com/comment-review" }),
    ).toHaveCount(0);
    await page
      .getByLabel("Leave a comment")
      .fill("Reference https://example.com/comment-review");
    await page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(
      page.getByText("You already posted this comment.", { exact: true }),
    ).toBeVisible();
    const user = database
      .prepare("SELECT id FROM users WHERE username='comment_reviewer'")
      .get() as { id: number };
    database
      .prepare(
        "INSERT INTO account_policy(account_key,role) VALUES(?,'admin') ON CONFLICT(account_key) DO UPDATE SET role='admin'",
      )
      .run(`local:${user.id}`);
    await page.goto("/admin/comments?status=pending&q=comment-review");
    await expect(
      page.getByText("Held for review: Links need review", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve comment", exact: true })
      .click();
    await page.goto("/art/57");
    await expect(
      page
        .locator(".comment")
        .filter({ hasText: "https://example.com/comment-review" }),
    ).toHaveCount(1);
    await page.goto("/admin/comments?q=Fictional+archived+comment");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Delete comment", exact: true })
      .click();
    await expect(
      page.getByText("Fictional archived comment", { exact: true }),
    ).toHaveCount(0);
    runImport();
    await page.goto("/art/57");
    await expect(
      page.getByText("Fictional archived comment", { exact: true }),
    ).toHaveCount(0);
  } finally {
    try {
      database
        .prepare("DELETE FROM attempts WHERE key LIKE 'register:%'")
        .run();
    } finally {
      database.close();
    }
  }
});
