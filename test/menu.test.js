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
  assert.match(mainSource, /autoHideMenuBar: true/);
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
