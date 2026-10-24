import { test, expect } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";

test("admin AdSense controls persist, validate IDs, update ads.txt and reject member mutations", async ({
  page,
  browser,
}, testInfo) => {
  const database = openTestDatabase(
    path.join(testInfo.config.metadata.dataDirectory, "gallery.sqlite"),
  );
  const previous = database
    .prepare("SELECT key,value FROM site_settings WHERE key LIKE 'adsense%'")
    .all() as { key: string; value: string }[];
  const password = "an ads settings test password";
  const salt = randomBytes(16).toString("hex");
  const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const id = Number(
    database
      .prepare("INSERT INTO users(username,password) VALUES ('ads_curator',?)")
      .run(hash).lastInsertRowid,
  );
  database
    .prepare("INSERT INTO account_policy(account_key,role) VALUES (?,'admin')")
    .run(`local:${id}`);
  const guestContext = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  const guest = await guestContext.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("Username", { exact: true }).fill("ads_curator");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/account");
    await page.goto("/admin/settings");
    const form = page.getByRole("form", { name: "AdSense settings" });
    await form.getByLabel("Enable AdSense").check();
    await form
      .getByLabel("Publisher ID", { exact: true })
      .fill("ca-pub-1234567890123456");
    await form.getByLabel("Ad slot ID", { exact: true }).fill("9876543210");
    const capture = page.waitForRequest(
      (r) => r.method() === "POST" && !!r.headers()["next-action"],
    );
    await form
      .getByRole("button", { name: "Save AdSense settings", exact: true })
      .click();
    const mutation = await capture;
    await expect(form.getByRole("status")).toContainText(
      "Changes take effect immediately",
    );
    await page.reload();
    await expect(form.getByLabel("Publisher ID", { exact: true })).toHaveValue(
      "ca-pub-1234567890123456",
    );
    expect(await (await guest.request.get("/ads.txt")).text()).toContain(
      "pub-1234567890123456",
    );
    await guest.goto("/");
    await expect(
      guest.getByLabel("Advertisement", { exact: true }),
    ).toContainText("Live ads are disabled locally");
    expect(
      await guest.locator('script[src*="googlesyndication"]').count(),
    ).toBe(0);
    await form
      .getByLabel("Publisher ID", { exact: true })
      .evaluate((el) => el.removeAttribute("pattern"));
    await form
      .getByLabel("Publisher ID", { exact: true })
      .fill("bad-publisher");
    await form
      .getByRole("button", { name: "Save AdSense settings", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("Use a publisher ID");
    expect(await (await guest.request.get("/ads.txt")).text()).toContain(
      "pub-1234567890123456",
    );
    await form
      .getByLabel("Publisher ID", { exact: true })
      .fill("ca-pub-1234567890123456");
    await form.getByLabel("Enable AdSense").uncheck();
    await form
      .getByRole("button", { name: "Save AdSense settings", exact: true })
      .click();
    await expect(form.getByRole("status")).toContainText("saved");
    expect(await (await guest.request.get("/ads.txt")).text()).toContain(
      "Advertising is disabled",
    );
    await guest.reload();
    await expect(
      guest.getByLabel("Advertisement", { exact: true }),
    ).toHaveCount(0);
    database
      .prepare("UPDATE account_policy SET role='member' WHERE account_key=?")
      .run(`local:${id}`);
    await page.request.post(mutation.url(), {
      headers: {
        "next-action": mutation.headers()["next-action"],
        "content-type": mutation.headers()["content-type"],
        origin: "http://localhost:3100",
      },
      data: mutation.postDataBuffer()!,
    });
    expect(
      database
        .prepare("SELECT value FROM site_settings WHERE key='adsenseEnabled'")
        .get(),
    ).toMatchObject({ value: "false" });
  } finally {
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare("DELETE FROM site_settings WHERE key LIKE 'adsense%'")
      .run();
    for (const row of previous)
      database
        .prepare("INSERT INTO site_settings(key,value) VALUES (?,?)")
        .run(row.key, row.value);
    database.exec("COMMIT");
    database.close();
    await guestContext.close();
  }
});
