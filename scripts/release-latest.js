"use strict";

// 앱 자동 업데이트가 묻는 최신 판 정보 파일 site/latest.json을 만든다 (src/updater.js가 읽는다).
// 새 판의 GitHub 릴리스를 올린 **뒤에** 돌린다: npm run release:latest -- "바뀐 점 한두 줄"
// 릴리스보다 먼저 올라가면 손님 앱이 아직 없는 설치 파일을 받으러 가므로, 최신 릴리스 태그가 이 판이 아니면 멈춘다.
// 확인값(SHA-256)은 release\Find_Setup_v<버전>.exe에서 계산한다 — GitHub에 올린 바로 그 파일이어야 한다.
// 만든 뒤 site/latest.json을 커밋·푸시하면 1~2분 뒤 findinside.netlify.app/latest.json에 반영된다.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { version } = require("../package.json");

const root = path.join(__dirname, "..");
const GH = "C:\\Program Files\\GitHub CLI\\gh.exe";
const REPO = "kimheunghan/findinside-download";
const setup = path.join(root, "release", `Find_Setup_v${version}.exe`);
const notes = process.argv.slice(2).join(" ").trim();

if (!fs.existsSync(setup)) throw new Error(`${setup}가 없다. npm run dist를 먼저 할 것`);
const tag = execFileSync(GH, ["api", `repos/${REPO}/releases/latest`, "--jq", ".tag_name"], { encoding: "utf8" }).trim();
if (tag !== `v${version}`) throw new Error(`최신 릴리스가 ${tag}이다. v${version} 릴리스를 먼저 올릴 것`);

// 올린 파일과 내 파일이 같은지 크기로 한 번 더 본다
const assets = JSON.parse(execFileSync(GH, ["api", `repos/${REPO}/releases/latest`, "--jq", "[.assets[] | {name, size}]"], { encoding: "utf8" }));
const uploaded = assets.find((asset) => asset.name === path.basename(setup));
if (!uploaded) throw new Error(`릴리스 v${version}에 ${path.basename(setup)}가 없다`);
if (uploaded.size !== fs.statSync(setup).size) throw new Error("릴리스에 올린 설치 파일과 release 폴더의 파일 크기가 다르다");

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(setup)).digest("hex");
const info = {
  version,
  url: `https://findinside.pages.dev/download/Find_Setup_v${version}.exe`,
  sha256,
  notes
};
fs.writeFileSync(path.join(root, "site", "latest.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(`site/latest.json: ${version} · ${sha256}`);
console.log("커밋·푸시하면 손님 앱이 다음 날(또는 다음에 켤 때) 새 판을 알린다");
