"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { indexRoots } = require("./indexer");
const { searchEntries } = require("./search");

let window;
let state = { roots: [], excludedPaths: [], entries: [], errors: [], indexedAt: null };

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
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  await loadState();
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
