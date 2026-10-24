import { test, expect, type Page, type Request } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("archive ownership and modern administration enforce permissions and persist changes", async ({
  page,
  browser,
}, testInfo) => {
  const dbFile = path.join(
    testInfo.config.metadata.dataDirectory,
    "gallery.sqlite",
  );
  const database = openTestDatabase(dbFile);
  const archive = JSON.parse(
    readFileSync(testInfo.config.metadata.archiveFile, "utf8"),
  ).items;
  const [owned, other] = archive;
  const password = "oldpass";
  const dump = path.join("test-results", "admin-fixture.sql");
  const hash = createHash("md5").update(password).digest("hex");
  writeFileSync(
    dump,
    `INSERT INTO legacy_users (user_id,user_name,user_password,user_level) VALUES (800001,'archive_owner','${hash}',2),(800002,'gallery_curator','${hash}',9),(800003,'awaiting_member','${hash}',1),(800004,'???','${hash}',1);\nINSERT INTO legacy_images (image_id,user_id,image_active) VALUES (${owned.id},800001,1),(${other.id},800002,1);`,
  );
  const result = spawnSync(
    "python",
    ["scripts/import-accounts.py", dump, "--database", dbFile],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  const login = async (p: Page, username: string, pwd = password) => {
    await p.goto("/login");
    await p.getByLabel("Username", { exact: true }).fill(username);
    await p.getByLabel("Password", { exact: true }).fill(pwd);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p).toHaveURL("/account");
  };
  const ownerContext = await browser.newContext({
      baseURL: "http://localhost:3100",
    }),
    memberContext = await browser.newContext({
      baseURL: "http://localhost:3100",
    }),
    guestContext = await browser.newContext({
      baseURL: "http://localhost:3100",
    });
  const owner = await ownerContext.newPage(),
    member = await memberContext.newPage(),
    guest = await guestContext.newPage();
  const actionRequest = (p: Page) =>
    p.waitForRequest(
      (r) => r.method() === "POST" && !!r.headers()["next-action"],
    );
  const replay = async (p: Page, request: Request) =>
    p.request.post(request.url(), {
      headers: {
        "next-action": request.headers()["next-action"],
        "content-type": request.headers()["content-type"],
        origin: "http://localhost:3100",
      },
      data: request.postDataBuffer()!,
    });
  try {
    await guest.goto("/admin");
    await expect(guest).toHaveURL(/login/);
    await login(owner, "archive_owner");
    await owner.goto(`/art/${owned.id}/edit`);
    await owner
      .getByLabel("Title", { exact: true })
      .fill("Owner revised archive render");
    await owner
      .getByLabel("Description", { exact: true })
      .fill("Updated by the verified original artist.");
    await owner
      .getByLabel("Tags", { exact: true })
      .fill("owner-test, landscape");
    const ownerMutation = actionRequest(owner);
    await owner
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const ownerRequest = await ownerMutation;
    await expect(owner).toHaveURL(`/art/${owned.id}`);
    await expect(
      owner.getByText("Updated by the verified original artist.", {
        exact: true,
      }),
    ).toBeVisible();
    await owner.getByLabel("Leave a comment").fill("A comment for moderation.");
    await owner.getByRole("button", { name: "Post comment" }).click();
    await expect(owner.locator(".comment")).toContainText(
      "A comment for moderation.",
    );
    await member.goto("/register");
    await member
      .getByLabel("Username", { exact: true })
      .fill("ordinary_member");
    await member
      .getByLabel("Password", { exact: true })
      .fill("ordinary member password");
    await member
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(member).toHaveURL("/account");
    await member.goto("/admin");
    await expect(
      member.getByText("This page isn’t available"),
    ).toBeVisible();
    await member.goto(`/art/${owned.id}/edit`);
    await expect(
      member.getByText("This page isn’t available"),
    ).toBeVisible();
    const before = database
      .prepare("SELECT updated_by FROM artwork_metadata WHERE artwork_id=?")
      .get(owned.id);
    await replay(member, ownerRequest);
    expect(
      database
        .prepare("SELECT updated_by FROM artwork_metadata WHERE artwork_id=?")
        .get(owned.id),
    ).toEqual(before);
    await login(page, "gallery_curator");
    await expect(
      page.getByRole("link", { name: "Admin", exact: true }),
    ).toBeVisible();
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Welcome back, gallery_curator." }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/admin-overview-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/admin-overview-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/users?review=flagged");
    await expect(page.locator(".admin-table")).toContainText("???");
    await expect(
      page.getByText("Needs name review", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".admin-table")).not.toContainText(
      "archive_owner",
    );
    await page.goto(`/art/${owned.id}/edit`);
    await page
      .getByLabel("Description", { exact: true })
      .fill("Reviewed by an administrator.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Reviewed by an administrator.", { exact: true }),
    ).toBeVisible();
    await page.goto("/admin/artworks?q=Owner%20revised%20archive%20render");
    await page
      .getByRole("checkbox", { name: "Select Owner revised archive render" })
      .check();
    await page.getByRole("button", { name: "Hide selected" }).click();
    await expect(page.getByRole("status")).toContainText("1 artwork hidden.");
    await guest.goto(`/art/${owned.id}`);
    await expect(
      guest.getByText("This page isn’t available"),
    ).toBeVisible();
    await owner.goto(`/art/${owned.id}`);
    await expect(
      owner.getByRole("heading", { name: "Owner revised archive render" }),
    ).toBeVisible();
    await replay(owner, ownerRequest);
    expect(
      database
        .prepare(
          "SELECT hidden,moderated FROM artwork_metadata WHERE artwork_id=?",
        )
        .get(owned.id),
    ).toMatchObject({ hidden: 1, moderated: 1 });
    await page
      .getByRole("checkbox", { name: "Select Owner revised archive render" })
      .check();
    await page.getByRole("button", { name: "Publish selected" }).click();
    await expect(page.getByRole("status")).toContainText(
      "1 artwork published.",
    );
    await guest.goto(`/art/${owned.id}`);
    await expect(
      guest.getByRole("heading", { name: "Owner revised archive render" }),
    ).toBeVisible();
    await page.goto("/admin/categories");
    const category = page.locator("#new-category");
    await category
      .getByLabel("Category name", { exact: true })
      .fill("New worlds");
    await category.getByLabel("Sort order").fill("-10");
    await category.getByRole("button", { name: "Create category" }).click();
    await expect(
      page.locator("summary").filter({ hasText: "New worlds" }),
    ).toBeVisible();
    const created = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: "New worlds" }),
    });
    await created.locator("summary").click();
    await created
      .getByLabel("Category name", { exact: true })
      .fill("New dimensions");
    await created
      .getByRole("button", { name: "Save category", exact: true })
      .click();
    await expect(
      page.locator("summary").filter({ hasText: "New dimensions" }),
    ).toBeVisible();
    await category
      .getByLabel("Category name", { exact: true })
      .fill("Empty test category");
    await category.getByRole("button", { name: "Create category" }).click();
    const empty = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: "Empty test category" }),
    });
    await empty.locator("summary").click();
    page.once("dialog", (d) => d.accept());
    await empty.getByRole("button", { name: "Delete empty category" }).click();
    await expect(
      page.locator("summary").filter({ hasText: "Empty test category" }),
    ).toHaveCount(0);
    await owner.goto(`/art/${owned.id}/edit`);
    await owner
      .getByLabel("Category", { exact: true })
      .selectOption({ label: "New dimensions" });
    await owner.getByRole("button", { name: "Save changes" }).click();
    await expect(owner.locator(".artwork-topline")).toContainText(
      "New dimensions",
    );
    await page.goto("/admin/comments");
    await expect(page.locator(".admin-comment")).toContainText(
      "A comment for moderation.",
    );
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Delete comment", exact: true })
      .click();
    await expect(page.locator(".admin-comment")).toHaveCount(0);
    await page.goto("/admin/users?q=archive_owner");
    await page.getByLabel("Status for archive_owner").selectOption("disabled");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Account access updated.",
    );
    await owner.goto("/account");
    await expect(owner).toHaveURL(/login/);
    await page.getByLabel("Status for archive_owner").selectOption("active");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Account access updated.",
    );
    await login(owner, "archive_owner");
    await page.goto("/admin/users?q=ordinary_member");
    await page.getByLabel("Role for ordinary_member").selectOption("admin");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Account access updated.",
    );
    await member.goto("/admin");
    await expect(
      member.getByRole("heading", { name: "Welcome back, ordinary_member." }),
    ).toBeVisible();
    await page.getByLabel("Role for ordinary_member").selectOption("member");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Account access updated.",
    );
    await member.goto("/admin");
    await expect(
      member.getByText("This page isn’t available"),
    ).toBeVisible();
    await page.goto("/admin/users?q=awaiting_member");
    await page.getByLabel("Status for awaiting_member").selectOption("active");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Account access updated.",
    );
    await login(guest, "awaiting_member");
    await page.goto("/admin/settings");
    await page.getByLabel("Site name", { exact: true }).fill("Bryce Community");
    await page
      .getByLabel("Site description", { exact: true })
      .fill("Worlds made by our community.");
    await page.getByLabel("Allow new registrations").uncheck();
    await page.getByLabel("Allow artwork uploads").uncheck();
    const settingsMutation = actionRequest(page);
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    const settingsRequest = await settingsMutation;
    await expect(page.getByRole("status")).toHaveText(
      "Gallery settings saved.",
    );
    const count = (
      database
        .prepare("SELECT count(*) AS n FROM audit_log WHERE action=?")
        .get("Gallery settings updated") as { n: number }
    ).n;
    await replay(member, settingsRequest);
    expect(
      (
        database
          .prepare("SELECT count(*) AS n FROM audit_log WHERE action=?")
          .get("Gallery settings updated") as { n: number }
      ).n,
    ).toBe(count);
    await owner.goto("/upload");
    await expect(
      owner.getByRole("heading", { name: "Uploads are paused" }),
    ).toBeVisible();
    await guestContext.clearCookies();
    await guest.goto("/register");
    await expect(
      guest.getByRole("heading", { name: "Registration is paused" }),
    ).toBeVisible();
    await page.getByLabel("Site name", { exact: true }).fill("RenderGallery");
    await page.getByLabel("Allow new registrations").check();
    await page.getByLabel("Allow artwork uploads").check();
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Gallery settings saved.",
    );
    await page.goto("/admin/activity");
    await expect(page.locator(".admin-table")).toContainText("Artwork updated");
    await expect(page.locator(".admin-table")).toContainText(
      "Account access updated",
    );
    await page.goto("/admin/users?q=gallery_curator");
    await expect(
      page.getByRole("button", { name: "Your account" }),
    ).toBeDisabled();
  } finally {
    database.close();
    await ownerContext.close();
    await memberContext.close();
    await guestContext.close();
  }
});
