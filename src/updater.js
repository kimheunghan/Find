"use strict";

// 설치 파일판 자동 업데이트 (2026-11-27)
// - 앱을 켜면 하루에 한 번 홈페이지의 최신 판 정보(latest.json)를 묻는다.
// - 더 새 판이 있으면 손님에게 묻고, [지금 업데이트]면 설치 파일을 받아 확인값(SHA-256)을 맞춰 본 뒤
//   앱을 닫고 설치 창 없이 같은 폴더에 덮어 깔고 다시 켠다.
// - 인터넷이 안 되거나, 사이트가 답하지 않거나, 받기에 실패하면 아무 말 없이 지금 판을 그대로 쓴다.
// - Store판은 Store가 업데이트하므로 하지 않는다. 개인용 설치판은 이 PC의 소스 폴더에서 다시 만들어 깐다.
// 이 파일에는 Electron을 쓰지 않는 부분만 둔다 (시험하기 쉽게). 화면·종료는 main.js가 한다.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const INFO_URL = "https://findinside.netlify.app/latest.json";
// 설치 파일은 이 주소에서만 받는다 (pages.dev 함수가 GitHub 릴리스에서 받아 넘겨주고, netlify.app은 그것을 프록시한다)
const ALLOWED_DOWNLOADS = ["https://findinside.pages.dev/download/", "https://findinside.netlify.app/download/"];
// 개인용 설치 폴더에 install-mine.js가 남기는 표시 파일
const PERSONAL_MARK = "personal-install.json";

// 시험할 때만: FINDINSIDE_UPDATE_INFO에 정보 파일 주소를 넣으면 그 주소에 묻고, 같은 곳(origin)에서 받는 것도 허락한다.
function sources(env = process.env) {
  const override = env.FINDINSIDE_UPDATE_INFO;
  if (!override) return { infoUrl: INFO_URL, allowed: ALLOWED_DOWNLOADS };
  return { infoUrl: override, allowed: [...ALLOWED_DOWNLOADS, `${new URL(override).origin}/`] };
}

// "1.0.10" > "1.0.9"처럼 숫자로 비교한다. a가 크면 양수.
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function isAllowedUrl(url, allowed = ALLOWED_DOWNLOADS) {
  if (typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // "../" 같은 것으로 다른 경로로 빠지지 않게, 정리된 주소로 비교한다
  return allowed.some((prefix) => parsed.href.startsWith(prefix));
}

// 정보 파일 내용을 검사한다. 이상하면 null (= 업데이트하지 않음)
function parseInfo(data, allowed = ALLOWED_DOWNLOADS) {
  if (!data || typeof data !== "object") return null;
  const { version, url, sha256 } = data;
  if (typeof version !== "string" || !/^\d+(\.\d+){1,3}$/.test(version)) return null;
  if (!isAllowedUrl(url, allowed)) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
  const notes = typeof data.notes === "string" ? data.notes.slice(0, 500) : "";
  return { version, url, sha256: sha256.toLowerCase(), notes };
}

// 오늘 날짜(이 PC 시각 기준) "2026-11-27" — 하루에 한 번만 묻는 데 쓴다
function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// 최신 판 정보를 묻는다. 실패하면 null
async function fetchInfo({ fetch, infoUrl, allowed, timeoutMs = 15_000 }) {
  try {
    const response = await fetch(infoUrl, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return parseInfo(await response.json(), allowed);
  } catch {
    return null;
  }
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// 설치 파일을 dir에 받고 확인값을 맞춰 본다. 맞으면 파일 경로, 아니면(받기 실패 포함) 파일을 지우고 null
async function download({ fetch, info, dir, allowed = ALLOWED_DOWNLOADS, onProgress = () => {}, timeoutMs = 30 * 60_000 }) {
  if (!isAllowedUrl(info.url, allowed)) return null;
  const file = path.join(dir, `Find_Setup_v${info.version}.exe`);
  try {
    await fsp.mkdir(dir, { recursive: true });
    const response = await fetch(info.url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || 0;
    let received = 0;
    const out = fs.createWriteStream(file);
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
        if (total) onProgress(Math.min(received / total, 1));
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if ((await sha256File(file)) !== info.sha256) throw new Error("확인값이 다릅니다");
    return file;
  } catch {
    await fsp.rm(file, { force: true }).catch(() => {});
    return null;
  }
}

// 설치 파일을 설치 창 없이 실행한다. 앱이 닫힌 뒤 같은 폴더에 덮어 깔고, 다 깔면 앱을 다시 켠다.
// (electron-builder 설치 파일: /S 조용히, --updated 업데이트로 알아봄(바로 가기 그대로), --force-run 끝나면 앱 켜기)
function runInstaller(file) {
  spawn(file, ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
}

// 개인용 설치판: 앱이 닫히기를 기다렸다가 소스 폴더에서 install-mine.js를 다시 돌리고 앱을 켠다.
// 진행 상황이 보이게 PowerShell 창을 띄운다 (빌드에 1~2분 걸린다).
function runPersonalUpdate({ mark, exe, pid, tempDir }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const script = [
    "$Host.UI.RawUI.WindowTitle = 'FindInside (개인용) 업데이트'",
    "Write-Host 'FindInside(개인용)를 새 판으로 다시 만드는 중입니다. 1~2분 걸립니다. 이 창을 닫지 마십시오.'",
    `Wait-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue`,
    "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue",
    `Set-Location -LiteralPath ${q(mark.source)}`,
    `& ${q(mark.node)} ${q(path.join(mark.source, "scripts", "install-mine.js"))}`,
    "if ($LASTEXITCODE -ne 0) { Write-Host ''; Write-Host '업데이트하지 못했습니다. 위 내용을 확인해 주십시오.'; Read-Host '엔터를 누르면 닫습니다'; exit 1 }",
    `Start-Process -FilePath ${q(exe)}`
  ].join("\r\n");
  fs.mkdirSync(tempDir, { recursive: true });
  const file = path.join(tempDir, "personal-update.ps1");
  // Windows PowerShell 5.1이 한글 경로를 읽게 BOM을 붙인다
  fs.writeFileSync(file, `﻿${script}`, "utf8");
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { detached: true, stdio: "ignore", windowsHide: false }).unref();
}

// 어떤 판인지: "installer"(설치 파일판), "personal"(개인용), null(업데이트 안 함: Store판·개발 중 실행)
function installKind({ isPackaged, windowsStore, exePath, productName = "FindInside" }) {
  if (!isPackaged || windowsStore) return null;
  const dir = path.dirname(exePath);
  if (fs.existsSync(path.join(dir, PERSONAL_MARK))) return "personal";
  // electron-builder 설치 파일로 깐 폴더에만 제거 프로그램이 있다
  if (fs.existsSync(path.join(dir, `Uninstall ${productName}.exe`))) return "installer";
  return null;
}

module.exports = { INFO_URL, ALLOWED_DOWNLOADS, PERSONAL_MARK, sources, compareVersions, isAllowedUrl, parseInfo, localDay, readJson, fetchInfo, sha256File, download, runInstaller, runPersonalUpdate, installKind };
