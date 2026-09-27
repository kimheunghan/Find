"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("findInside", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  getState: () => ipcRenderer.invoke("state:get"),
  setRoots: (roots) => ipcRenderer.invoke("roots:set", roots),
  rebuildIndex: () => ipcRenderer.invoke("index:rebuild"),
  search: (query) => ipcRenderer.invoke("search:run", query),
  openItem: (targetPath) => ipcRenderer.invoke("item:open", targetPath),
  showInFolder: (targetPath) => ipcRenderer.invoke("item:show", targetPath),
  onIndexProgress: (callback) => ipcRenderer.on("index:progress", (_, value) => callback(value))
});
