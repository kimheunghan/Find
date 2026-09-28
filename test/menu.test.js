"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("상단 애플리케이션 메뉴가 한국어로 정의되어 있다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  for (const label of ["파일", "편집", "보기", "창", "도움말"]) {
    assert.match(source, new RegExp(`label: \\\"${label}\\\"`));
  }
});

test("Electron 기본 메뉴를 숨기고 앱 내부 한국어 메뉴를 사용한다", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  // Alt(한/영 키)를 메뉴 막대가 가로채지 않도록 autoHideMenuBar는 끈다
  assert.match(mainSource, /autoHideMenuBar: false/);
  assert.match(mainSource, /setMenuBarVisibility\(false\)/);
  assert.match(mainSource, /Menu\.setApplicationMenu\(null\)/);
  for (const label of ["파일", "편집", "보기", "도움말"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

test("상세 조건 내부 조작은 패널을 닫지 않고 선택 범위는 x로만 제거한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8");
  assert.match(source, /event\.composedPath\(\)/);
  assert.match(source, /path\.includes\(filterPanelEl\)/);
  assert.match(source, /path\.includes\(filterBarEl\)/);
  assert.match(source, /검색 범위에서 제거/);
  assert.match(source, /event\.stopPropagation\(\)/);
});

test("파일 형식 목록에 일반 문서와 이미지 확장자가 포함된다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  for (const extension of ["hwp", "pdf", "xlsx", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]) {
    assert.match(html, new RegExp(`value=\\"${extension}\\"`));
  }
});

test("이미지 형식은 실제 OCR 본문 색인 대상으로 등록된다", () => {
  const { IMAGE_EXTENSIONS, SUPPORTED_EXTENSIONS, describeLocation } = require("../src/extract");
  for (const extension of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]) {
    assert.equal(IMAGE_EXTENSIONS.has(extension), true);
    assert.equal(SUPPORTED_EXTENSIONS.has(extension), true);
  }
  assert.equal(describeLocation({ ocr: true, line: 3 }), "이미지 OCR 3번째 줄");
});

test("검색어는 본문뿐 아니라 제목과 경로에서도 강조된다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8");
  assert.match(source, /renderHighlighted\(row\.querySelector\("\.name"\), item\.name, terms\)/);
  assert.match(source, /renderHighlighted\(row\.querySelector\("\.path"\), item\.path, terms\)/);
});
