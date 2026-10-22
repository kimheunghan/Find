"use strict";

// 만든 사람 PC 전용 설치: 정품 키 없이 체험 기간과 상관없이 쓰는 FindInside를 이 PC에만 깐다.
// - 소스(src/license.js)는 건드리지 않는다. 압축 안 한 빌드(--dir)를 만든 뒤, 그 복사본의 라이선스 확인만
//   "항상 정품"으로 바꾼다. 그래서 판매용 설치 파일·스토어 패키지에는 이 우회가 절대 들어가지 않는다.
// - 설치 위치는 %LOCALAPPDATA%\Programs\FindInside-개인용, 바탕화면에 "FindInside (개인용)" 바로 가기.
//   일반 설치본(Programs\FindInside)과 따로 있고, 설정·색인 폴더(%APPDATA%\FindInside)는 같이 쓴다.
// - 새 버전이 나오면 이 명령(npm run install:mine)을 다시 돌리면 덮어쓴다.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const target = path.join(process.env.LOCALAPPDATA, "Programs", "FindInside-개인용");

// 실행 중이면 파일을 덮어쓰지 못하므로 닫는다
try {
  execFileSync("taskkill", ["/IM", "FindInside.exe", "/F"], { stdio: "ignore" });
  console.log("실행 중인 FindInside를 닫았습니다.");
} catch {
  // 실행 중이 아니면 그대로
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const output = path.join("release", `mine-${stamp}`);
execFileSync(process.execPath, [require.resolve("electron-builder/cli.js"), "--win", "--dir", "--x64", "--publish", "never", `--config.directories.output=${output}`], { cwd: root, stdio: "inherit" });

const built = path.join(root, output, "win-unpacked");
const licenseFile = path.join(built, "resources", "app", "src", "license.js");
const before = "function status(state, now = Date.now(), config = product) {";
const text = fs.readFileSync(licenseFile, "utf8");
if (!text.includes(before)) throw new Error("license.js의 status 함수를 찾지 못했습니다. 이 스크립트를 고쳐야 합니다.");
fs.writeFileSync(licenseFile, text.replace(before, `${before}\n  return { kind: "licensed", allowed: true, customer: "개인용", keyHint: "", variant: "" };`));

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(built, target, { recursive: true });
fs.rmSync(path.join(root, output), { recursive: true, force: true });

// 바탕화면 바로 가기
const exe = path.join(target, "FindInside.exe");
const desktop = execFileSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" }).trim();
const shortcut = path.join(desktop, "FindInside (개인용).lnk");
const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut.replace(/'/g, "''")}');$s.TargetPath='${exe.replace(/'/g, "''")}';$s.WorkingDirectory='${target.replace(/'/g, "''")}';$s.Save()`;
// 경로의 한글이 깨지지 않게 명령을 UTF-16으로 감싸 넘긴다
execFileSync("powershell", ["-NoProfile", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { stdio: "inherit" });

const { version } = require("../package.json");
console.log(`개인용 FindInside ${version} 설치: ${target}`);
console.log(`바로 가기: ${shortcut}`);
