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
