"use strict";

// 검색 결과의 일치한 곳을 누르면 문서를 그 위치(쪽·슬라이드·시트 칸)로 연다.
// 한글·Word·PowerPoint·Excel은 각 프로그램의 자동화(COM)를 PowerShell 스크립트(src/goto/*.ps1)로 부르고, 일치한 문구를 찾아 선택해 둔다.
// 프로그램이 없거나 자동화가 실패하면 false를 돌려주고, 부르는 쪽이 평소처럼 파일만 연다.
// 스크립트는 -EncodedCommand가 아니라 파일(-File)로 실행한다. 인코딩된 명령은 백신이 악성 스크립트로 보고 막는 경우가 있다.
const { spawn } = require("child_process");
const path = require("path");

const TIMEOUT_MS = 60_000;
const HWP_OPEN_TIMEOUT_MS = 120_000;

// 한글은 계속 도는 도우미(src/goto/hwp-server.ps1)가 숨겨 둔 한글로 연다 (hwpServer)
const SCRIPTS = {
  docx: "word.ps1", doc: "word.ps1",
  pptx: "powerpoint.ps1", ppt: "powerpoint.ps1",
  xlsx: "excel.ps1", xls: "excel.ps1",
  pdf: "acrobat.ps1"
};

// 명령줄 인수에 큰따옴표가 들어가면 PowerShell 인수 해석이 어긋나므로 뺀다
const clean = (value) => String(value || "").replace(/["\r\n]/g, " ").slice(0, 200);

function runScript(name, args) {
  const script = path.join(__dirname, "goto", name);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { windowsHide: true });
    } catch (error) {
      resolve({ ok: false, output: String(error) });
      return;
    }
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, output: output + String(error) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0 && /\bOK\b/.test(output), output }); });
  });
}

// ---- 한글 도우미 ----
// 한글을 새로 띄우는 데 5초 넘게 걸리므로, 검색 결과에 한글 문서가 보이면 숨긴 한글을 미리 띄워 둔다 (warmHwp).
// 보안 모듈 등록(RegisterModule)을 부르지 않으므로 한글의 "접근 허용" 확인 창이 뜨지 않는다.
let server = null;
let nextId = 1;
const waiting = new Map();

function hwpServer() {
  if (server) return server;
  const script = path.join(__dirname, "goto", "hwp-server.ps1");
  try {
    server = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
  } catch {
    return null;
  }
  let buffer = "";
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (data) => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      const match = /^(OK|ERR) (\d+)\s*(.*)$/.exec(line);
      const request = match && waiting.get(Number(match[2]));
      if (!request) continue;
      waiting.delete(Number(match[2]));
      clearTimeout(request.timer);
      if (match[1] === "ERR") console.error("hwp-server", match[3]);
      request.resolve(match[1] === "OK");
    }
  });
  server.stderr.on("data", (data) => console.error("hwp-server", String(data).slice(0, 300)));
  const stop = () => {
    server = null;
    for (const request of waiting.values()) { clearTimeout(request.timer); request.resolve(false); }
    waiting.clear();
  };
  server.on("error", stop);
  server.on("exit", stop);
  return server;
}

function askHwp(request) {
  const child = hwpServer();
  if (!child) return Promise.resolve(false);
  return new Promise((resolve) => {
    const id = nextId++;
    // 열기는 창을 보인 채 진행하므로, 한글이 확인 창을 띄우면 사용자가 답할 시간을 둔다
    const timer = setTimeout(() => { waiting.delete(id); resolve(false); }, request.type === "open" ? HWP_OPEN_TIMEOUT_MS : TIMEOUT_MS);
    waiting.set(id, { resolve, timer });
    child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
  });
}

// 한글이 없는 PC에서는 도우미가 실패로 답하고, 그 뒤로는 평소처럼 파일만 연다
function warmHwp() {
  if (process.platform === "win32") askHwp({ type: "warm" });
}

// 앱이 끝날 때: 입력을 닫으면 도우미가 숨겨 둔 한글을 닫고 끝난다
function stopHwp() {
  server?.stdin.end();
}

// target: 검색 결과의 위치 { page, tableFrom, slide, sheet, cell, ... }, text: 찾을 문구, term: 일치한 검색어
async function openAt(filePath, target = {}, text = "", term = "") {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (process.platform !== "win32") return false;
  if (extension === "hwp" || extension === "hwpx") {
    return askHwp({ type: "open", path: path.resolve(filePath), page: Number(target.page || target.tableFrom) || 0, text: String(text || "").slice(0, 200), term: String(term || "").slice(0, 200) });
  }
  const name = SCRIPTS[extension];
  if (!name) return false;
  const args = [
    "-Path", path.resolve(filePath),
    "-Page", String(Number(target.page || target.tableFrom) || 0),
    "-Slide", String(Number(target.slide) || 0),
    "-Sheet", clean(target.sheet),
    "-Cell", clean(target.cell),
    "-Text", clean(text),
    "-Term", clean(term)
  ];
  const result = await runScript(name, args);
  if (!result.ok) console.error("openAt", extension, result.output.slice(0, 500));
  return result.ok;
}

module.exports = { openAt, warmHwp, stopHwp, SCRIPTS };
