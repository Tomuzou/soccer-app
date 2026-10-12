// soccer-app は TOMZO ARCADE（/tomzo-arcade/free-kick/）へ移転した。
// GitHub Pages には、旧URLを同じパスの移転先へ転送するだけのページを公開する。
//   /soccer-app/<path> → /tomzo-arcade/free-kick/<path>
// public/ にある各バージョンのページと、それ以外のパス用の 404.html を redirect/ に生成する。
import fs from "node:fs";
import path from "node:path";

const OLD = "/soccer-app/";
const NEW = "/tomzo-arcade/free-kick/";
const out = "redirect";

const page = (target) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FREE KICK LAB は TOMZO ARCADE へ移転しました</title>
<meta http-equiv="refresh" content="0;url=${target}">
<link rel="canonical" href="${target}">
<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>
</head>
<body style="font-family:system-ui,sans-serif;background:#0d0b1a;color:#f4f1ff;display:grid;place-items:center;min-height:100vh;margin:0">
<p>FREE KICK LAB は <a style="color:#ffd166" href="${target}">TOMZO ARCADE</a> へ移転しました。</p>
</body>
</html>
`;

// 一覧に無い旧パスは、404 ページの中でパスを読み替えて転送する
const notFound = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>TOMZO ARCADE へ移転しました</title>
<script>
  var p = location.pathname;
  var rest = p.indexOf(${JSON.stringify(OLD)}) === 0 ? p.slice(${OLD.length}) : "";
  location.replace(${JSON.stringify(NEW)} + rest + location.search + location.hash);
</script>
</head>
<body><a href="${NEW}">TOMZO ARCADE の FREE KICK LAB へ</a></body>
</html>
`;

const pages = [""];
const walk = (dir, rel) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "assets") continue;
    const sub = `${rel}${entry.name}/`;
    if (fs.existsSync(path.join(dir, entry.name, "index.html"))) pages.push(sub);
    walk(path.join(dir, entry.name), sub);
  }
};
walk("public", "");

fs.rmSync(out, { recursive: true, force: true });
for (const rel of pages) {
  fs.mkdirSync(path.join(out, rel), { recursive: true });
  fs.writeFileSync(path.join(out, rel, "index.html"), page(`${NEW}${rel}`));
}
fs.writeFileSync(path.join(out, "404.html"), notFound);
console.log(`Generated ${pages.length} redirect pages and 404.html in ${out}/`);
