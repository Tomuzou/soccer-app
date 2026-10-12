import { test, expect, type Page } from "@playwright/test";
import type * as THREE from "three";

async function ballLayout(page: Page) {
  return page.evaluate(async () => {
    // Wait for ResizeObserver and the renderer after layout/item changes.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const game = (window as unknown as {
      game: {
        camera: THREE.PerspectiveCamera;
        ballMesh: THREE.Mesh;
        ballBody: { shapes: { radius: number }[] };
      };
    }).game;
    const canvas = document.querySelector("canvas")!;
    const pitch = canvas.getBoundingClientRect();
    const panel = document.querySelector(".shot-controls")!.getBoundingClientRect();
    const hud = document.querySelector(".hud")!.getBoundingClientRect();
    const radius = game.ballBody.shapes[0].radius;
    game.camera.updateMatrixWorld();
    const points = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map((z) => {
          const point = game.ballMesh.position.clone();
          point.x += x * radius;
          point.y += y * radius;
          point.z += z * radius;
          point.project(game.camera);
          return {
            x: pitch.left + (point.x + 1) * pitch.width / 2,
            y: pitch.top + (1 - point.y) * pitch.height / 2,
          };
        }),
      ),
    );
    const left = Math.min(...points.map((p) => p.x));
    const right = Math.max(...points.map((p) => p.x));
    const top = Math.min(...points.map((p) => p.y));
    const bottom = Math.max(...points.map((p) => p.y));
    const goal = [-3.66, 3.66].flatMap((x) => [0, 2.44].map((y) => {
      const point = game.ballMesh.position.clone().set(x, y, -18).project(game.camera);
      return { x: pitch.left + (point.x + 1) * pitch.width / 2,
        y: pitch.top + (1 - point.y) * pitch.height / 2 };
    }));
    const goalLeft = Math.min(...goal.map((p) => p.x));
    const goalRight = Math.max(...goal.map((p) => p.x));
    const goalTop = Math.min(...goal.map((p) => p.y));
    const goalBottom = Math.max(...goal.map((p) => p.y));
    return {
      fullPitch: pitch.left === 0 && pitch.top === 0 &&
        pitch.width === innerWidth && pitch.height === innerHeight,
      goalWidth: goalRight - goalLeft,
      goalVisible: goalLeft >= 0 && goalRight <= innerWidth && goalTop >= 64 && goalBottom <= innerHeight &&
        (goalRight <= hud.left || goalLeft >= hud.right || goalBottom <= hud.top || goalTop >= hud.bottom) &&
        (goalRight <= panel.left || goalLeft >= panel.right || goalBottom <= panel.top || goalTop >= panel.bottom),
      insidePitch: left >= pitch.left && right <= pitch.right &&
        top >= pitch.top && bottom <= pitch.bottom,
      clearOfPanel: right + 12 <= panel.left || bottom + 12 <= panel.top,
      exposed: right <= hud.left || left >= hud.right || bottom <= hud.top || top >= hud.bottom,
      panelFits: panel.left >= 0 && panel.top >= 0 &&
        panel.right <= innerWidth && panel.bottom <= innerHeight,
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      pitchBottom: pitch.bottom,
    };
  });
}

test("ball stays visible when controls change height and the screen rotates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "フリープレイ ↗" }).click();
  for (const viewport of [
    { width: 1366, height: 900 },
    { width: 1280, height: 720 },
    { width: 600, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    let goalWidth: number | undefined;
    for (const control of ["ドラッグ", "精密照準"]) {
      await page.getByRole("button", { name: control, exact: true }).click();
      for (const item of ["ノーマル", "豆つぶボール"]) {
        await page.getByRole("button", { name: item, exact: false }).click();
        await expect.poll(async () => {
          const layout = await ballLayout(page);
          return [layout.fullPitch, layout.goalVisible, layout.insidePitch, layout.clearOfPanel, layout.exposed, layout.panelFits];
        }, { message: `${viewport.width}x${viewport.height}: ${control}, ${item}` })
          .toEqual([true, true, true, true, true, true]);
      }
      const layout = await ballLayout(page);
      if (goalWidth !== undefined) expect(layout.goalWidth).toBeCloseTo(goalWidth, 2);
      goalWidth = layout.goalWidth;
      await page.screenshot({ path: `test-results/visibility-${viewport.width}-${control}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "ドラッグ", exact: true }).click();
  const ball = await ballLayout(page);
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  await page.mouse.move(ball.x, ball.pitchBottom - 16, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".phase-label")).toHaveText("BALL IN FLIGHT");
});

test("stage mission HUD also leaves the ball visible on small screens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "δ WIND READER" }).click();
  await page.getByRole("button", { name: "ステージ9 ", exact: false }).click();
  await page.getByRole("button", { name: "精密照準", exact: true }).click();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const layout = await ballLayout(page);
      return [layout.fullPitch, layout.goalVisible, layout.insidePitch, layout.clearOfPanel, layout.exposed, layout.panelFits];
    }).toEqual([true, true, true, true, true, true]);
    await page.screenshot({ path: `test-results/visibility-stage-${viewport.width}.png` });
  }
});
