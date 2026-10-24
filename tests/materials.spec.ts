import { test, expect, type Page } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("restored material files download unchanged, require membership, and respect moderation", async ({
  page,
  browser,
}, testInfo) => {
  const storage = testInfo.config.metadata.dataDirectory as string;
  const database = openTestDatabase(path.join(storage, "gallery.sqlite"));
  const entries = JSON.parse(
    readFileSync(testInfo.config.metadata.archiveFile, "utf8"),
  ).items.filter((i: { categoryId: number }) => i.categoryId === 12);
  const [material, preview] = entries;
  const site = path.resolve("test-results", "material-fixture");
  mkdirSync(path.join(site, "data/media/12"), { recursive: true });
  const bytes = Buffer.from(
    "Material transport fixture\0\x01\x02unchanged binary bytes",
    "binary",
  );
  writeFileSync(path.join(site, "data/media/12/fixture material.mat"), bytes);
  writeFileSync(
    path.join(site, "data/media/12/preview.jpg"),
    Buffer.from("preview placeholder"),
  );
  const sql = path.resolve("test-results", "material-fixture.sql");
  writeFileSync(
    sql,
    `INSERT INTO legacy_images (image_id,cat_id,image_active,image_media_file) VALUES (${material.id},12,1,'fixture material.mat'),(${preview.id},12,1,'preview.jpg');`,
  );
  const runImport = () => {
    const result = spawnSync(
      "python",
      [
        "scripts/import-materials.py",
        sql,
        "--site",
        site,
        "--storage",
        storage,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("'restored_materials': 1");
  };
  runImport();
  runImport();
  const target = path.join(storage, "materials", `${material.id}.mat`);
  expect(readFileSync(target)).toEqual(bytes);
  const register = async (p: Page, name: string) => {
    await p.goto("/register");
    await p.getByLabel("Username", { exact: true }).fill(name);
    await p
      .getByLabel("Password", { exact: true })
      .fill("material exchange test password");
    await p
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(p).toHaveURL("/account");
  };
  const guest = await browser.newContext({ baseURL: "http://localhost:3100" });
  try {
    await page.goto(`/art/${material.id}`);
    await expect(
      page.getByRole("link", {
        name: "Sign in to download material",
        exact: true,
      }),
    ).toBeVisible();
    const unauthenticated = await guest.request.get(
      `/download/${material.id}`,
      { maxRedirects: 0 },
    );
    expect(unauthenticated.status()).toBe(303);
    expect(unauthenticated.headers().location).toContain("/login?next=/art/");
    await register(page, "material_tester");
    await page.goto(`/art/${material.id}`);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download material (.mat)", exact: false })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("fixture material.mat");
    expect(readFileSync((await download.path())!)).toEqual(bytes);
    const response = await page.request.get(`/download/${material.id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/octet-stream");
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
    await page.goto(`/art/${preview.id}`);
    await expect(
      page.getByText(
        "Preview only — no material file is available for this entry.",
      ),
    ).toBeVisible();
    expect((await page.request.get(`/download/${preview.id}`)).status()).toBe(
      404,
    );
    unlinkSync(target);
    expect((await page.request.get(`/download/${material.id}`)).status()).toBe(
      404,
    );
    writeFileSync(target, bytes.subarray(0, 4));
    expect((await page.request.get(`/download/${material.id}`)).status()).toBe(
      503,
    );
    writeFileSync(target, bytes);
    const actor = database
      .prepare("SELECT id FROM users WHERE username=?")
      .get("material_tester") as { id: number };
    database
      .prepare(
        "INSERT INTO artwork_metadata(artwork_id,title,description,category_id,tags,hidden,moderated,updated,updated_by) VALUES (?,?,?,?,?,1,1,?,?)",
      )
      .run(
        material.id,
        material.title,
        material.description,
        material.categoryId,
        "",
        new Date().toISOString(),
        actor.id,
      );
    expect((await page.request.get(`/download/${material.id}`)).status()).toBe(
      404,
    );
    expect(
      (
        await guest.request.get(`/download/${material.id}`, { maxRedirects: 0 })
      ).status(),
    ).toBe(404);
    database
      .prepare(
        "INSERT INTO account_policy(account_key,role,disabled) VALUES (?,'admin',0)",
      )
      .run(`local:${actor.id}`);
    expect((await page.request.get(`/download/${material.id}`)).status()).toBe(
      200,
    );
    expect((await page.request.get("/download/not-a-number")).status()).toBe(
      404,
    );
  } finally {
    database
      .prepare("DELETE FROM artwork_metadata WHERE artwork_id=?")
      .run(material.id);
    database.close();
    await guest.close();
  }
});
