import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { preview } from "vite";

const project = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(project, ".desktop");
const origin = "http://127.0.0.1:4180";
const health = `${origin}/__free_kick_lab_desktop__`;
// --page=ver.c.4/ のように公開パス以下のページを指定できる（省略時は最新版）
const page = (process.argv.find((arg) => arg.startsWith("--page="))?.slice(7) ?? "")
  .replace(/^\/+/, "");
if (!/^[\w.\-/]*$/.test(page)) throw new Error(`Invalid page: ${page}`);
fs.mkdirSync(runtime, { recursive: true });

function reportError(error) {
  console.error(error);
  fs.writeFileSync(path.join(runtime, "launcher-error.log"), String(error.stack || error));
  process.exitCode = 1;
}

function runNode(relativeScript, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, relativeScript), ...args], {
      cwd: project, stdio: "inherit", windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${relativeScript} failed (${code}).`)));
  });
}

async function isRunning() {
  try {
    const response = await fetch(health, { signal: AbortSignal.timeout(1000) });
    return response.ok && await response.text() === "FREE KICK LAB desktop";
  } catch {
    return false;
  }
}

function findBrowser() {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.ProgramFiles || "C:/Program Files", "Microsoft/Edge/Application/msedge.exe"),
  ];
  const browser = candidates.find((candidate) => fs.existsSync(candidate));
  if (!browser) throw new Error("Install Google Chrome or Microsoft Edge to open the game window.");
  return browser;
}

async function main() {
  const serveOnly = process.argv.includes("--serve-only");
  const browser = serveOnly ? null : findBrowser();
  let server;
  if (!await isRunning()) {
    // Always build the current source before starting a new desktop session.
    // Run Node entry points directly so no shell quoting or global npm is needed.
    await runNode("node_modules/typescript/bin/tsc");
    await runNode("node_modules/vite/bin/vite.js", ["build"]);
    server = await preview({
      configFile: false,
      root: project,
      base: "/soccer-app/",
      plugins: [{
        name: "desktop-health",
        configurePreviewServer(previewServer) {
          previewServer.middlewares.use("/__free_kick_lab_desktop__", (_request, response) => {
            response.setHeader("Content-Type", "text/plain");
            response.end("FREE KICK LAB desktop");
          });
        },
      }],
      preview: { host: "127.0.0.1", port: 4180, strictPort: true, open: false },
    });
    console.log(`FREE KICK LAB ready: ${origin}/soccer-app/`);
  }
  if (serveOnly) return;

  // A separate persistent profile keeps extensions and normal browser tabs out
  // of this window; use the browser's normal GPU acceleration settings.
  const child = spawn(browser, [
    `--app=${origin}/soccer-app/${page}`,
    `--user-data-dir=${path.join(runtime, "profile")}`,
    "--window-size=1280,850",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
  ], { stdio: "ignore", windowsHide: false });
  child.once("error", (error) => {
    reportError(error);
    server?.httpServer.close();
  });
  // Only the process that started the server owns its lifetime. Opening an
  // already-running window must not shut down the original session's server.
  child.once("exit", () => server?.httpServer.close());
}

main().catch(reportError);
