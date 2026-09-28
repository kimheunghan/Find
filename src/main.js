"use strict";

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");

// 일부 Windows 환경에서 GPU 프로세스가 시작되지 않아 앱 전체가 종료되는 것을 막는다.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
const fs = require("node:fs/promises");
const path = require("node:path");
const fsSync = require("node:fs");
const { indexRoots, isExcluded } = require("./indexer");
const { Worker } = require("node:worker_threads");
const { openContentIndex, contentStats } = require("./contentIndex");
const { SUPPORTED_EXTENSIONS, IMAGE_EXTENSIONS } = require("./extract");

let window;
let contentDb;
// 설정(검색 위치·제외 폴더)은 작은 설정 파일에, 파일 목록(수백 MB)은 색인 파일에 둔다.
// 메인 프로세스는 파일 목록을 들고 있지 않는다. 목록은 검색 worker가 읽어 검색한다.
let settings = { roots: [], excludedPaths: [] };
let meta = { entryCount: 0, errorCount: 0, indexedAt: null };

function createApplicationMenu() {
  const template = [
    {
      label: "파일",
      submenu: [
        { label: "창 닫기", role: "close" },
        { type: "separator" },
        { label: "종료", role: "quit" }
      ]
    },
    {
      label: "편집",
      submenu: [
        { label: "실행 취소", role: "undo" },
        { label: "다시 실행", role: "redo" },
        { type: "separator" },
        { label: "잘라내기", role: "cut" },
        { label: "복사", role: "copy" },
        { label: "붙여넣기", role: "paste" },
        { label: "전체 선택", role: "selectAll" }
      ]
    },
    {
      label: "보기",
      submenu: [
        { label: "새로 고침", role: "reload" },
        { type: "separator" },
        { label: "확대", role: "zoomIn" },
        { label: "축소", role: "zoomOut" },
        { label: "기본 크기", role: "resetZoom" },
        { type: "separator" },
        { label: "전체 화면", role: "togglefullscreen" }
      ]
    },
    {
      label: "창",
      submenu: [
        { label: "최소화", role: "minimize" },
        { label: "확대/복원", role: "zoom" }
      ]
    },
    {
      label: "도움말",
      submenu: [
        {
          label: "FindInside 정보",
          click: () => dialog.showMessageBox(window, {
            type: "info",
            title: "FindInside 정보",
            message: "FindInside",
            detail: `버전 ${app.getVersion()}\n파일명, 폴더명과 경로를 빠르게 검색하는 PC 앱입니다.`
          })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function indexFile() {
  return path.join(app.getPath("userData"), "findinside-index.json");
}

function deltaFile() {
  return path.join(app.getPath("userData"), "findinside-delta.json");
}

function settingsFile() {
  return path.join(app.getPath("userData"), "findinside-settings.json");
}

// 설정 파일이 없으면(예전 버전) null. 그때는 색인 파일 안의 설정을 옮겨 쓴다.
async function loadSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), "utf8"));
  } catch {
    return null;
  }
}

async function saveSettings() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings), "utf8");
}

// ---- 검색 worker ----
let searchWorker;
let searchReady;
let nextRequest = 1;
const pendingRequests = new Map();

function startSearchWorker() {
  searchWorker = new Worker(path.join(__dirname, "searchWorker.js"), { workerData: { dbPath: contentDbPath(), indexPath: indexFile(), deltaPath: deltaFile() } });
  searchWorker.on("message", ({ id, result, error }) => {
    const request = pendingRequests.get(id);
    if (!request) return;
    pendingRequests.delete(id);
    if (error) request.reject(new Error(error));
    else request.resolve(result);
  });
}

function askSearchWorker(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = nextRequest++;
    pendingRequests.set(id, { resolve, reject });
    searchWorker.postMessage({ id, type, ...payload });
  });
}

// 색인 파일을 검색 worker가 (다시) 읽게 하고, 개수·내용 색인 대상을 받아 둔다.
async function reloadIndex() {
  const loaded = await askSearchWorker("load");
  meta = { entryCount: loaded.entryCount, errorCount: loaded.errorCount, indexedAt: loaded.indexedAt };
  return loaded;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: "FindInside",
    // autoHideMenuBar를 켜면 Alt 키를 메뉴 막대가 가져간다. 한국어 키보드의 한/영 키는 오른쪽 Alt로 들어오는 경우가 많아
    // 한/영 전환이 막힌다. 메뉴는 Menu.setApplicationMenu(null)로 없애므로 켜지 않는다.
    autoHideMenuBar: false,
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  window.webContents.once("did-finish-load", () => {
    searchReady.then((loaded) => {
      if (loaded.entryCount) runIndexing(() => refreshContent(loaded.targets)).catch(() => {});
    });
  });
}

