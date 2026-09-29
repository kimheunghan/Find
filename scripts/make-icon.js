"use strict";

// 앱 아이콘을 만든다: build/icon.ico(설치 파일·exe), src/renderer/icon.png(창), web/icon.png(판매 페이지).
// Electron으로 SVG를 그려 PNG로 받고, 여러 크기의 PNG를 ICO 한 파일에 담는다.
// 실행: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// 파란 둥근 사각형 위에 문서와 돋보기 (앱 안의 파란 "F" 로고와 같은 색)
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6f8cff"/><stop offset="1" stop-color="#3552d6"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>
  <path d="M68 44h78l42 42v116a12 12 0 0 1-12 12H68a12 12 0 0 1-12-12V56a12 12 0 0 1 12-12z" fill="#ffffff"/>
  <path d="M146 44v30a12 12 0 0 0 12 12h30z" fill="#c9d4ff"/>
  <rect x="78" y="100" width="72" height="10" rx="5" fill="#9fb0ee"/>
  <rect x="78" y="124" width="52" height="10" rx="5" fill="#9fb0ee"/>
  <rect x="78" y="148" width="40" height="10" rx="5" fill="#9fb0ee"/>
  <circle cx="160" cy="160" r="38" fill="#ffd166" fill-opacity=".25" stroke="#1f2f7a" stroke-width="14"/>
  <path d="M187 187l30 30" stroke="#1f2f7a" stroke-width="18" stroke-linecap="round"/>
</svg>`;

// 512px로 한 번 그린 뒤 크기별로 줄인다 (작은 창을 여러 번 띄우면 불러오기가 실패한다)
// 창을 새로 여러 번 만들면 두 번째부터 불러오기가 실패하므로 창 하나를 계속 쓴다
let sharedWindow;
async function renderBase() {
  const size = 512;
  const win = sharedWindow = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg(size)}</body></html>`)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return image;
}

// 넓은 타일: 투명 바탕 가운데에 아이콘 (창 크기가 화면에 묶이지 않게 개발자 도구 프로토콜로 크기 고정)
async function renderWide(width, height) {
  const icon = Math.round(height * 0.8);
  const win = sharedWindow;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden;display:grid;place-items:center;width:${width}px;height:${height}px">${svg(icon)}</body></html>`)}`);
  const cdp = win.webContents.debugger;
  if (!cdp.isAttached()) cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.sendCommand("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
  return Buffer.from(data, "base64");
}

// ICO: 헤더 + 크기별 항목 + PNG 데이터 (Windows Vista 이후 PNG 항목을 지원)
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((item) => item.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const base = await renderBase();
  const pngs = SIZES.map((size) => ({ size, data: base.resize({ width: size, height: size, quality: "best" }).toPNG() }));
  const large = base.resize({ width: 512, height: 512 }).toPNG();
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  fs.writeFileSync(path.join(root, "build", "icon.ico"), ico(pngs));
  fs.writeFileSync(path.join(root, "build", "icon.png"), large);
  fs.writeFileSync(path.join(root, "src", "renderer", "icon.png"), pngs.find((item) => item.size === 256).data);
  fs.mkdirSync(path.join(root, "web"), { recursive: true });
  fs.writeFileSync(path.join(root, "web", "icon.png"), pngs.find((item) => item.size === 256).data);
  console.log("아이콘:", SIZES.join(", "), "px → build/icon.ico, build/icon.png, src/renderer/icon.png, web/icon.png");

  // Microsoft Store(MSIX) 타일·로고: build/appx/ (electron-builder가 패키지의 assets로 넣는다)
  // 기본 크기와 고해상도 화면용 2배(scale-200)를 함께 만든다. 넓은 타일은 투명 바탕 가운데에 아이콘.
  const appxDir = path.join(root, "build", "appx");
  fs.mkdirSync(appxDir, { recursive: true });
  const squares = { StoreLogo: 50, Square44x44Logo: 44, Square150x150Logo: 150 };
  for (const [name, size] of Object.entries(squares)) {
    fs.writeFileSync(path.join(appxDir, `${name}.png`), base.resize({ width: size, height: size, quality: "best" }).toPNG());
    fs.writeFileSync(path.join(appxDir, `${name}.scale-200.png`), base.resize({ width: size * 2, height: size * 2, quality: "best" }).toPNG());
  }
  for (const scale of [1, 2]) {
    const wide = await renderWide(310 * scale, 150 * scale);
    fs.writeFileSync(path.join(appxDir, scale === 1 ? "Wide310x150Logo.png" : "Wide310x150Logo.scale-200.png"), wide);
  }
  console.log("스토어 타일:", fs.readdirSync(appxDir).join(", "));
  app.quit();
});
