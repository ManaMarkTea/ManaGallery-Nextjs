import { test, expect, type Page } from "@playwright/test";
import { openTestDatabase } from "./fixtures/database";
import path from "node:path";
import sharp from "sharp";

test("pending uploads stay private and administrators toggle future auto approval in review", async ({
  page,
  browser,
}, testInfo) => {
  const memberContext = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  const guestContext = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  const member = await memberContext.newPage();
  const guest = await guestContext.newPage();
  const database = openTestDatabase(
    path.join(testInfo.config.metadata.dataDirectory, "gallery.sqlite"),
  );
  const register = async (p: Page, username: string) => {
    await p.goto("/register");
    await p.getByLabel("Username", { exact: true }).fill(username);
    await p
      .getByLabel("Password", { exact: true })
      .fill("a review test password");
    await p
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(p).toHaveURL("/account");
  };
  const image = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#235687" },
  })
    .png()
    .toBuffer();
  const upload = async (title: string) => {
    await member.goto("/upload");
    await member.getByLabel("Title", { exact: true }).fill(title);
    await member
      .getByLabel("Category", { exact: true })
      .selectOption({ index: 1 });
    await member.getByLabel("Artwork image").setInputFiles({
      name: "review.png",
      mimeType: "image/png",
      buffer: image,
    });
    await member
      .getByRole("button", { name: /^(Submit for approval|Publish artwork)$/ })
      .click();
    await expect(member).toHaveURL(/\/art\/1\d{9}/);
    return member.url().split("/").at(-1)!;
  };
  try {
    await register(page, "review_admin");
    database
      .prepare(
        "INSERT INTO account_policy(account_key,role) SELECT 'local:'||id,'admin' FROM users WHERE username='review_admin'",
      )
      .run();
    await register(member, "review_member");
    const first = await upload("Review first submission");
    await expect(member.getByRole("status")).toContainText(
      "Awaiting admin approval",
    );
    const media = await member.locator(".artwork-image").getAttribute("src");
    expect((await guest.request.get(`/art/${first}`)).status()).toBe(404);
    expect((await guest.request.get(media!)).status()).toBe(404);
    await member.goto(`/art/${first}/edit`);
    await member.getByLabel("Gallery visibility").selectOption("public");
    await member
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await guest.request.get(`/art/${first}`)).status()).toBe(404);
    await page.goto("/admin/artworks?status=pending");
    await expect(
      page.getByRole("heading", { name: "Review uploads", exact: true }),
    ).toBeVisible();
    const toggle = page.getByRole("button", {
      name: "Auto upload for review_member",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const mutation = page.waitForRequest(
      (r) => r.method() === "POST" && !!r.headers()["next-action"],
    );
    await toggle.click();
    const toggleRequest = await mutation;
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect((await guest.request.get(`/art/${first}`)).status()).toBe(404);
    await page
      .getByRole("checkbox", {
        name: "Select Review first submission",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Publish selected", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "1 artwork published.",
    );
    expect((await guest.request.get(`/art/${first}`)).status()).toBe(200);
    expect((await guest.request.get(media!)).status()).toBe(200);
    const second = await upload("Review trusted submission");
    expect((await guest.request.get(`/art/${second}`)).status()).toBe(200);
    await page.goto(`/admin/artworks?q=${second}`);
    await page
      .getByRole("button", {
        name: "Auto upload for review_member",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Auto upload for review_member",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "false");
    await member.request.post(toggleRequest.url(), {
      headers: {
        "next-action": toggleRequest.headers()["next-action"],
        "content-type": toggleRequest.headers()["content-type"],
        origin: "http://localhost:3100",
      },
      data: toggleRequest.postDataBuffer()!,
    });
    expect(
      database
        .prepare(
          "SELECT auto_approve FROM account_policy p JOIN users u ON p.account_key='local:'||u.id WHERE u.username='review_member'",
        )
        .get(),
    ).toMatchObject({ auto_approve: 0 });
    const third = await upload("Review approval restored");
    expect((await guest.request.get(`/art/${third}`)).status()).toBe(404);
    await guest.goto("/");
    await expect(
      guest.getByLabel("Advertisement", { exact: true }),
    ).toContainText("Live ads are disabled locally");
    expect(
      await guest.locator('script[src*="googlesyndication"]').count(),
    ).toBe(0);
    const response = await guest.request.get("/ads.txt");
    expect(await response.text()).toContain(
      "google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0",
    );
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  } finally {
    database.close();
    await memberContext.close();
    await guestContext.close();
  }
});
