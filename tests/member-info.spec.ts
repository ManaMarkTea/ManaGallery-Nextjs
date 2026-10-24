import { test, expect } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("member activity shows real creation/login dates and keeps legacy visit history distinct", async ({
  page,
}, testInfo) => {
  const dbFile = path.join(
    testInfo.config.metadata.dataDirectory,
    "gallery.sqlite",
  );
  const database = openTestDatabase(dbFile);
  const salt = randomBytes(16).toString("hex"),
    password = "member dates test password";
  const id = Number(
    database
      .prepare(
        "INSERT INTO users(username,password) VALUES ('activity_admin',?)",
      )
      .run(`${salt}:${scryptSync(password, salt, 64).toString("hex")}`)
      .lastInsertRowid,
  );
  database
    .prepare("INSERT INTO account_policy(account_key,role) VALUES (?,'admin')")
    .run(`local:${id}`);
  const dump = path.join(
    testInfo.config.metadata.dataDirectory,
    "member-dates.sql",
  );
  writeFileSync(
    dump,
    "INSERT INTO legacy_users (user_id,user_name,user_password,user_level,user_joindate,user_lastvisit) VALUES (710001,'historical_member','5f4dcc3b5aa765d61d8327deb882cf99',2,946684800,978307200);",
  );
  const result = spawnSync(
    "python",
    ["scripts/import-accounts.py", dump, "--database", dbFile],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  try {
    await page.goto("/login");
    await page.getByLabel("Username", { exact: true }).fill("activity_admin");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/account");
    const before = database
      .prepare("SELECT * FROM account_activity WHERE user_id=?")
      .get(id) as {
      last_login: number;
      last_seen: number;
      login_count: number;
      login_method: string;
    };
    expect(before.login_count).toBe(1);
    expect(before.login_method).toBe("password");
    expect(before.last_login).toBeGreaterThan(Date.now() - 60_000);
    await page.goto("/admin/users?q=activity_admin");
    const row = page.getByRole("row").filter({ hasText: "activity_admin" });
    await row.locator("summary").click();
    await expect(row).toContainText("Local account created");
    await expect(row).toContainText("Successful logins");
    await expect(row).toContainText("1 since tracking began");
    await expect(row).toContainText("UTC");
    expect(
      (
        database
          .prepare("SELECT login_count FROM account_activity WHERE user_id=?")
          .get(id) as { login_count: number }
      ).login_count,
    ).toBe(1);
    await page.goto("/admin/users?q=historical_member");
    const historical = page
      .getByRole("row")
      .filter({ hasText: "historical_member" });
    await historical.locator("summary").click();
    await expect(historical).toContainText("Jan 1, 2000");
    await expect(historical).toContainText("Jan 1, 2001");
    await expect(historical).toContainText("0 since tracking began");
    await page.screenshot({
      path: "test-results/admin-member-details.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/login/);
    await page.getByLabel("Username", { exact: true }).fill("activity_admin");
    await page
      .getByLabel("Password", { exact: true })
      .fill("incorrect password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".form-error")).toContainText(
      "Invalid username or password",
    );
    expect(
      (
        database
          .prepare("SELECT login_count FROM account_activity WHERE user_id=?")
          .get(id) as { login_count: number }
      ).login_count,
    ).toBe(1);
  } finally {
    database.close();
  }
});
