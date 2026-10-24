import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { openTestDatabase } from "./fixtures/database";
import path from "node:path";

test("archive, accounts, passkeys, uploads, comments, favorites and ownership", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Image gallery", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".art-card")).toHaveCount(24);
  await page.screenshot({
    path: "test-results/gallery-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/gallery-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("searchbox", { name: "Search artworks" })
    .fill("mountain");
  await expect(page).toHaveURL(/q=mountain/);
  await expect(page.locator(".art-card").first()).toBeVisible();
  await page.goto("/upload");
  await expect(page).toHaveURL(/login/);
  await page.goto("/register");
  const username = `artist_${Date.now()}`;
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill("a test password with spaces");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/account");
  const fixtureDb = openTestDatabase(
    path.join(testInfo.config.metadata.dataDirectory, "gallery.sqlite"),
  );
  fixtureDb
    .prepare(
      "INSERT INTO account_policy(account_key,auto_approve) SELECT 'local:'||id,1 FROM users WHERE username=?",
    )
    .run(username);
  fixtureDb.close();
  await expect(
    page.getByRole("heading", { name: `Hello, ${username}` }),
  ).toBeVisible();
  const session = (await context.cookies()).find(
    (c) => c.name === "rendergallery_session",
  );
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Passkey added. You can now use it to sign in.",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL("/account");
  await page.goto("/upload");
  await page.getByLabel("Title", { exact: true }).fill("E2E mountain world");
  await page.getByLabel("Category", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("Description", { exact: true })
    .fill("A test render, published from the browser.");
  await page.getByLabel("Artwork image", { exact: true }).setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await page.getByRole("button", { name: "Publish artwork" }).click();
  await expect(page.locator(".form-error")).toContainText("could not be read");
  await expect(page.getByLabel("Category", { exact: true })).not.toHaveValue(
    "",
  );
  const image = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#658bab" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Artwork image", { exact: true }).setInputFiles({
    name: "landscape.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByRole("button", { name: "Publish artwork" }).click();
  await expect(page).toHaveURL(/\/art\/1\d{9}/);
  const artworkURL = page.url();
  await expect(
    page.getByRole("heading", { name: "E2E mountain world" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit your artwork" }).click();
  await page.getByLabel("Software", { exact: true }).selectOption("blender");
  await page
    .getByLabel("Title", { exact: true })
    .fill("E2E mountain world edited");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "E2E mountain world edited" }),
  ).toBeVisible();
  const imageURL = await page.locator(".artwork-image").getAttribute("src");
  await expect(
    page.getByRole("link", { name: "Made with Blender", exact: true }),
  ).toBeVisible();
  await page.goto("/?software=blender");
  await expect(page.locator(".art-card")).toHaveCount(1);
  await expect(page.locator(".art-card")).toContainText(
    "E2E mountain world edited",
  );
  await expect(
    page.getByRole("link", { name: "Discord", exact: true }),
  ).toHaveAttribute("href", "https://discord.gg/YOUR_COMMUNITY_INVITE");
  await page.goto("/?software=bryce");
  await expect(page.getByRole("link", { name: "Next →" })).toHaveAttribute(
    "href",
    /software=bryce/,
  );
  await page.goto(artworkURL);
  const response = await page.request.get(imageURL!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  await page.getByRole("button", { name: "Save to favorites" }).click();
  await expect(
    page.getByRole("button", { name: "Remove favorite" }),
  ).toBeVisible();
  await page.getByLabel("Leave a comment").fill("Wonderful test landscape.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator(".comment")).toContainText(
    "Wonderful test landscape.",
  );
  await page.reload();
  await expect(page.locator(".comment")).toContainText(
    "Wonderful test landscape.",
  );
  const visitor = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  const guest = await visitor.newPage();
  await guest.goto(artworkURL);
  await expect(
    guest.getByRole("button", { name: "Delete comment" }),
  ).toHaveCount(0);
  await expect(guest.getByText("Sign in to save this artwork")).toBeVisible();
  await guest.goto(`${artworkURL}/edit`);
  await expect(guest).toHaveURL(/login/);
  const foreign = await guest.request.post("/api/passkeys/login-options", {
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  const replay = await guest.request.post("/api/passkeys/login-verify", {
    headers: { Origin: "http://localhost:3100" },
    data: { id: "fake" },
  });
  expect(replay.status()).toBe(400);
  await visitor.close();
  await page
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect(page.locator(".comment")).toHaveCount(0);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your uploads (1)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Favorites (1)" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete artwork", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your uploads (0)" }),
  ).toBeVisible();
  await page.goto(artworkURL);
  await expect(page.getByText("This page isn’t available")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".form-error")).toHaveText(
    "Invalid username or password.",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill("a test password with spaces");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/account");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("a test password with spaces");
  await page
    .getByLabel("New password", { exact: true })
    .fill("changed test password for local gallery");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Password changed.");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".passkey-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});