app.whenReady().then(async () => {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  contentDb = openContentIndex(contentDbPath(), { migrate: false });
  const savedSettings = await loadSettings();
  if (savedSettings) settings = { roots: savedSettings.roots || [], excludedPaths: savedSettings.excludedPaths || [] };
  startSearchWorker();
  searchReady = reloadIndex().then(async (loaded) => {
    if (!savedSettings) {
      settings = { roots: loaded.roots, excludedPaths: loaded.excludedPaths };
      await saveSettings();
    }
    loadDelta();
    watchRoots();
    return loaded;
  });
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("folder:choose", async () => {
  const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("state:get", async () => {
  await searchReady;
  return {
    roots: settings.roots,
    excludedPaths: settings.excludedPaths,
    ...meta,
    indexing: Boolean(indexing),
    content: contentDb ? contentStats(contentDb) : {}
  };
});

ipcMain.handle("roots:set", async (_, roots) => {
  settings.roots = [...new Set(roots.map((item) => path.resolve(item)))];
  await saveSettings();
  watchRoots();
  return settings.roots;
});

ipcMain.handle("excludes:set", async (_, excludedPaths) => {
  settings.excludedPaths = [...new Set(excludedPaths.map((item) => path.resolve(item)))];
  await saveSettings();
  return settings.excludedPaths;
});

let indexing = null;

// 색인 작업은 한 번에 하나만 돈다. 이미 돌고 있으면 그 작업이 끝나기를 기다린다.
function runIndexing(job) {
  indexing ||= job()
    .then((summary) => {
      window?.webContents.send("index:done", summary);
      return summary;
    })
    .finally(() => { indexing = null; });
  return indexing;
}

function indexSummary(content) {
  return { ...meta, content };
}

function contentDbPath() {
  return path.join(app.getPath("userData"), "findinside-content.db");
}

// 내용 추출은 worker 스레드에서 돌려 창 입력이 멈추지 않게 한다.
// 전체 목록(수백만 개)을 넘기면 복사 비용이 커서, 내용 색인 대상 파일만 골라 넘긴다.
// 이미지 OCR은 한 장에 수 초가 걸려 문서 뒤로 미루면 몇 시간씩 시작하지 못하므로, 별도 worker로 동시에 돌린다.
function contentTargets(entries, group) {
  return entries
    .filter((entry) => entry.kind === "file" && SUPPORTED_EXTENSIONS.has(entry.extension)
      && (group === "images") === IMAGE_EXTENSIONS.has(entry.extension))
    .map(({ name, path: filePath, kind, extension }) => ({ name, path: filePath, kind, extension }));
}

let ocrWorker = null;

// 정밀 판독 대상: 사용자 폴더(그림·바탕 화면·문서·다운로드)의 이미지. 한 장에 10~40초라 전체가 아니라 여기만 한다.
function preciseTargets(images) {
  const folders = ["pictures", "desktop", "documents", "downloads"].map((name) => {
    try {
      return path.resolve(app.getPath(name)).toLocaleLowerCase();
    } catch {
      return null;
    }
  }).filter(Boolean);
  return images.filter((entry) => {
    const lower = entry.path.toLocaleLowerCase();
    return folders.some((folder) => lower.startsWith(`${folder}\\`));
  });
}

let preciseWorker = null;

function startPreciseOcr(images) {
  preciseWorker?.terminate();
  // 정밀 판독(PaddleOCR)은 한 장에 수십 초, 메모리 1GB 안팎을 써서 PC 전체가 느려진다.
  // 기본으로 끄고, FINDINSIDE_PRECISE_OCR=1일 때만 돌린다.
  if (process.env.FINDINSIDE_PRECISE_OCR !== "1") return;
  const targets = preciseTargets(images);
  if (!targets.length) return;
  const worker = new Worker(path.join(__dirname, "contentWorker.js"), { workerData: { dbPath: contentDbPath(), group: "ocr-precise" } });
  preciseWorker = worker;
  worker.on("message", (message) => {
    if (message.type === "progress") window?.webContents.send("index:progress", { phase: "ocr-precise", ...message.progress });
    else if (message.type === "done" || message.type === "error") {
      window?.webContents.send("index:progress", { phase: "ocr-precise", done: targets.length, total: targets.length, finished: true, error: message.message });
      worker.terminate();
    }
  });
  worker.on("exit", () => { if (preciseWorker === worker) preciseWorker = null; });
  worker.postMessage({ type: "index", entries: targets });
}

function startOcr(targets) {
  ocrWorker?.terminate();
  // 정밀 판독은 빠른 판독이 끝나기를 기다리지 않고 함께 돌린다 (둘 다 최신 이미지부터, 빠른 판독이 앞서 간다).
  startPreciseOcr(targets);
  const worker = new Worker(path.join(__dirname, "contentWorker.js"), { workerData: { dbPath: contentDbPath(), group: "images" } });
  ocrWorker = worker;
  worker.on("message", (message) => {
    if (message.type === "progress") window?.webContents.send("index:progress", { phase: "ocr", ...message.progress });
    else if (message.type === "done" || message.type === "error") {
      window?.webContents.send("index:progress", { phase: "ocr", done: targets.length, total: targets.length, finished: true, error: message.message });
      worker.terminate();
    }
  });
  worker.on("exit", () => { if (ocrWorker === worker) ocrWorker = null; });
  worker.postMessage({ type: "index", entries: targets });
}

// targets: { documents, images } (내용 색인 대상 문서·이미지)
function indexContentInWorker({ documents: targets, images }) {
  startOcr(images);
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "contentWorker.js"), { workerData: { dbPath: contentDbPath(), group: "documents" } });
    worker.on("message", (message) => {
      if (message.type === "progress") {
        window?.webContents.send("index:progress", { phase: "content", ...message.progress });
      } else if (message.type === "done") {
        resolve(message.summary);
        worker.terminate();
      } else if (message.type === "error") {
        reject(new Error(message.message));
        worker.terminate();
      }
    });
    worker.on("error", reject);
    worker.postMessage({ type: "index", entries: targets });
  });
}

