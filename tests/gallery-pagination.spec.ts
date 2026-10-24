import { test, expect } from "@playwright/test";

test("gallery page size, direct navigation and bounded jumps preserve filters", async ({
  page,
}) => {
  await page.goto("/?q=mountain&category=1&software=bryce&sort=rated");
  const matching = Number(
    (await page.locator(".result-line > span").first().innerText())
      .match(/[\d,]+/)![0]
      .replaceAll(",", ""),
  );
  await page.getByLabel("Images per page").selectOption("48");
  await expect(page.locator(".art-card")).toHaveCount(48);
  const nav = page.getByRole("navigation", { name: "Gallery pages" });
  await expect(nav.getByLabel("Forward 10 pages")).toHaveAttribute(
    "href",
    /page=2/,
  );
  await nav.getByLabel("Page", { exact: true }).fill("2");
  await nav.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.locator(".art-card")).toHaveCount(matching - 48);
  for (const [key, value] of Object.entries({
    q: "mountain",
    category: "1",
    software: "bryce",
    sort: "rated",
    perPage: "48",
    page: "2",
  })) {
    expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  }
  await page.reload();
  await expect(page.getByLabel("Images per page")).toHaveValue("48");
  await nav.getByRole("link", { name: "Back 5 pages", exact: true }).click();
  await expect(nav.getByLabel("Page", { exact: true })).toHaveValue("1");
  await expect(nav.getByText("First", { exact: true })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/gallery-pagination-mobile.png",
    fullPage: true,
  });
  await page.goto("/?perPage=999999&page=999999");
  await expect(page.getByLabel("Images per page")).toHaveValue("24");
  await expect(nav.getByLabel("Page", { exact: true })).toHaveValue("3");
  await page.goto("/?perPage=96");
  const total = Number(
    (await page.locator(".result-line > span").first().innerText())
      .match(/[\d,]+/)![0]
      .replaceAll(",", ""),
  );
  await expect(page.locator(".art-card")).toHaveCount(total);
  await expect(nav).toHaveCount(0);
});

test("filters apply automatically and search keeps focus while typing", async ({
  page,
}) => {
  await page.goto("/?page=2");
  await page.getByLabel("Category", { exact: true }).selectOption("12");
  await expect(page.locator(".art-card")).toHaveCount(2);
  await expect(page).not.toHaveURL(/page=2/);
  await page.getByLabel("Sort artworks").selectOption("popular");
  await expect(page).toHaveURL(/sort=popular/);
  await page.getByLabel("Software", { exact: true }).selectOption("blender");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.getByLabel("Software", { exact: true }).selectOption("");
  await expect(page.locator(".art-card")).toHaveCount(2);
  await page.getByLabel("Category", { exact: true }).selectOption("");
  const search = page.getByRole("searchbox", { name: "Search artworks" });
  await search.fill("mountain world 60");
  await expect(page.locator(".art-card")).toHaveCount(1);
  await expect(search).toBeFocused();
  await search.fill("");
  await expect(page.locator(".art-card")).toHaveCount(24);
  await search.fill("material");
  await search.press("Enter");
  await expect(page.locator(".art-card")).toHaveCount(2);
});
