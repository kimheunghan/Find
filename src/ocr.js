"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");

// OCR 엔진 두 가지를 상주 프로세스로 띄워 한 줄 JSON으로 주고받는다.
// - windows: Windows 내장 OCR(Windows.Media.Ocr). 한 장에 0.1~1초, Python 불필요. 작은 글씨는 2배 키워 읽는다.
// - paddle: PaddleOCR. 이 PC의 CPU에서 한 장에 10~40초지만 작은 한글(예: 최삼순/최상순)을 더 정확히 읽는다 (Python 필요).
// 빠른 판독은 windows, 정밀 판독은 windows + paddle 결과를 합친다 (extract.js).
const DEFAULT_ENGINE = process.env.FINDINSIDE_OCR === "paddle" || process.platform !== "win32" ? "paddle" : "windows";
const TIMEOUT_MS = { windows: 60_000, paddle: 180_000 };
const engines = new Map();

function pythonExecutable() {
  if (process.env.FINDINSIDE_PYTHON) return process.env.FINDINSIDE_PYTHON;
  return path.join(__dirname, "..", ".ocr-venv", "Scripts", "python.exe");
}

// Windows OCR 결과(줄 목록)를 위에서 아래, 왼쪽에서 오른쪽 순서의 조각으로 바꾼다.
function linesToChunks(lines) {
  return [].concat(lines || [])
    .filter((line) => line && String(line.text || "").trim())
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((line, index) => ({ location: { ocr: true, line: index + 1 }, text: String(line.text).trim() }));
}

function spawnEngine(name) {
  if (name === "windows") {
    const script = path.join(__dirname, "..", "scripts", "winocr.ps1");
    return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }
  const script = path.join(__dirname, "..", "scripts", "ocr_worker.py");
  return spawn(pythonExecutable(), ["-u", script], {
    windowsHide: true,
    // 한국어 Windows에서 Python 표준 입출력 기본값은 CP949라 한글 경로가 깨진다. UTF-8로 고정한다.
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function engine(name) {
  let state = engines.get(name);
  if (state?.process && !state.process.killed) return state;
  state = { process: spawnEngine(name), pending: new Map(), nextId: 1, stdout: "", stderr: "" };
  engines.set(name, state);
  const failAll = (error) => {
    for (const request of state.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    state.pending.clear();
  };
  state.process.stdout.setEncoding("utf8");
  state.process.stdout.on("data", (data) => {
    state.stdout += data;
    const lines = state.stdout.split(/\r?\n/);
    state.stdout = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = state.pending.get(message.id);
      if (!request) continue;
      state.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message.chunks || linesToChunks(message.lines));
      else request.reject(new Error(message.error || "이미지 글자를 읽지 못했습니다"));
    }
  });
  state.process.stderr.setEncoding("utf8");
  state.process.stderr.on("data", (data) => { state.stderr = `${state.stderr}${data}`.slice(-4000); });
  state.process.once("error", (error) => {
    engines.delete(name);
    failAll(new Error(`OCR 실행 준비가 필요합니다: ${error.message}`));
  });
  state.process.once("exit", (code) => {
    if (engines.get(name) === state) engines.delete(name);
    const detail = state.stderr.trim().split(/\r?\n/).slice(-1)[0];
    failAll(new Error(`OCR가 종료되었습니다${code === null ? "" : ` (${code})`}${detail ? `: ${detail}` : ""}`));
  });
  return state;
}

function extractImageText(filePath, name = DEFAULT_ENGINE) {
  return new Promise((resolve, reject) => {
    const state = engine(name);
    const id = state.nextId++;
    const timeout = TIMEOUT_MS[name];
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`이미지 OCR 처리 시간이 ${timeout / 1000}초를 넘었습니다`));
    }, timeout);
    state.pending.set(id, { resolve, reject, timer });
    // Windows OCR(StorageFile)은 "C:/a/b.png"처럼 /가 섞인 경로를 열지 못한다. Windows 형식 절대 경로로 넘긴다.
    state.process.stdin.write(`${JSON.stringify({ id, path: path.resolve(filePath) })}\n`, "utf8", (error) => {
      if (!error) return;
      state.pending.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
}

// 색인이 끝나면 상주 OCR 프로세스(모델이 메모리에 올라가 있음)를 내린다.
function stopOcr() {
  for (const [name, state] of engines) {
    engines.delete(name);
    state.process.stdin.end();
    setTimeout(() => { if (state.process.exitCode === null) state.process.kill(); }, 3000).unref();
  }
}

module.exports = { ENGINE: DEFAULT_ENGINE, extractImageText, stopOcr, pythonExecutable, linesToChunks };
