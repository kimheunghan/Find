"use strict";

// Lemon Squeezy 상품 이미지(1600×1200)를 만든다: site/product-image.html을 그려 PNG로 저장.
// 창 크기는 화면 크기·배율에 묶이므로, 개발자 도구 프로토콜로 화면 크기를 1600×1200·배율 1로 고정해 찍는다.
// 실행: npx electron scripts/product-image.js <저장 경로.png>
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2] || path.join(__dirname, "..", "release", "findinside-product.png");

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, "..", "site", "product-image.html"));
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1600, height: 1200, scale: 1 } });
  fs.writeFileSync(out, Buffer.from(data, "base64"));
  console.log("상품 이미지:", out);
  app.quit();
});
