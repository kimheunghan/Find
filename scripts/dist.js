"use strict";

// 설치 파일 빌드: 매번 새 폴더(release/build-시각)에 만든 뒤 release/Find_Setup.exe로 복사한다.
// 이전 빌드 폴더를 백신·검색 프로그램이 잡고 있으면 electron-builder가 덮어쓰지 못하고(EPERM) 실패해
// 예전 설치 파일이 그대로 남는 문제가 있었다. 실패하면 오류로 끝내고, 성공하면 결과 파일 시각을 보여 준다.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
// 이용약관·개인정보처리방침·오픈소스 고지를 product.json 값으로 다시 만든다 (비어 있는 판매 정보는 경고)
const { missing } = require("./build-docs");
// 실행 중인 FindInside가 C:\ 전체를 감시하면서 새로 만든 빌드 파일(LICENSE.electron.txt 등)을 읽는 순간
// 폴더 이름 바꾸기가 막혀(EPERM) 빌드가 실패한다. 빌드 전에 앱을 닫는다 (설치 후 다시 켜면 된다).
try {
  execFileSync("taskkill", ["/IM", "FindInside.exe", "/F"], { stdio: "ignore" });
  console.log("실행 중인 FindInside를 닫았습니다 (빌드 폴더 잠김 방지).");
} catch {
  // 실행 중이 아니면 그대로
}
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const output = path.join("release", `build-${stamp}`);
execFileSync(process.execPath, [require.resolve("electron-builder/cli.js"), "--win", "nsis", "--x64", "--publish", "never", `--config.directories.output=${output}`], { cwd: root, stdio: "inherit" });

// 받은 사람이 몇 번 버전인지 파일 이름만 보고 알도록 버전을 붙인다 (Find_Setup_v1.0.3.exe).
// 예전 이름(Find_Setup.exe)으로도 함께 두어, 그 이름을 부르는 옛 링크가 깨지지 않게 한다.
const { version } = require("../package.json");
const versioned = `Find_Setup_v${version}.exe`;
const built = path.join(root, output, versioned);
if (!fs.existsSync(built)) throw new Error(`설치 파일이 만들어지지 않았습니다: ${built}`);
fs.copyFileSync(built, path.join(root, "release", versioned));
fs.copyFileSync(built, path.join(root, "release", "Find_Setup.exe"));
if (missing.length) console.warn(`⚠ 판매용이 아닌 시험 빌드입니다. src/product.json에 비어 있는 값: ${missing.length}개`);
console.log(`설치 파일: ${path.join("release", versioned)} (예전 이름 Find_Setup.exe로도 복사) (${(fs.statSync(built).size / 1048576).toFixed(0)}MB, ${new Date().toLocaleString("ko-KR")})`);

// 이전 빌드 폴더는 지울 수 있으면 지운다 (잠겨 있으면 다음에)
for (const name of fs.readdirSync(path.join(root, "release"))) {
  if (!name.startsWith("build-") || name === `build-${stamp}`) continue;
  try {
    fs.rmSync(path.join(root, "release", name), { recursive: true, force: true });
  } catch {
    // 다른 프로그램이 잡고 있으면 그대로 둔다
  }
}
