import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const required = [
  "index.html",
  "v1/index.html",
  "v2/index.html",
  "ver.c.1/index.html",
  "ver.c.2/index.html",
  "ver.c.3/index.html",
  "ver.g.1/index.html",
];
for (const relative of required) {
  const file = path.join("dist", relative);
  assert.ok(fs.existsSync(file), `Missing version: ${relative}`);
  const html = fs.readFileSync(file, "utf8");
  const assets = [
    ...html.matchAll(/(?:src|href)="(\/soccer-app\/[^"\s]+\.(?:js|css))"/g),
  ].map((match) => match[1]);
  assert.ok(assets.length > 0, `No application assets: ${relative}`);
  for (const asset of assets)
    assert.ok(
      fs.existsSync(path.join("dist", asset.slice("/soccer-app/".length))),
      `Broken asset: ${asset}`,
    );
  console.log(`${relative}: ${assets.length} assets verified`);
}
for (const relative of [
  "ver.c.3/v1",
  "ver.c.3/v2",
  "ver.g.1/ver.c.1",
  "ver.g.1/ver.c.2",
  "ver.g.1/ver.c.3",
]) {
  const html = fs.readFileSync(
    path.join("dist", relative, "index.html"),
    "utf8",
  );
  const target = html.match(/content="0;url=\/soccer-app\/([^";]+)"/)?.[1];
  assert.ok(
    target && fs.existsSync(path.join("dist", target, "index.html")),
    `Broken archive redirect: ${relative}`,
  );
}
console.log("All playable versions and redirects verified.");
