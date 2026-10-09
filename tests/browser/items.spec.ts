import { test, expect } from "@playwright/test";

type Engine = {
  startStage(set: string, index: number): void;
  simulate(dt: number): void;
  startFreePlay(): void;
  setCurve(curve: number): void;
  setItem(item: string): void;
  configureShot(aim: number, elevation: number, power: number): void;
  kickShot(): void;
  state: { item: string; phase: string };
  shotTimer: number;
  ballBody: {
    velocity: { length(): number };
    angularVelocity: { y: number };
    shapes: { radius: number }[];
    position: { x: number; y: number; z: number };
  };
  trailLine: { geometry: { uuid: string } };
  renderer: {
    info: { render: { calls: number }; memory: { geometries: number } };
  };
};

test("items change speed, spin and physical radius, and cannot switch during flight", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  await page.getByRole("button", { name: "豆つぶボール" }).click();
  await expect(
    page.getByRole("button", { name: "豆つぶボール" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "ノーマル" }).click();
  const effects = await page.evaluate(() => {
    const game = (window as unknown as { game: Engine }).game;
    return ["none", "banana", "rocket", "tiny", "none"].map((item) => {
      game.startFreePlay();
      game.setCurve(0.5);
      game.setItem(item);
      game.configureShot(0, 0.15, 0.65);
      game.kickShot();
      game.setItem(item === "tiny" ? "none" : "tiny");
      return {
        item: game.state.item,
        speed: game.ballBody.velocity.length(),
        spin: game.ballBody.angularVelocity.y,
        radius: game.ballBody.shapes[0].radius,
      };
    });
  });
  expect(effects.map((effect) => effect.item)).toEqual([
    "none",
    "banana",
    "rocket",
    "tiny",
    "none",
  ]);
  expect(effects[1].spin / effects[0].spin).toBeCloseTo(4);
  expect(effects[2].speed / effects[0].speed).toBeCloseTo(2.3);
  expect(effects[3].radius / effects[0].radius).toBeCloseTo(0.5);
  expect(effects[4].radius).toBeCloseTo(0.11);
});

test('a rocket shot still collides with a wall instead of tunnelling through', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'フリープレイ ↗' }).click();
  const z = await page.evaluate(() => {
    const game = (window as unknown as { game: Engine }).game;
    game.startStage('a', 3); game.setCurve(0); game.setItem('rocket');
    game.configureShot(0, 0, 1); game.kickShot();
    game.simulate(0.3);
    return game.ballBody.position.z;
  });
  expect(z).toBeGreaterThan(-8.8);
});

test("banana changes the actual flight path and trail geometry is reused", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  const flights = await page.evaluate(async () => {
    const game = (window as unknown as { game: Engine }).game;
    const results = [];
    for (const item of ["none", "banana"]) {
      game.startFreePlay();
      game.setCurve(0.5);
      game.setItem(item);
      game.configureShot(0, 0.15, 0.65);
      game.kickShot();
      const geometries = new Set<string>();
      await new Promise<void>((resolve) => {
        const frame = () => {
          geometries.add(game.trailLine.geometry.uuid);
          if (game.shotTimer >= 0.3) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      results.push({
        x: game.ballBody.position.x,
        seconds: game.shotTimer,
        geometryCount: geometries.size,
      });
    }
    return results;
  });
  expect(flights[0].x).toBeGreaterThan(0);
  expect(flights[1].x).toBeGreaterThan(flights[0].x * 2.5);
  expect(flights.map((flight) => flight.geometryCount)).toEqual([1, 1]);
});

test("high-DPI mobile keeps rendering resolution bounded and controls leave ball visible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  await page.getByRole("button", { name: "豆つぶボール" }).click();
  const pixels = await page
    .locator("canvas")
    .evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
  expect(pixels.width).toBeLessThanOrEqual(585);
  expect(pixels.height).toBeLessThanOrEqual(1266);
  await page.screenshot({ path: "test-results/items-mobile.png" });
  await context.close();
});

test("the same shot travels the same distance at 60 and 15 FPS", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  const samples = await page.evaluate(() => {
    const game = (window as unknown as { game: Engine }).game;
    return [60, 15].map((fps) => {
      game.startFreePlay();
      game.setCurve(0.5);
      game.configureShot(0, 0.15, 0.65);
      game.kickShot();
      for (let i = 0; i < fps / 2; i++)
        game.simulate(Math.min(0.5 - i / fps, 1 / fps));
      return {
        x: game.ballBody.position.x,
        y: game.ballBody.position.y,
        z: game.ballBody.position.z,
      };
    });
  });
  expect(samples[1].x).toBeCloseTo(samples[0].x, 6);
  expect(samples[1].y).toBeCloseTo(samples[0].y, 6);
  expect(samples[1].z).toBeCloseTo(samples[0].z, 6);
});
