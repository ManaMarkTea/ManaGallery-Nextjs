import { test, expect } from "@playwright/test";
import { createHash, scryptSync } from "node:crypto";
import { openTestDatabase } from "./fixtures/database";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyLegacyPassword } from "../lib/legacy-password";

test("legacy password formats match PHP and reject invalid hashes", () => {
  const md5 = (s: string, encoding: BufferEncoding = "utf8") =>
    createHash("md5").update(s, encoding).digest("hex");
  expect(verifyLegacyPassword("old123", md5("old123"))).toBe(true);
  expect(
    verifyLegacyPassword(" old123 ", `123456789:${md5("123456789old123")}`),
  ).toBe(true);
  expect(verifyLegacyPassword("café", md5("café", "latin1"))).toBe(true);
  expect(verifyLegacyPassword("wrong", md5("old123"))).toBe(false);
  expect(verifyLegacyPassword("old123", "not-a-password-hash")).toBe(false);
  expect(verifyLegacyPassword("\u0161", md5("a"))).toBe(false);
});

test("private import, first-login upgrade, activation rules, collisions and ownership", async ({
  page,
}, testInfo) => {
  const suffix = Date.now();
  const collision = `overlap_${suffix}`;
  const originalName = `Bryce Artist ${suffix}`;
  const saltedName = `salted_${suffix}`,
    inactiveName = `inactive_${suffix}`;
  const oldPassword = "old123";
  const localPassword = "keep this local password";
  const dbFile = path.join(
    testInfo.config.metadata.dataDirectory,
    "gallery.sqlite",
  );
  const connection = openTestDatabase(dbFile);
  const archive = JSON.parse(
    readFileSync(testInfo.config.metadata.archiveFile, "utf8"),
  ).items;
  const md5 = (s: string) =>
    createHash("md5").update(s, "latin1").digest("hex");
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const dump = path.join("test-results", `legacy-fixture-${suffix}.sql`);
  const rows = [
    [900001, originalName, md5(oldPassword), 2],
    [900002, saltedName, `123456789:${md5("123456789café")}`, 9],
    [900003, inactiveName, md5(oldPassword), 1],
    [900004, collision, md5(oldPassword), 2],
  ];
  writeFileSync(
    dump,
    `INSERT INTO legacy_users (user_id,user_name,user_password,user_level) VALUES ${rows.map((r) => `(${r.map((v) => (typeof v === "string" ? quote(v) : v)).join(",")})`).join(",")};\nINSERT INTO legacy_images (image_id,user_id,image_active) VALUES (${archive[0].id},900001,1),(${archive[1].id},900004,1);`,
    "latin1",
  );
  const runImport = () => {
    const result = spawnSync(
      "python",
      ["scripts/import-accounts.py", dump, "--database", dbFile],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(md5(oldPassword));
  };
  const login = async (name: string, password: string) => {
    await page.goto("/login");
    await page.getByLabel("Username", { exact: true }).fill(name);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  const logout = async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  };
  try {
    await page.goto("/register");
    await page.getByLabel("Username", { exact: true }).fill(collision);
    await page.getByLabel("Password", { exact: true }).fill(localPassword);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL("/account");
    runImport();
    const before = connection
      .prepare("SELECT password FROM users WHERE username=?")
      .get(collision) as { password: string };
    await page.reload();
    await page.getByLabel("Bryce username").fill(collision);
    await page.getByLabel("Bryce password").fill("incorrect");
    await page
      .getByRole("button", { name: "Link Bryce account", exact: true })
      .click();
    await expect(page.locator(".form-error")).toContainText("Invalid Bryce");
    await page.getByLabel("Bryce username").fill(collision);
    await page.getByLabel("Bryce password").fill(oldPassword);
    await page
      .getByRole("button", { name: "Link Bryce account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your Bryce archive (1)" }),
    ).toBeVisible();
    expect(
      (
        connection
          .prepare("SELECT password FROM users WHERE username=?")
          .get(collision) as { password: string }
      ).password,
    ).toBe(before.password);
    await logout();
    await login(originalName, "wrong");
    await expect(page.locator(".form-error")).toHaveText(
      "Invalid username or password.",
    );
    expect(
      connection
        .prepare("SELECT user_id FROM legacy_accounts WHERE username=?")
        .get(originalName),
    ).toMatchObject({ user_id: null });
    await login(inactiveName, oldPassword);
    await expect(page.locator(".form-error")).toHaveText(
      "Invalid username or password.",
    );
    await login(originalName, oldPassword);
    await expect(page).toHaveURL("/account");
    await expect(
      page.getByRole("heading", { name: "Your Bryce archive (1)" }),
    ).toBeVisible();
    const migrated = connection
      .prepare(
        "SELECT u.password,l.password AS old_password FROM legacy_accounts l JOIN users u ON u.id=l.user_id WHERE l.username=?",
      )
      .get(originalName) as { password: string; old_password: null };
    expect(migrated.old_password).toBeNull();
    const [salt, hash] = migrated.password.split(":");
    expect(scryptSync(oldPassword, salt, 64).toString("hex")).toBe(hash);
    runImport();
    expect(
      (
        connection
          .prepare("SELECT password FROM users WHERE username=?")
          .get(originalName) as { password: string }
      ).password,
    ).toBe(migrated.password);
    expect(
      connection
        .prepare("SELECT password FROM legacy_accounts WHERE username=?")
        .get(originalName),
    ).toMatchObject({ password: null });
    await logout();
    await login(originalName, oldPassword);
    await expect(page).toHaveURL("/account");
    await logout();
    await login(saltedName, "café");
    await expect(page).toHaveURL("/account");
    await logout();
    await page.goto("/register");
    await page.getByLabel("Username", { exact: true }).fill(inactiveName);
    await page
      .getByLabel("Password", { exact: true })
      .fill("this cannot claim a reserved name");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page.locator(".form-error")).toContainText(
      "belongs to a Bryce account",
    );
  } finally {
    connection.close();
  }
});
