"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { indexRoots } = require("./indexer");
const { searchEntries, tokenize, prepareEntries } = require("./search");
const { Worker } = require("node:worker_threads");
const { openContentIndex, searchContent, contentStats } = require("./contentIndex");
const { SUPPORTED_EXTENSIONS } = require("./extract");

let window;
let contentDb;
let state = { roots: [], excludedPaths: [], entries: [], errors: [], indexedAt: null };

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

function stateFile() {
  return path.join(app.getPath("userData"), "findinside-index.json");
}

async function loadState() {
  try {
    state = JSON.parse(await fs.readFile(stateFile(), "utf8"));
  } catch {
    state = { roots: [], excludedPaths: [], entries: [], errors: [], indexedAt: null };
  }
}

async function saveState() {
  await fs.mkdir(path.dirname(stateFile()), { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify(state), "utf8");
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: "FindInside",
    autoHideMenuBar: true,
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
    if (state.entries.length) runIndexing(refreshContent).catch(() => {});
  });
}

app.whenReady().then(async () => {
  await loadState();
  prepareEntries(state.entries);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  contentDb = openContentIndex(contentDbPath());
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

ipcMain.handle("state:get", () => ({
  roots: state.roots,
  excludedPaths: state.excludedPaths,
  indexedAt: state.indexedAt,
  entryCount: state.entries.length,
  errorCount: state.errors.length,
  indexing: Boolean(indexing),
  content: contentDb ? contentStats(contentDb) : {}
}));

ipcMain.handle("roots:set", async (_, roots) => {
  state.roots = [...new Set(roots.map((item) => path.resolve(item)))];
  await saveState();
  return state.roots;
});

ipcMain.handle("excludes:set", async (_, excludedPaths) => {
  state.excludedPaths = [...new Set(excludedPaths.map((item) => path.resolve(item)))];
  await saveState();
  return state.excludedPaths;
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
  return { entryCount: state.entries.length, errorCount: state.errors.length, indexedAt: state.indexedAt, content };
}

function contentDbPath() {
  return path.join(app.getPath("userData"), "findinside-content.db");
}

// 내용 추출은 worker 스레드에서 돌려 창 입력이 멈추지 않게 한다.
// 전체 목록(수백만 개)을 넘기면 복사 비용이 커서, 내용 색인 대상 파일만 골라 넘긴다.
function indexContentInWorker(entries) {
  const targets = entries
    .filter((entry) => entry.kind === "file" && SUPPORTED_EXTENSIONS.has(entry.extension))
    .map(({ name, path: filePath, kind, extension }) => ({ name, path: filePath, kind, extension }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "contentWorker.js"), { workerData: { dbPath: contentDbPath() } });
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
async function refreshContent() {
  return indexSummary(await indexContentInWorker(state.entries));
}

async function rebuildIndex() {
  const result = await indexRoots(state.roots, {
    excludedPaths: state.excludedPaths,
    onProgress: (progress) => window?.webContents.send("index:progress", progress)
  });
  state = { ...state, ...result };
  prepareEntries(state.entries);
  await saveState();
  return indexSummary(await indexContentInWorker(state.entries));
}

ipcMain.handle("search:run", (_, query, filters) => {
  const contentMatches = contentDb ? searchContent(contentDb, tokenize(query)) : new Map();
  return searchEntries(state.entries, query, filters || {}, 200, contentMatches);
});
ipcMain.handle("item:open", (_, targetPath) => shell.openPath(targetPath));
ipcMain.handle("item:show", (_, targetPath) => shell.showItemInFolder(targetPath));
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
