import { test, expect } from "@playwright/test";

test("published versions all load their 3D game and can return to latest", async ({
  page,
}) => {
  test.skip(
    !process.env.ARCHIVE_CHECK,
    "Requires a production build and preview server.",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const version of [
    "ver.c.1",
    "ver.c.2",
    "ver.c.3",
    "ver.g.1",
    "v1",
    "v2",
  ]) {
    const response = await page.goto(`/soccer-app/${version}/`);
    expect(response?.status(), `HTTP response for ${version}`).toBe(200);
    await expect(page.locator("#root canvas")).toBeVisible();
    if (version.startsWith("ver.g.")) {
      await expect(
        page.getByRole("heading", { name: /一球に、\s*夢中になれ。/ }),
      ).toBeVisible();
      await page.getByRole("link", { name: "ver.c.3 ↗" }).click();
      await expect(page).toHaveURL(/\/soccer-app\/ver.c.3\/$/);
    }
    await expect(
      page.getByRole("link", { name: /Codex最新版へ/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Codex最新版へ/ }).click();
    await expect(
      page.getByRole("heading", { name: /一球に、\s*夢中になれ。/ }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
