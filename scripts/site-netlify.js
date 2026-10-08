"use strict";

// Netlify용 판매 페이지 복사본 만들기: site/ → release/site-netlify/
// Netlify(findinside.netlify.app)와 Cloudflare Pages(findinside.pages.dev)는 서로 연결하지 않고 따로 둔다.
// 저장소 안 site/는 pages.dev 주소로 되어 있으므로, Netlify에 올릴 때는 주소를 netlify.app으로 바꾼 복사본을 쓴다.
// 저장소 루트의 netlify.toml이 이 스크립트를 돌린 뒤 release/site-netlify를 올린다 (푸시하면 저절로).
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const from = path.join(root, "site");
const to = path.join(root, "release", "site-netlify");
const OLD = "findinside.pages.dev";
const NEW = "findinside.netlify.app";
const textExt = new Set([".html", ".txt", ".xml", ".css", ".js", ".json"]);

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });

let changed = 0;
for (const name of fs.readdirSync(from)) {
  const src = path.join(from, name);
  const dst = path.join(to, name);
  if (!textExt.has(path.extname(name))) {
    fs.copyFileSync(src, dst);
    continue;
  }
  const text = fs.readFileSync(src, "utf8");
  const count = text.split(OLD).length - 1;
  fs.writeFileSync(dst, text.split(OLD).join(NEW));
  if (count) {
    changed++;
    console.log(`${name}: 주소 ${count}곳을 ${NEW}으로`);
  }
}
console.log(`Netlify용 복사본: ${path.relative(root, to)} (주소 바꾼 파일 ${changed}개) — netlify.toml이 이 폴더를 올린다`);
