"use strict";

const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

// OCR 엔진 두 가지를 상주 프로세스로 띄워 한 줄 JSON으로 주고받는다.
// - windows: Windows 내장 OCR(Windows.Media.Ocr). 한 장에 0.1~1초, Python 불필요. 작은 글씨는 2배 키워 읽는다.
// - paddle: PaddleOCR. 이 PC의 CPU에서 한 장에 10~40초지만 작은 한글(예: 최삼순/최상순)을 더 정확히 읽는다 (Python 필요).
// 빠른 판독은 windows, 정밀 판독은 windows + paddle 결과를 합친다 (extract.js).
const DEFAULT_ENGINE = process.env.FINDINSIDE_OCR === "paddle" || process.platform !== "win32" ? "paddle" : "windows";
const TIMEOUT_MS = { windows: 60_000, paddle: 180_000 };
const engines = new Map();
// Windows OCR 프로세스 수. 하나는 CPU를 다 못 쓰므로 둘로 나눠 읽는다 (메모리가 넉넉하면 FINDINSIDE_OCR_WORKERS로 늘림).
const WINDOWS_POOL = Math.max(1, Number(process.env.FINDINSIDE_OCR_WORKERS) || 2);
let nextSlot = 0;

function pythonExecutable() {
  if (process.env.FINDINSIDE_PYTHON) return process.env.FINDINSIDE_PYTHON;
  return path.join(__dirname, "..", ".ocr-venv", "Scripts", "python.exe");
}

// 세로쓰기 복원: Windows OCR은 세로쓰기의 글자 하나하나는 알아보지만 가로 줄로 잘못 묶는다
// (예: 세로 "아들홍묵", "21세", "최삼순" → "아 권 2 최 / 들 지 1 삼 / 홍 구 세").
// 한 글자(또는 짧은 숫자) 단어를 가로 위치가 같은 것끼리 세로 줄로 모으고, 위에서 아래로 잇는다.
// 세로로 2글자 이상 쌓인 줄만 돌려준다.
function verticalColumns(lines) {
  const cells = [];
  for (const line of [].concat(lines || [])) {
    for (const word of [].concat(line?.words || [])) {
      const text = String(word.text || "").trim();
      if (!text || !([...text].length === 1 || /^\p{N}{1,3}$/u.test(text))) continue;
      cells.push({ text, cx: word.x + word.w / 2, y: word.y, w: Math.max(1, word.w), h: Math.max(1, word.h) });
    }
  }
  cells.sort((a, b) => a.cx - b.cx);
  const columns = [];
  for (const cell of cells) {
    const column = columns.find((item) => Math.abs(item.cx - cell.cx) <= Math.max(item.size, cell.h) * 0.6);
    if (column) {
      column.cells.push(cell);
      column.cx += (cell.cx - column.cx) / column.cells.length;
    } else {
      columns.push({ cx: cell.cx, size: cell.h, cells: [cell] });
    }
  }
  const result = [];
  for (const column of columns) {
    const stacked = column.cells.sort((a, b) => a.y - b.y);
    let run = [stacked[0]];
    const flush = () => {
      if (run.length < 2) return;
      const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const steps = run.slice(1).map((cell, i) => cell.y - run[i].y).filter((step) => step > 0);
      result.push({
        x: column.cx,
        y: run[0].y,
        text: run.map((cell) => cell.text).join(""),
        charWidth: median(run.map((cell) => cell.w)),
        charHeight: median(run.map((cell) => cell.h)),
        pitch: steps.length ? median(steps) : median(run.map((cell) => cell.h)) * 1.3
      });
    };
    for (let i = 1; i < stacked.length; i += 1) {
      const previous = stacked[i - 1];
      const current = stacked[i];
      // 글자 높이보다 훨씬 떨어져 있으면 다른 세로 줄로 본다
      if (current.y - (previous.y + previous.h) > Math.max(previous.h, current.h) * 1.5) {
        flush();
        run = [current];
      } else {
        run.push(current);
      }
    }
    flush();
  }
  return result.sort((a, b) => (a.x - b.x) || (a.y - b.y));
}

// Windows OCR 결과(가로 줄 목록)를 위에서 아래, 왼쪽에서 오른쪽 순서의 조각으로 바꾼다.
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

