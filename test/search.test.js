"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenize, searchEntries } = require("../src/search");

const entries = [
  { name: "설치정보.xlsx", path: "D:\\업무\\Project-A\\설치정보.xlsx", kind: "file", extension: "xlsx" },
  { name: "서버 구성", path: "D:\\업무\\서버 구성", kind: "folder", extension: "" },
  { name: "회의록.docx", path: "C:\\문서\\회의록.docx", kind: "file", extension: "docx" }
];

test("따옴표 검색어를 하나의 토큰으로 처리한다", () => {
  assert.deepEqual(tokenize('서버 "설치 정보"'), ["서버", "설치 정보"]);
});

test("여러 검색어가 모두 포함된 항목만 반환한다", () => {
  const results = searchEntries(entries, "업무 설치정보");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "설치정보.xlsx");
});

test("파일명 일치를 경로 일치보다 우선한다", () => {
  const results = searchEntries(entries, "서버");
  assert.equal(results[0].name, "서버 구성");
});
