import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120000,
  workers: 1,
  use: {
    channel: process.env.CI ? undefined : "chrome",
    baseURL: process.env.ARCHIVE_CHECK
      ? "http://127.0.0.1:4173"
      : "http://127.0.0.1:5173",
    viewport: { width: 1366, height: 900 },
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
    screenshot: "only-on-failure",
  },
  webServer: process.env.ARCHIVE_CHECK
    ? {
        command: "npm run preview -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/soccer-app/",
        reuseExistingServer: !process.env.CI,
      }
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
      },
});
