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
  openAt: (targetPath, phrase, target, term) => ipcRenderer.invoke("item:openAt", targetPath, phrase, target, term),
  readText: (targetPath) => ipcRenderer.invoke("item:readText", targetPath),
  warmHwp: () => ipcRenderer.invoke("goto:warm"),
  // 확인 창 (브라우저 confirm()은 닫힌 뒤 입력 칸이 막히는 Electron 문제가 있어 쓰지 않는다)
  confirm: (message) => ipcRenderer.invoke("ui:confirm", message),
  mailAccounts: () => ipcRenderer.invoke("mail:accounts"),
  testMail: (account, password) => ipcRenderer.invoke("mail:test", account, password),
  saveMail: (account, password) => ipcRenderer.invoke("mail:save", account, password),
  removeMail: (accountId) => ipcRenderer.invoke("mail:remove", accountId),
  syncMail: () => ipcRenderer.invoke("mail:sync"),
  mailFolders: () => ipcRenderer.invoke("mail:folders"),
  openMail: (mailUri) => ipcRenderer.invoke("mail:open", mailUri),
  viewMail: (ref) => ipcRenderer.invoke("mail:view", ref),
  openMailFile: (file, how) => ipcRenderer.invoke("mail:openFile", file, how),
  saveAttachment: (file, name) => ipcRenderer.invoke("mail:saveAttachment", file, name),
  openExternal: (url) => ipcRenderer.invoke("ui:openExternal", url),
  onMailProgress: (callback) => ipcRenderer.on("mail:progress", (_, value) => callback(value)),
  runMenuAction: (action) => ipcRenderer.invoke("menu:action", action),
  licenseStatus: () => ipcRenderer.invoke("license:status"),
  activateLicense: (key) => ipcRenderer.invoke("license:activate", key),
  deactivateLicense: () => ipcRenderer.invoke("license:deactivate"),
  checkLicense: () => ipcRenderer.invoke("license:check"),
  buyLicense: () => ipcRenderer.invoke("license:buy"),
  onLicenseChanged: (callback) => ipcRenderer.on("license:changed", (_, value) => callback(value)),
  openLegal: (name) => ipcRenderer.invoke("legal:open", name),
  onIndexProgress: (callback) => ipcRenderer.on("index:progress", (_, value) => callback(value)),
  onIndexDone: (callback) => ipcRenderer.on("index:done", (_, value) => callback(value)),
  onIndexChanged: (callback) => ipcRenderer.on("index:changed", (_, value) => callback(value))
});
