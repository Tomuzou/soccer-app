import { test, expect } from "@playwright/test";

test("lobby, precise goal, stage award and persistent record", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /一球に、\s*夢中になれ。/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "ver.c.3 ↗" })).toHaveAttribute(
    "href",
    "/ver.c.3/",
  );
  await page.screenshot({ path: "test-results/lobby-desktop.png" });
  await page
    .getByRole("button", { name: "ステージ1 ", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  await page.screenshot({ path: "test-results/game-desktop.png" });
  await page.getByRole("button", { name: "キック ↗", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "WELL PLAYED." }),
  ).toBeVisible();
  await expect(page.locator(".result-stars")).toHaveText("★★★");
  await page
    .getByRole("button", { name: "メニューに戻る", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".stage-card.complete")).toHaveCount(1);
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  await page.getByRole("button", { name: "キック ↗", exact: true }).click();
  await expect(page.locator(".shot-history .hit")).toHaveCount(1);
  await page.getByRole("button", { name: "音 ON", exact: true }).click();
  await page.getByRole("button", { name: "弾道 ON", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "音 OFF", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("ten-shot rush ends, prevents an eleventh kick, and saves best score", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "10球ラッシュ →" }).click();
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  for (let shot = 0; shot < 10; shot++) {
    await expect(
      page.getByRole("button", { name: "キック ↗", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "キック ↗", exact: true }).click();
    await expect(page.locator(".shot-history .hit")).toHaveCount(shot + 1);
  }
  await expect(
    page.getByRole("heading", { name: "10 / 10", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "キック ↗", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/rush-result.png" });
  await page.evaluate(() => {
    const game = (
      window as unknown as { game: { retryShot(): void; kickShot(): void } }
    ).game;
    game.retryShot();
    game.kickShot();
  });
  await expect(
    page.getByRole("heading", { name: "10 / 10", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "メニューに戻る", exact: true })
    .click();
  await page.reload();
  await expect(
    page.locator(".profile>div").nth(1).locator("strong"),
  ).toHaveText("10 / 10");
});

test("mobile lobby, wind mission, controls and help fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/lobby-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "δ WIND READER" }).click();
  await page
    .getByRole("button", { name: "ステージ1 ", exact: false })
    .first()
    .click();
  await expect(page.locator(".wind-chip")).toHaveText("→ 横風 5 m/s");
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  await page.screenshot({ path: "test-results/game-mobile.png" });
  const controls = await page.locator(".shot-controls").boundingBox();
  expect(controls!.x).toBeGreaterThanOrEqual(0);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "遊び方", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("drag cancellation does not kick, and retry counts a flight only once", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  const canvas = page.locator("canvas");
  await page.mouse.move(650, 500);
  await page.mouse.down();
  await page.mouse.move(650, 580);
  await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(page.locator(".phase-label")).toHaveText("READY TO KICK");
  await expect(page.locator(".shot-history .miss")).toHaveCount(0);
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  await page.getByRole("button", { name: "キック ↗", exact: true }).click();
  await page.keyboard.press("r");
  await expect(page.locator(".shot-history .miss")).toHaveCount(1);
  await page.keyboard.press("r");
  await expect(page.locator(".shot-history .miss")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lobby")).toBeVisible();
});
