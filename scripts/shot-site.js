"use strict";

// 판매 페이지(site/index.html)를 넓은 화면·휴대폰 폭으로 찍어 확인한다.
// 실행: npx electron scripts/shot-site.js <저장 폴더>
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2] || path.join(__dirname, "..", "release");
const page = path.join(__dirname, "..", "site", "index.html");

// 창 하나로 폭만 바꿔 찍는다 (창을 여러 번 새로 만들면 두 번째 불러오기가 실패한다)
let win;
async function shot(width, height, name) {
  if (!win) {
    win = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true } });
    await win.loadFile(page);
  }
  win.setContentSize(width, height);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const full = await win.webContents.executeJavaScript("document.documentElement.scrollHeight");
  win.setContentSize(width, Math.min(full, 8000));
  await new Promise((resolve) => setTimeout(resolve, 600));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, name), image.toPNG());
  const overflow = await win.webContents.executeJavaScript("document.documentElement.scrollWidth > window.innerWidth");
  console.log(name, `${width}x${full}`, overflow ? "가로 넘침!" : "가로 넘침 없음");
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  await shot(1440, 900, "site-desktop.png");
  await shot(390, 844, "site-mobile.png");
  app.quit();
});
