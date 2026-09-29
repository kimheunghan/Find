"use strict";

// Microsoft Store용 패키지(MSIX/.appx) 빌드: release/store-<시각>/FindInside <버전>.appx
// 스토어가 심사 뒤 직접 서명하므로 코드 서명 인증서가 필요 없다.
// 앱 식별 값(Partner Center → 제품 관리 → 제품 ID)은 src/store.json에 넣는다. 비어 있으면 빌드하지 않는다.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const store = JSON.parse(fs.readFileSync(path.join(root, "src", "store.json"), "utf8"));
const missing = ["identityName", "publisher", "publisherDisplayName"].filter((key) => !store[key]);
if (missing.length) {
  console.error(`src/store.json에 Partner Center의 제품 ID 값을 넣으세요: ${missing.join(", ")}`);
  process.exit(1);
}

// 약관·방침을 최신 판매 정보로 다시 만든다
require("./build-docs");

// 실행 중인 FindInside가 빌드 폴더를 읽으면 이름 바꾸기가 막힌다 (scripts/dist.js 참고)
try {
  execFileSync("taskkill", ["/IM", "FindInside.exe", "/F"], { stdio: "ignore" });
} catch {
  // 실행 중이 아니면 그대로
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const output = path.join("release", `store-${stamp}`);
execFileSync(process.execPath, [
  require.resolve("electron-builder/cli.js"), "--win", "appx", "--x64", "--publish", "never",
  `--config.directories.output=${output}`,
  `--config.appx.identityName=${store.identityName}`,
  `--config.appx.publisher=${store.publisher}`,
  `--config.appx.publisherDisplayName=${store.publisherDisplayName}`
], { cwd: root, stdio: "inherit" });

const built = fs.readdirSync(path.join(root, output)).find((name) => name.endsWith(".appx"));
if (!built) throw new Error(`스토어 패키지가 만들어지지 않았습니다: ${output}`);
const target = path.join(root, "release", "FindInside_Store.appx");
fs.copyFileSync(path.join(root, output, built), target);
console.log(`스토어 패키지: ${path.relative(root, target)} (${(fs.statSync(target).size / 1048576).toFixed(0)}MB)`);
