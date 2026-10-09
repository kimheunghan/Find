"use strict";

// 공개 저장소 kimheunghan/findinside-download의 README에 적힌 설치 파일 버전을 package.json 버전으로 맞춘다.
// 새 버전 릴리스를 올린 뒤 한 번 돌린다: npm run release:readme
// 판매 페이지(site/)는 npm run docs가 버전을 채우므로 여기서는 README만 다룬다.
const { execFileSync } = require("node:child_process");
const { version } = require("../package.json");

const GH = "C:\\Program Files\\GitHub CLI\\gh.exe";
const REPO = "kimheunghan/findinside-download";
const gh = (args, input) => execFileSync(GH, args, { encoding: "utf8", input });

// 릴리스가 없으면 README 링크가 404가 되므로 먼저 확인한다
const tag = gh(["api", `repos/${REPO}/releases/latest`, "--jq", ".tag_name"]).trim();
if (tag !== `v${version}`) throw new Error(`최신 릴리스가 ${tag}이다. v${version} 릴리스를 먼저 올릴 것`);

const file = JSON.parse(gh(["api", `repos/${REPO}/contents/README.md`]));
const before = Buffer.from(file.content, "base64").toString("utf8");
const after = before
  .replace(/Find_Setup_v\d+\.\d+\.\d+\.exe/g, `Find_Setup_v${version}.exe`)
  .replace(/최신 \d+\.\d+\.\d+/g, `최신 ${version}`);
if (after === before) {
  console.log(`README는 이미 ${version}이다`);
  process.exit(0);
}
const body = JSON.stringify({ message: `README: 설치 파일 버전을 ${version}으로`, content: Buffer.from(after).toString("base64"), sha: file.sha });
gh(["api", "-X", "PUT", `repos/${REPO}/contents/README.md`, "--input", "-"], body);
console.log(`findinside-download README를 ${version}으로 고쳤다`);
