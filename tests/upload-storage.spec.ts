import { test, expect, type Page } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import {
  readdirSync,
  statSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MiB } from "../lib/storage-policy";
test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

test("storage limits serialize concurrent uploads and health/settings stay admin-only", async ({
  page,
  browser,
}, testInfo) => {
  const storage = testInfo.config.metadata.dataDirectory as string;
  const database = openTestDatabase(path.join(storage, "gallery.sqlite"));
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  const member = await context.newPage();
  const saved = database
    .prepare(
      "SELECT key,value FROM site_settings WHERE key IN ('uploadStorageLimitMiB','memberStorageLimitMiB')",
    )
    .all() as { key: string; value: string }[];
  const set = (key: string, value: string) =>
    database
      .prepare(
        "INSERT INTO site_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  const blocker = path.join(storage, "uploads/quota-budget.webp");
  const memberFile = path.join(storage, "uploads/quota-member.webp");
  let fixtureId: number | undefined;
  const image = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#375a7b" },
  })
    .png()
    .toBuffer();
  const encoded = await sharp(image)
    .rotate()
    .resize({
      width: 5000,
      height: 5000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 92 })
    .toBuffer();
  const preview = await sharp(encoded)
    .resize({
      width: 480,
      height: 360,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  const register = async (target: Page, name: string) => {
    await target.goto("/register");
    await target.getByLabel("Username", { exact: true }).fill(name);
    await target
      .getByLabel("Password", { exact: true })
      .fill("fictional storage test password");
    await target
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(target).toHaveURL("/account");
  };
  const prepare = async (target: Page, title: string) => {
    await target.goto("/upload");
    await target.getByLabel("Title", { exact: true }).fill(title);
    await target
      .getByLabel("Category", { exact: true })
      .selectOption({ index: 1 });
    await target.getByLabel("Artwork image").setInputFiles({
      name: "quota.png",
      mimeType: "image/png",
      buffer: image,
    });
  };
  const submit = (target: Page) =>
    target
      .getByRole("button", { name: /^(Submit for approval|Publish artwork)$/ })
      .click();
  try {
    await page.goto("/admin/health");
    await expect(page).toHaveURL(/login/);
    await register(page, "storage_admin");
    database
      .prepare(
        "INSERT INTO account_policy(account_key,role) SELECT 'local:'||id,'admin' FROM users WHERE username='storage_admin'",
      )
      .run();
    await page.goto("/admin/health");
    await expect(
      page.getByRole("heading", { name: "Site health", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Backup & recovery checks" }),
    ).toBeVisible();
    await expect(page.getByText("Server disk", { exact: true })).toBeVisible();
    const cloudLog = page.locator(".admin-health-job").filter({
      has: page.getByRole("heading", { name: "Cloud backup", exact: true }),
    });
    await cloudLog.getByText("View log", { exact: true }).click();
    await expect(
      cloudLog.getByText("Fictional failure: Access Denied.", { exact: true }),
    ).toBeVisible();
    await expect(
      cloudLog.getByText("Fictional <script>window.logInjected=true</script>", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => "logInjected" in window)).toBe(false);
    const localTime = cloudLog
      .locator('time[datetime="2026-10-23T14:41:55Z"]')
      .first();
    await expect(localTime).toContainText("(local)");
    await expect(localTime).toContainText("7:41:55 AM PDT");
    await expect(cloudLog.locator(".admin-time-utc").first()).toContainText(
      "2026-10-23 14:41:55 UTC",
    );
    await page.screenshot({
      path: testInfo.outputPath("health-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("health-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/settings");
    await page.getByLabel("Gallery upload storage (MiB)").fill("1");
    await page.getByLabel("Storage per member (MiB)").fill("1");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Gallery settings saved",
    );
    expect(
      (
        database
          .prepare(
            "SELECT value FROM site_settings WHERE key='uploadStorageLimitMiB'",
          )
          .get() as { value: string }
      ).value,
    ).toBe("1");
    await register(member, "storage_member");
    expect((await member.request.get("/admin/health")).status()).toBe(404);
    const userId = (
      database
        .prepare("SELECT id FROM users WHERE username='storage_member'")
        .get() as { id: number }
    ).id;
    // Count pre-existing uploads: tests share a private database but cannot consume
    // quota headroom based on execution order.
    const directory = path.join(storage, "uploads");
    mkdirSync(path.join(directory, "previews"), { recursive: true });
    const used = readdirSync(directory).reduce((sum, name) => {
      const item = path.join(directory, name);
      return (
        sum +
        (statSync(item).isDirectory()
          ? readdirSync(item).reduce(
              (n, file) => n + statSync(path.join(item, file)).size,
              0,
            )
          : statSync(item).size)
      );
    }, 0);
    writeFileSync(
      blocker,
      Buffer.alloc(MiB - used - encoded.length - preview.length),
    );
    const second = await context.newPage();
    await prepare(member, "Concurrent quota submission one");
    await prepare(second, "Concurrent quota submission two");
    await Promise.all([submit(member), submit(second)]);
    await expect
      .poll(() =>
        database
          .prepare("SELECT count(*) AS n FROM uploads WHERE user_id=?")
          .get(userId),
      )
      .toEqual({ n: 1 });
    await expect
      .poll(async () => [
        ...(await member.locator(".form-error").allTextContents()),
        ...(await second.locator(".form-error").allTextContents()),
      ])
      .toEqual([
        "The gallery's upload storage limit has been reached. Please contact an administrator.",
      ]);
    const accepted = (await member.locator(".form-error").count())
      ? second
      : member;
    await expect(accepted).toHaveURL(/\/art\/1\d{9}/);
    unlinkSync(blocker);
    set("uploadStorageLimitMiB", "10");
    fixtureId = Number(
      database
        .prepare(
          "INSERT INTO uploads(user_id,title,description,category_id,filename,created,approved) VALUES (?,'Quota fixture','',1,'quota-member.webp',datetime('now'),0)",
        )
        .run(userId).lastInsertRowid,
    );
    writeFileSync(memberFile, Buffer.alloc(MiB));
    await prepare(member, "Member quota submission");
    await submit(member);
    await expect(member.locator(".form-error")).toContainText(
      "Your artwork storage limit",
    );
    expect(
      (
        database
          .prepare("SELECT count(*) AS n FROM uploads WHERE user_id=?")
          .get(userId) as { n: number }
      ).n,
    ).toBe(2);
  } finally {
    for (const file of [blocker, memberFile]) {
      try {
        unlinkSync(file);
      } catch {
        /* Already cleaned. */
      }
    }
    if (fixtureId)
      database.prepare("DELETE FROM uploads WHERE id=?").run(fixtureId);
    database
      .prepare(
        "DELETE FROM site_settings WHERE key IN ('uploadStorageLimitMiB','memberStorageLimitMiB')",
      )
      .run();
    for (const row of saved) set(row.key, row.value);
    database.prepare("DELETE FROM attempts WHERE key LIKE 'register:%'").run();
    database.close();
    await context.close();
  }
});