ipcMain.handle("index:rebuild", () => runIndexing(rebuildIndex));

// 앱을 켤 때: 파일 목록은 저장된 것을 쓰고, 내용 색인만 이어서 만든다. 바뀌지 않은 파일은 건너뛴다.
// ---- 폴더 감시: 새로 생기거나 바뀌거나 지워진 파일을 몇 초 안에 목록·내용 색인에 반영한다 (전체 재색인 없이) ----
let watchers = [];
const changedPaths = new Set();
let flushTimer = null;
let delta = { added: new Map(), removed: new Set() }; // 마지막 전체 색인 뒤의 변경분 (앱을 다시 켜도 유지)
let deltaQueue = [];
let deltaWorker = null;

function loadDelta() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(deltaFile(), "utf8"));
    delta = { added: new Map((saved.added || []).map((entry) => [entry.path, entry])), removed: new Set(saved.removed || []) };
  } catch {
    delta = { added: new Map(), removed: new Set() };
  }
}

// 감시하지 않는 곳: 캐시·임시 파일이 쉴 새 없이 바뀌는 시스템·앱 폴더와 이 앱의 데이터 폴더.
// (C:\ 전체를 감시하면 AppData 캐시 변경이 3초마다 수천 건씩 몰려 메인 프로세스가 멈춘다)
const WATCH_SKIP = /\\(appdata|\$recycle\.bin|system volume information|node_modules|\.git|\.cache|\.claude|\.vscode|\.gradle|temp|tmp)(\\|$)|^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/i;
const MAX_CHANGES_PER_FLUSH = 500;
let deltaSaveTimer = null;

function shouldWatch(target) {
  const lower = target.toLocaleLowerCase();
  if (lower.startsWith(path.resolve(app.getPath("userData")).toLocaleLowerCase())) return false;
  return !WATCH_SKIP.test(target);
}

// 변경분 파일은 30초에 한 번만 쓴다 (변경 때마다 쓰면 메인 프로세스가 붙잡힌다).
function saveDeltaLater() {
  deltaSaveTimer ||= setTimeout(() => {
    deltaSaveTimer = null;
    fs.writeFile(deltaFile(), JSON.stringify({ added: [...delta.added.values()], removed: [...delta.removed] }), "utf8").catch(() => {});
  }, 30_000);
}

function watchRoots() {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  for (const rootPath of settings.roots) {
    try {
      const watcher = fsSync.watch(rootPath, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const target = path.join(rootPath, filename.toString());
        if (!shouldWatch(target)) return;
        changedPaths.add(target);
        flushTimer ||= setTimeout(flushChanges, 3000);
      });
      watcher.on("error", () => {});
      watchers.push(watcher);
    } catch {
      // 감시할 수 없는 위치는 건너뛴다 (전체 색인으로 반영)
    }
  }
}