function engine(name, slot = 0) {
  const key = `${name}#${slot}`;
  let state = engines.get(key);
  if (state?.process && !state.process.killed) return state;
  state = { process: spawnEngine(name), pending: new Map(), nextId: 1, stdout: "", stderr: "" };
  // OCR은 CPU를 오래 쓰므로 낮은 우선순위로 돌려, 검색·화면 조작이 먼저 처리되게 한다.
  try {
    os.setPriority(state.process.pid, os.constants.priority.PRIORITY_LOW);
  } catch {
    // 우선순위를 못 바꾸면 그대로 돈다
  }
  engines.set(key, state);
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
      state.warm = true;
      if (message.ok) request.resolve(message);
      else request.reject(new Error(message.error || "이미지 글자를 읽지 못했습니다"));
    }
  });
  state.process.stderr.setEncoding("utf8");
  state.process.stderr.on("data", (data) => { state.stderr = `${state.stderr}${data}`.slice(-4000); });
  state.process.once("error", (error) => {
    engines.delete(key);
    failAll(new Error(`OCR 실행 준비가 필요합니다: ${error.message}`));
  });
  state.process.once("exit", (code) => {
    if (engines.get(key) === state) engines.delete(key);
    const detail = state.stderr.trim().split(/\r?\n/).slice(-1)[0];
    failAll(new Error(`OCR가 종료되었습니다${code === null ? "" : ` (${code})`}${detail ? `: ${detail}` : ""}`));
  });
  return state;
}

// 세로쓰기 다시 읽기: 첫 판독에서 찾은 세로 줄마다 원본 좌표로 글자 칸 크기·간격을 정해,
// 한 글자 칸씩 잘라 가로로 이어 붙인 이미지를 다시 읽는다. 첫 판독에서 빠진 아래쪽 글자까지 읽기 위해서다.
async function readVertical(filePath, first, slot = 0) {
  // 표의 숫자 칸 등이 세로 줄로 잡힐 수 있어, 한 이미지에서 다시 읽는 세로 줄 수를 제한한다.
  const columns = verticalColumns(first.lines).slice(0, 30);
  if (!columns.length) return [];
  const scale = first.scale || 1;
  const requestColumns = columns.map((column) => {
    const size = Math.max(column.charWidth, column.charHeight) / scale;
    const pitch = Math.max(column.pitch / scale, size);
    const top = Math.max(0, column.y / scale - (pitch - column.charHeight / scale) / 2);
    const width = size * 1.4;
    const count = Math.min(80, Math.max(1, Math.floor(((first.height || top + pitch) - top) / pitch)));
    return { x: Math.max(0, Math.round(column.x / scale - width / 2)), top: Math.round(top), width: Math.round(width), pitch: Math.round(pitch), count };
  });
  let texts = [];
  try {
    texts = (await request(filePath, "windows", { columns: requestColumns }, slot)).texts || [];
  } catch {
    texts = [];
  }
  // 다시 읽은 결과가 비면 첫 판독에서 이어 붙인 글자를 쓴다
  return columns.map((column, index) => (String(texts[index] || "").length >= column.text.length ? texts[index] : column.text));
}

async function extractImageText(filePath, name = DEFAULT_ENGINE) {
  // 이미지 한 장(첫 판독과 세로 다시 읽기)은 같은 OCR 프로세스에서 처리한다.
  const slot = name === "windows" ? nextSlot++ % WINDOWS_POOL : 0;
  const first = await request(filePath, name, {}, slot);
  if (first.chunks) return first.chunks;
  const horizontal = linesToChunks(first.lines);
  const vertical = (await readVertical(filePath, first, slot))
    .filter(Boolean)
    .map((text, index) => ({ location: { ocr: true, vertical: true, line: index + 1 }, text }));
  return [...horizontal, ...vertical];
}

function request(filePath, name, extra = {}, slot = 0) {
  return new Promise((resolve, reject) => {
    const state = engine(name, slot);
    const id = state.nextId++;
    // 첫 요청은 OCR 프로그램을 띄우고 모델을 불러오는 시간(메모리가 부족하면 1분 이상)까지 기다린다.
    const timeout = state.warm ? TIMEOUT_MS[name] : 300_000;
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`이미지 OCR 처리 시간이 ${timeout / 1000}초를 넘었습니다`));
    }, timeout);
    state.pending.set(id, { resolve, reject, timer });
    // Windows OCR(StorageFile)은 "C:/a/b.png"처럼 /가 섞인 경로를 열지 못한다. Windows 형식 절대 경로로 넘긴다.
    state.process.stdin.write(`${JSON.stringify({ id, path: path.resolve(filePath), ...extra })}\n`, "utf8", (error) => {
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

module.exports = { ENGINE: DEFAULT_ENGINE, extractImageText, stopOcr, pythonExecutable, linesToChunks, verticalColumns };
