"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { indexRoots } = require("./indexer");
const { searchEntries } = require("./search");

let window;
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
}

app.whenReady().then(async () => {
  await loadState();
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
  indexedAt: state.indexedAt,
  entryCount: state.entries.length,
  errorCount: state.errors.length
}));

ipcMain.handle("roots:set", async (_, roots) => {
  state.roots = [...new Set(roots.map((item) => path.resolve(item)))];
  await saveState();
  return state.roots;
});

ipcMain.handle("index:rebuild", async () => {
  const result = await indexRoots(state.roots, {
    excludedPaths: state.excludedPaths,
    onProgress: (progress) => window?.webContents.send("index:progress", progress)
  });
  state = { ...state, ...result };
  await saveState();
  return { entryCount: state.entries.length, errorCount: state.errors.length, indexedAt: state.indexedAt };
});

ipcMain.handle("search:run", (_, query) => searchEntries(state.entries, query));
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