async function flushChanges() {
  flushTimer = null;
  // 한 번에 너무 많이 처리하지 않는다. 남은 것은 다음 차례에.
  const paths = [...changedPaths].slice(0, MAX_CHANGES_PER_FLUSH);
  for (const target of paths) changedPaths.delete(target);
  if (changedPaths.size) flushTimer ||= setTimeout(flushChanges, 3000);
  const added = [];
  const removed = [];
  for (const target of paths) {
    if (isExcluded(target, settings.excludedPaths)) continue;
    try {
      const stat = await fs.stat(target);
      const extension = stat.isFile() ? path.extname(target).slice(1).toLocaleLowerCase() : "";
      if (stat.isFile() || stat.isDirectory()) {
        added.push({ name: path.basename(target), path: target, kind: stat.isDirectory() ? "folder" : "file", extension });
      }
    } catch {
      removed.push(target);
    }
  }
  if (!added.length && !removed.length) return;
  for (const entry of added) {
    delta.added.set(entry.path, entry);
    delta.removed.delete(entry.path);
  }
  for (const target of removed) {
    delta.added.delete(target);
    delta.removed.add(target);
  }
  saveDeltaLater();
  await searchReady;
  const updated = await askSearchWorker("update", { query: { added, removed } }).catch(() => null);
  if (updated) meta.entryCount = updated.entryCount;
  // 내용 색인 대상(문서·이미지)은 작은 worker로 바로 처리한다. 지워진 파일은 전체 색인 때 정리된다.
  deltaQueue.push(...added.filter((entry) => entry.kind === "file" && SUPPORTED_EXTENSIONS.has(entry.extension)));
  runDeltaContent();
}

function runDeltaContent() {
  if (deltaWorker || !deltaQueue.length) return;
  const batch = [...new Map(deltaQueue.map((entry) => [entry.path, entry])).values()];
  deltaQueue = [];
  deltaWorker = new Worker(path.join(__dirname, "contentWorker.js"), { workerData: { dbPath: contentDbPath(), group: "delta" } });
  const finish = () => {
    deltaWorker?.terminate();
    deltaWorker = null;
    window?.webContents.send("index:changed", { count: batch.length });
    runDeltaContent();
  };
  deltaWorker.on("message", (message) => { if (message.type === "done" || message.type === "error") finish(); });
  deltaWorker.on("error", finish);
  deltaWorker.postMessage({ type: "index", entries: batch });
}

async function refreshContent(targets) {
  return indexSummary(await indexContentInWorker(targets));
}

async function rebuildIndex() {
  await searchReady;
  const result = await indexRoots(settings.roots, {
    excludedPaths: settings.excludedPaths,
    onProgress: (progress) => window?.webContents.send("index:progress", progress)
  });
  // 색인 파일에는 예전 버전과 호환되도록 설정도 함께 적는다. 전체 색인이 변경분을 모두 담으므로 변경분은 비운다.
  await fs.writeFile(indexFile(), JSON.stringify({ ...settings, ...result }), "utf8");
  delta = { added: new Map(), removed: new Set() };
  await fs.rm(deltaFile(), { force: true });
  const targets = { documents: contentTargets(result.entries, "documents"), images: contentTargets(result.entries, "images") };
  searchReady = reloadIndex();
  await searchReady;
  return indexSummary(await indexContentInWorker(targets));
}

// 검색은 검색 worker가 한다 (메인 프로세스가 붙잡히면 한/영 전환 등 키 입력이 막힌다).
ipcMain.handle("search:run", async (_, query, filters) => {
  await searchReady;
  return askSearchWorker("search", { query, filters: filters || {} });
});
ipcMain.handle("item:open", (_, targetPath) => shell.openPath(targetPath));
ipcMain.handle("item:show", (_, targetPath) => shell.showItemInFolder(targetPath));
// 문서 안 위치로 바로 갈 수 없으므로, 일치한 문구를 복사해 두고 문서를 연다 (문서에서 Ctrl+F → Ctrl+V).
ipcMain.handle("item:openAt", (_, targetPath, phrase) => {
  if (phrase) clipboard.writeText(String(phrase));
  return shell.openPath(targetPath);
});
ipcMain.handle("menu:action", (_, action) => {
  const webContents = window?.webContents;
  if (!webContents) return;
  if (action === "quit") app.quit();
  else if (action === "reload") webContents.reload();
  else if (action === "zoomIn") webContents.setZoomLevel(webContents.getZoomLevel() + 0.5);
  else if (action === "zoomOut") webContents.setZoomLevel(webContents.getZoomLevel() - 0.5);
  else if (action === "resetZoom") webContents.setZoomLevel(0);
  else if (action === "about") {
    dialog.showMessageBox(window, {
      type: "info",
      title: "FindInside 정보",
      message: "FindInside",
      detail: `버전 ${app.getVersion()}\n파일명, 폴더명과 경로를 빠르게 검색하는 PC 앱입니다.`
    });
  }
});
