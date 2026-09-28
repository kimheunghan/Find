"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");

const REQUEST_TIMEOUT_MS = 180_000;
let worker;
let stderr = "";
let nextId = 1;
let stdoutBuffer = "";
const pending = new Map();

function pythonExecutable() {
  if (process.env.FINDINSIDE_PYTHON) return process.env.FINDINSIDE_PYTHON;
  return path.join(__dirname, "..", ".ocr-venv", "Scripts", "python.exe");
}

function failAll(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function onLine(line) {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.ok) request.resolve(message.chunks || []);
  else request.reject(new Error(message.error || "이미지 글자를 읽지 못했습니다"));
}

function ensureWorker() {
  if (worker && !worker.killed) return worker;
  stderr = "";
  const script = path.join(__dirname, "..", "scripts", "ocr_worker.py");
  worker = spawn(pythonExecutable(), ["-u", script], {
    windowsHide: true,
    // 한국어 Windows에서 Python 표준 입출력 기본값은 CP949라 한글 경로가 깨진다. UTF-8로 고정한다.
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  worker.stdout.setEncoding("utf8");
  worker.stdout.on("data", (data) => {
    stdoutBuffer += data;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    lines.forEach(onLine);
  });
  worker.stderr.setEncoding("utf8");
  worker.stderr.on("data", (data) => { stderr = `${stderr}${data}`.slice(-4000); });
  worker.once("error", (error) => {
    worker = null;
    failAll(new Error(`OCR 실행 준비가 필요합니다: ${error.message}`));
  });
  worker.once("exit", (code) => {
    worker = null;
    const detail = stderr.trim().split(/\r?\n/).slice(-1)[0];
    failAll(new Error(`OCR가 종료되었습니다${code === null ? "" : ` (${code})`}${detail ? `: ${detail}` : ""}`));
  });
  return worker;
}

function extractImageText(filePath) {
  return new Promise((resolve, reject) => {
    const process = ensureWorker();
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("이미지 OCR 처리 시간이 3분을 넘었습니다"));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    process.stdin.write(`${JSON.stringify({ id, path: filePath })}\n`, "utf8", (error) => {
      if (!error) return;
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
}

// 색인이 끝나면 상주 OCR 프로세스(모델이 메모리에 올라가 있음)를 내린다.
function stopOcr() {
  if (!worker) return;
  const current = worker;
  worker = null;
  current.stdin.end();
  setTimeout(() => { if (current.exitCode === null) current.kill(); }, 3000).unref();
}

module.exports = { extractImageText, stopOcr, pythonExecutable };
