import { test, expect, type Page } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

test("view skeleton reserves space, reveals the response and respects reduced motion", async ({ page }) => {
  let reveal!: () => void;
  const waiting = new Promise<void>(resolve => { reveal = resolve; });
  await page.route("**/api/artworks/52/view", async route => {
    await waiting;
    await route.fulfill({json:{views:123}});
  });
  await page.goto("/art/52");
  const placeholder = page.getByTestId("views-skeleton");
  await expect(placeholder).toBeVisible();
  await expect(page.getByText("Counting views…",{exact:true})).toHaveCount(0);
  const before = await page.locator(".artwork-view-count").boundingBox();
  await page.emulateMedia({reducedMotion:"reduce"});
  expect(await placeholder.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  reveal();
  await expect(page.getByTestId("unique-views")).toHaveText("123");
  await expect(placeholder).toHaveCount(0);
  const after = await page.locator(".artwork-view-count").boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBeCloseTo(before!.height,0);
  await page.unroute("**/api/artworks/52/view");
  await page.route("**/api/artworks/52/view",route => route.abort());
  await page.reload();
  await expect(page.getByTestId("unique-views")).toBeVisible();
  await expect(placeholder).toHaveCount(0);
});

test("unique views deduplicate accounts and browsers without IPs or legacy totals", async ({
  page,
  browser,
}, testInfo) => {
  const database = openTestDatabase(
    path.join(testInfo.config.metadata.dataDirectory, "gallery.sqlite"),
  );
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () =>
      browser.newContext({ baseURL: "http://localhost:3100" }),
    ),
  );
  const [guestContext, otherDevice, botContext] = contexts;
  const guest = await guestContext.newPage(),
    device = await otherDevice.newPage();
  const register = async (p: Page, name: string) => {
    await p.goto("/register");
    await p.getByLabel("Username", { exact: true }).fill(name);
    await p
      .getByLabel("Password", { exact: true })
      .fill("unique view test password");
    await p
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(p).toHaveURL("/account");
  };
  const login = async (p: Page, name: string) => {
    await p.goto("/login");
    await p.getByLabel("Username", { exact: true }).fill(name);
    await p
      .getByLabel("Password", { exact: true })
      .fill("unique view test password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p).toHaveURL("/account");
  };
  const count = (id: number) =>
    (
      database
        .prepare(
          "SELECT count(*) AS n FROM artwork_viewers WHERE artwork_id=? AND claimed_by IS NULL",
        )
        .get(id) as { n: number }
    ).n;
  try {
    await register(page, "view_owner");
    database
      .prepare(
        "INSERT INTO account_policy(account_key,auto_approve) SELECT 'local:'||id,1 FROM users WHERE username='view_owner'",
      )
      .run();
    await page.goto("/upload");
    await page
      .getByLabel("Title", { exact: true })
      .fill("Unique view transport test");
    await page
      .getByLabel("Category", { exact: true })
      .selectOption({ index: 1 });
    const bytes = await sharp({
      create: { width: 30, height: 30, channels: 3, background: "#426b91" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("Artwork image").setInputFiles({
      name: "view-test.png",
      mimeType: "image/png",
      buffer: bytes,
    });
    await page.getByRole("button", { name: "Publish artwork" }).click();
    await expect(page).toHaveURL(/\/art\/1\d{9}/);
    const id = Number(page.url().split("/").at(-1));
    const endpoint = `/api/artworks/${id}/view`;
    await expect(page.getByTestId("unique-views")).toHaveText("1");
    expect(count(id)).toBe(1);
    await page.reload();
    await expect(page.getByTestId("unique-views")).toHaveText("1");
    const repeats = await Promise.all(
      Array.from({ length: 10 }, () =>
        page.request.post(endpoint, {
          headers: { origin: "http://localhost:3100" },
        }),
      ),
    );
    expect(repeats.every((r) => r.status() === 200)).toBe(true);
    expect(count(id)).toBe(1);
    await device.request.get(`/art/${id}`);
    expect(count(id)).toBe(1); // Server rendering/prefetch cannot count a visit.
    expect(
      (
        await device.request.post(endpoint, {
          headers: { origin: "https://example.invalid" },
        })
      ).status(),
    ).toBe(403);
    expect(count(id)).toBe(1);
    await guest.goto(`/art/${id}`);
    await expect(guest.getByTestId("unique-views")).toHaveText("2");
    await guest.reload();
    await expect(guest.getByTestId("unique-views")).toHaveText("2");
    const cookie = (await guestContext.cookies()).find(
      (c) => c.name === "rendergallery_viewer",
    );
    expect(cookie?.httpOnly).toBe(true);
    await register(guest, "view_guest_member");
    await guest.goto(`/art/${id}`);
    await expect(guest.getByTestId("unique-views")).toHaveText("2");
    expect(count(id)).toBe(2); // Guest visit is linked, not counted twice at sign-in.
    await login(device, "view_owner");
    await device.goto(`/art/${id}`);
    await expect(device.getByTestId("unique-views")).toHaveText("2");
    expect(count(id)).toBe(2); // Same account on another device.
    await guest.getByRole("button", { name: "Sign out", exact: true }).click();
    await register(guest, "view_shared_browser");
    await guest.goto(`/art/${id}`);
    await expect(guest.getByTestId("unique-views")).toHaveText("3");
    expect(count(id)).toBe(3); // Different accounts sharing a browser still count separately.
    const bot = await botContext.request.post(endpoint, {
      headers: {
        origin: "http://localhost:3100",
        "user-agent": "ExampleBot/1.0",
      },
    });
    expect(bot.status()).toBe(200);
    expect(count(id)).toBe(3);
    const prefetch = await botContext.request.post(endpoint, {
      headers: { origin: "http://localhost:3100", purpose: "prefetch" },
    });
    expect(prefetch.status()).toBe(200);
    expect(count(id)).toBe(3);
    const archived = JSON.parse(
      readFileSync(testInfo.config.metadata.archiveFile, "utf8"),
    ).items.find((i: { views: number }) => i.views > 100000);
    await page.request.get(`/art/${archived.id}`);
    expect(count(archived.id)).toBe(0);
    await page.goto(`/art/${archived.id}`);
    await expect(page.getByTestId("unique-views")).toHaveText("1");
    await expect(page.locator(".artwork-stats")).toContainText(
      "unverified legacy hits",
    );
    await expect(page.locator(".artwork-stats")).toContainText(
      archived.views.toLocaleString(),
    );
    const cols = database
      .prepare("PRAGMA table_info(artwork_viewers)")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual([
      "artwork_id",
      "viewer_key",
      "claimed_by",
      "first_seen",
    ]);
    const identities = database
      .prepare("SELECT viewer_key FROM artwork_viewers WHERE artwork_id=?")
      .all(id) as { viewer_key: string }[];
    expect(
      identities.every((r) => /^[bu]:[a-f0-9]{64}$/.test(r.viewer_key)),
    ).toBe(true);
  } finally {
    database.close();
    await Promise.all(contexts.map((c) => c.close()));
  }
});
