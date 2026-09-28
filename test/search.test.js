"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenize, isInScope, searchEntries } = require("../src/search");

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

test("검색 범위로 지정한 드라이브·폴더 안의 항목만 반환한다", () => {
  assert.deepEqual(searchEntries(entries, "서버", { scopes: ["C:\\"] }), []);
  const results = searchEntries(entries, "업무", { scopes: ["d:\\업무\\Project-A\\"] });
  assert.deepEqual(results.map((item) => item.name), ["설치정보.xlsx"]);
});

test("폴더 이름이 앞부분만 같은 다른 폴더는 범위에 넣지 않는다", () => {
  assert.equal(isInScope("D:\\업무2\\a.txt", "D:\\업무"), false);
  assert.equal(isInScope("D:\\업무\\a.txt", "D:\\업무"), true);
  assert.equal(isInScope("D:\\업무", "D:\\업무"), true);
});

test("여러 범위 중 하나에만 있어도 결과에 포함한다", () => {
  const results = searchEntries(entries, "x", { scopes: ["C:\\문서", "D:\\업무\\Project-A"] });
  assert.deepEqual(results.map((item) => item.name).sort(), ["설치정보.xlsx", "회의록.docx"]);
});

test("종류와 확장자 조건으로 결과를 좁힌다", () => {
  assert.deepEqual(searchEntries(entries, "업무", { kind: "folder" }).map((item) => item.name), ["서버 구성"]);
  assert.deepEqual(searchEntries(entries, "d", { extensions: [".XLSX"] }).map((item) => item.name), ["설치정보.xlsx"]);
});

test("조건을 먼저 적용하므로 상한에 걸려 범위 안 결과가 빠지지 않는다", () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `보고서${i}.txt`, path: `C:\\보고서${i}.txt`, kind: "file", extension: "txt" }));
  const target = { name: "보고서.hwp", path: "D:\\업무\\보고서.hwp", kind: "file", extension: "hwp" };
  const results = searchEntries([...many, target], "보고서", { scopes: ["D:\\업무"] });
  assert.deepEqual(results.map((item) => item.name), ["보고서.hwp"]);
});
