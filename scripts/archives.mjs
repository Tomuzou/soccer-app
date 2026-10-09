import fs from "node:fs";
import path from "node:path";

const base = "/soccer-app/";
const banner = (name) =>
  `<a href="${base}" style="position:fixed;bottom:8px;left:8px;z-index:9999;padding:8px 12px;background:#10252de8;color:#c6f36b;font:12px system-ui;border:1px solid #c6f36b55;border-radius:8px;text-decoration:none">${name} / Claude Code · Codex最新版へ ↗</a>`;
const redirect = (title, href) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta http-equiv="refresh" content="0;url=${href}"><link rel="canonical" href="${href}"></head><body><a href="${href}">${title}で遊ぶ →</a></body></html>`;

// Keep the original bundle bytes and original /v1/ and /v2/ URLs intact.
for (const n of [1, 2]) {
  const original = `public/v${n}/index.html`;
  let html = fs.readFileSync(original, "utf8");
  html = html.replace(
    /<title>.*?<\/title>/,
    `<title>Free Kick 3D | ver.c.${n}</title>`,
  );
  html = html.replace(/\s*<a href="\/soccer-app\/"[^>]*>.*?<\/a>/s, "");
  html = html.replace("</body>", `${banner(`ver.c.${n}`)}\n</body>`);
  fs.writeFileSync(original, html);
  fs.mkdirSync(`public/ver.c.${n}`, { recursive: true });
  fs.writeFileSync(`public/ver.c.${n}/index.html`, html);
}

const c3 = "public/ver.c.3/index.html";
let html = fs.readFileSync(c3, "utf8");
html = html.replace(
  /<title>.*?<\/title>/,
  "<title>Free Kick 3D | ver.c.3</title>",
);
if (!html.includes("ver.c.3 / Claude Code"))
  html = html.replace("</body>", `${banner("ver.c.3")}\n</body>`);
fs.writeFileSync(c3, html);
for (const n of [1, 2]) {
  fs.mkdirSync(`public/ver.c.3/v${n}`, { recursive: true });
  fs.writeFileSync(
    `public/ver.c.3/v${n}/index.html`,
    redirect(`ver.c.${n}`, `${base}ver.c.${n}/`),
  );
}

// Optional snapshot: only copy current application assets, never nested archives.
if (process.argv.includes("--snapshot-g1")) {
  const html = fs.readFileSync("dist/index.html", "utf8");
  if (!html.includes("/soccer-app/ver.g.1/assets/"))
    throw new Error("Build with --base=/soccer-app/ver.g.1/ first");
  fs.mkdirSync("public/ver.g.1/assets", { recursive: true });
  fs.writeFileSync("public/ver.g.1/index.html", html);
  for (const name of fs.readdirSync("dist/assets"))
    fs.copyFileSync(
      path.join("dist/assets", name),
      path.join("public/ver.g.1/assets", name),
    );
  for (const n of [1, 2, 3]) {
    fs.mkdirSync(`public/ver.g.1/ver.c.${n}`, { recursive: true });
    fs.writeFileSync(
      `public/ver.g.1/ver.c.${n}/index.html`,
      redirect(`ver.c.${n}`, `${base}ver.c.${n}/`),
    );
  }
}
console.log("Version archives prepared.");
