import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { openTestDatabase } from "./fixtures/database";
import path from "node:path";
import { createHash } from "node:crypto";

test("archived models download unchanged, require membership and respect moderation", async ({
  page,
}, testInfo) => {
  const storage = testInfo.config.metadata.dataDirectory as string;
  const site = path.resolve("test-results/model-fixture");
  mkdirSync(path.join(site, "data/media/19"), { recursive: true });
  const bytes = Buffer.from(
    "Fictional 3ds binary transport fixture\0\x01",
    "binary",
  );
  writeFileSync(path.join(site, "data/media/19/sample.3ds"), bytes);
  const sql = path.resolve("test-results/model-fixture.sql");
  writeFileSync(
    sql,
    "INSERT INTO legacy_images (image_id,cat_id,image_active,image_media_file) VALUES (58,19,1,'sample.3ds'),(59,19,1,'preview.jpg');",
  );
  const imported = spawnSync(
    "python",
    [
      "scripts/import-materials.py",
      sql,
      "--models",
      "--site",
      site,
      "--storage",
      storage,
    ],
    { encoding: "utf8" },
  );
  expect(imported.status, imported.stderr).toBe(0);
  expect(imported.stdout).toContain("'restored_models': 1");
  expect(readFileSync(path.join(storage, "models/58.3ds"))).toEqual(bytes);
  const json = Buffer.from(
    JSON.stringify({ asset: { version: "2.0" } }).padEnd(32, " "),
  );
  const glb = Buffer.alloc(20 + json.length);
  glb.write("glTF");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const originalHash = createHash("sha256").update(bytes).digest("hex");
  const previewEntry = {
    bytes: glb.length,
    sha256: createHash("sha256").update(glb).digest("hex"),
    sourceSha256: originalHash,
  };
  const previewCatalogue = (sourceSha256 = originalHash) =>
    writeFileSync(
      path.join(storage, "models/previews.json"),
      JSON.stringify({
        version: 1,
        geometryOnly: true,
        entries: { "58": { ...previewEntry, sourceSha256 } },
      }),
    );
  previewCatalogue();
  writeFileSync(path.join(storage, "models/58.glb"), glb);
  await page.goto("/art/58");
  await expect(
    page.getByRole("link", { name: "Sign in to download model" }),
  ).toBeVisible();
  expect(
    (await page.request.get("/download/58", { maxRedirects: 0 })).status(),
  ).toBe(303);
  expect(
    (
      await page.request.get("/download/58?format=glb", { maxRedirects: 0 })
    ).status(),
  ).toBe(303);
  await page.goto("/art/59");
  await expect(
    page.getByText("Preview only — no model file is available for this entry."),
  ).toBeVisible();
  await page.goto("/register");
  await page.getByLabel("Username", { exact: true }).fill("model_tester");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional model test password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/account");
  await page.goto("/art/58");
  await expect(
    page.getByRole("link", { name: "Download GLB geometry", exact: false }),
  ).toBeVisible();
  const modern = await page.request.get("/download/58?format=glb");
  expect(modern.status()).toBe(200);
  expect(modern.headers()["content-type"]).toBe("model/gltf-binary");
  expect(modern.headers()["cache-control"]).toBe("private, no-store");
  expect(await modern.body()).toEqual(glb);
  previewCatalogue("0".repeat(64));
  expect((await page.request.get("/download/58?format=glb")).status()).toBe(
    404,
  );
  previewCatalogue();
  writeFileSync(path.join(storage, "models/58.glb"), Buffer.alloc(glb.length));
  expect((await page.request.get("/download/58?format=glb")).status()).toBe(
    503,
  );
  writeFileSync(path.join(storage, "models/58.glb"), glb);
  const event = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download model (.3ds)", exact: false })
    .click();
  const download = await event;
  expect(download.suggestedFilename()).toBe("sample.3ds");
  expect(readFileSync((await download.path())!)).toEqual(bytes);
  const database = openTestDatabase(path.join(storage, "gallery.sqlite"));
  try {
    database
      .prepare(
        "INSERT INTO artwork_metadata(artwork_id,title,description,category_id,hidden,moderated,updated,updated_by) SELECT 58,'Sample model','Test',19,1,1,datetime('now'),id FROM users WHERE username='model_tester' ON CONFLICT(artwork_id) DO UPDATE SET hidden=1,moderated=1",
      )
      .run();
    expect((await page.request.get("/download/58")).status()).toBe(404);
    expect((await page.request.get("/download/58?format=glb")).status()).toBe(
      404,
    );
  } finally {
    database.prepare("DELETE FROM artwork_metadata WHERE artwork_id=58").run();
    // Other specs share this isolated server/IP; don't consume their signup budget.
    database.prepare("DELETE FROM attempts WHERE key LIKE 'register:%'").run();
    database.close();
  }
  writeFileSync(
    path.join(storage, "models/58.3ds"),
    Buffer.alloc(bytes.length),
  );
  expect((await page.request.get("/download/58")).status()).toBe(503);
  expect((await page.request.get("/download/59")).status()).toBe(404);
});
