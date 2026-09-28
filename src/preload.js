"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("findInside", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  getState: () => ipcRenderer.invoke("state:get"),
  setRoots: (roots) => ipcRenderer.invoke("roots:set", roots),
  setExcludedPaths: (excludedPaths) => ipcRenderer.invoke("excludes:set", excludedPaths),
  rebuildIndex: () => ipcRenderer.invoke("index:rebuild"),
  search: (query, filters) => ipcRenderer.invoke("search:run", query, filters),
  openItem: (targetPath) => ipcRenderer.invoke("item:open", targetPath),
  showInFolder: (targetPath) => ipcRenderer.invoke("item:show", targetPath),
  openAt: (targetPath, phrase) => ipcRenderer.invoke("item:openAt", targetPath, phrase),
  mailAccounts: () => ipcRenderer.invoke("mail:accounts"),
  testMail: (account, password) => ipcRenderer.invoke("mail:test", account, password),
  saveMail: (account, password) => ipcRenderer.invoke("mail:save", account, password),
  removeMail: (accountId) => ipcRenderer.invoke("mail:remove", accountId),
  syncMail: () => ipcRenderer.invoke("mail:sync"),
  openMail: (mailUri) => ipcRenderer.invoke("mail:open", mailUri),
  onMailProgress: (callback) => ipcRenderer.on("mail:progress", (_, value) => callback(value)),
  runMenuAction: (action) => ipcRenderer.invoke("menu:action", action),
  onIndexProgress: (callback) => ipcRenderer.on("index:progress", (_, value) => callback(value)),
  onIndexDone: (callback) => ipcRenderer.on("index:done", (_, value) => callback(value)),
  onIndexChanged: (callback) => ipcRenderer.on("index:changed", (_, value) => callback(value))
});
