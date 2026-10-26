"use strict";

// 띄어쓰기·오탈자가 달라도 찾는지 (2026-10-26)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { tokenize, searchEntries } = require("../src/search");
const { openContentIndex, indexContent, searchContent, searchContentFuzzy } = require("../src/contentIndex");
const { syllableVariants, wordVariants, prepareFuzzy, fuzzyContains } = require("../src/fuzzy");
const { findRanges } = require("../src/renderer/highlight");

async function indexTexts(texts) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-"));
  const entries = [];
  for (const [name, text] of Object.entries(texts)) {
    const file = path.join(dir, name);
    await fs.writeFile(file, text);
    entries.push({ name, path: file, kind: "file", extension: "txt" });
  }
  const db = openContentIndex(":memory:");
  await indexContent(db, entries);
  return { db, entries, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

const names = (results) => results.map((item) => item.name).sort();

test("붙여 쓴 검색어로 본문에 띄어 쓴 말을 찾고, 띄어 쓴 검색어로 붙여 쓴 말도 찾는다", async (t) => {
  const { db, entries, cleanup } = await indexTexts({ "a.txt": "서버 설치 정보 정리", "b.txt": "서버 설치정보 정리", "c.txt": "보고 서 제출" });
  t.after(cleanup);
  const search = (query) => names(searchEntries(entries, query, {}, 200, searchContent(db, tokenize(query))));
  assert.deepEqual(search("설치정보"), ["a.txt", "b.txt"]);
  assert.deepEqual(search('"설치 정보"'), ["a.txt", "b.txt"]);
  assert.deepEqual(search("보고서"), ["c.txt"]);
});

test("붙여 쓴 검색어로 이름에 띄어 쓰거나 밑줄로 이은 파일도 찾는다", () => {
  const entries = [
    { name: "설치 정보.xlsx", path: "D:\\자료\\설치 정보.xlsx", kind: "file", extension: "xlsx" },
    { name: "설치_정보.docx", path: "D:\\자료\\설치_정보.docx", kind: "file", extension: "docx" },
    { name: "설치정보.hwp", path: "D:\\자료\\설치정보.hwp", kind: "file", extension: "hwp" },
    { name: "정보 설치.txt", path: "D:\\자료\\정보 설치.txt", kind: "file", extension: "txt" }
  ];
  assert.deepEqual(names(searchEntries(entries, "설치정보")), ["설치 정보.xlsx", "설치_정보.docx", "설치정보.hwp"]);
  assert.deepEqual(names(searchEntries(entries, '"설치 정보"')), ["설치 정보.xlsx", "설치_정보.docx", "설치정보.hwp"]);
});

test("미리보기 강조도 띄어쓰기가 달라도 일치로 본다", () => {
  assert.deepEqual(findRanges("서버 설치 정보 문서", ["설치정보"]), [[3, 8]]);
  assert.deepEqual(findRanges("설치정보", ["설치 정보"]), [[0, 4]]);
});

test("자모 하나, 영문 한 글자만 다른 말을 만든다", () => {
  assert.ok(syllableVariants("젹").includes("적"));
  assert.ok(syllableVariants("로").includes("록"), "받침이 빠진 것");
  assert.equal(syllableVariants("가").length, 65);
  assert.ok(wordVariants("reprot").includes("report"), "이웃한 두 글자 자리 바뀜");
  assert.ok(wordVariants("instal").includes("install"), "빠진 글자");
});

test("파일 이름: 오탈자 검색은 켰을 때만, 정확히 일치한 것 뒤에 나온다", () => {
  const entries = [
    { name: "견적서_2025.xlsx", path: "D:\\견적서_2025.xlsx", kind: "file", extension: "xlsx" },
    { name: "견젹서 메모.txt", path: "D:\\견젹서 메모.txt", kind: "file", extension: "txt" },
    { name: "회의록.docx", path: "D:\\회의록.docx", kind: "file", extension: "docx" }
  ];
  assert.deepEqual(searchEntries(entries, "견젹서").map((item) => item.name), ["견젹서 메모.txt"]);
  const widened = searchEntries(entries, "견젹서", { fuzzy: true });
  assert.deepEqual(widened.map((item) => [item.name, Boolean(item.fuzzy)]), [["견젹서 메모.txt", false], ["견적서_2025.xlsx", true]]);
  assert.deepEqual(searchEntries(entries, "회의룩", { fuzzy: true }).map((item) => item.name), ["회의록.docx"]);
  // 짧은 검색어는 오탈자 검색을 하지 않는다 (엉뚱한 결과가 너무 많아진다)
  assert.equal(prepareFuzzy("회"), null);
  assert.equal(prepareFuzzy("abc"), null);
  assert.equal(fuzzyContains("quarterly reprot.pdf", prepareFuzzy("report")), true);
  assert.equal(fuzzyContains("quarterly summary.pdf", prepareFuzzy("report")), false);
});

test("파일 내용: 오탈자 검색은 색인에 있는 말로 고쳐 찾는다", async (t) => {
  const { db, entries, cleanup } = await indexTexts({ "a.txt": "올해 견적서 첨부합니다", "b.txt": "quarterly report attached", "c.txt": "점심 메뉴" });
  t.after(cleanup);
  assert.equal(searchContent(db, ["견젹서"]).size, 0);
  const korean = searchContentFuzzy(db, ["견젹서"]);
  assert.deepEqual([...korean.keys()].map((file) => path.basename(file)), ["a.txt"]);
  const match = korean.values().next().value;
  assert.ok(match.fuzzyTerms.has("견젹서"));
  assert.equal(match.hits[0].snippet.match, "견적서", "미리보기에는 고친 말을 강조");
  const english = searchContentFuzzy(db, ["reprot"]);
  assert.deepEqual([...english.keys()].map((file) => path.basename(file)), ["b.txt"]);
  // 화면 결과: 오탈자로 찾은 파일에는 fuzzy 표시
  const results = searchEntries(entries, "견젹서", { fuzzy: true }, 200, korean);
  assert.deepEqual(results.map((item) => [item.name, item.fuzzy]), [["a.txt", true]]);
});

test("영문·숫자 한 글자는 내용에서 찾지 않는다 (거의 모든 문서에 있어 수십 초 걸린다)", async (t) => {
  const { db, cleanup } = await indexTexts({ "a.txt": "a b c 1 2 3" });
  t.after(cleanup);
  assert.equal(searchContent(db, ["a"]).size, 0);
  assert.equal(searchContent(db, ["1"]).size, 0);
});

test("한글 두 글자 검색어는 오탈자 검색을 하지 않는다 (\"보고\"가 \"정보 모음\"에 걸리던 문제)", () => {
  const entries = [{ name: "설치 정보 모음", path: "D:\설치 정보 모음", kind: "folder", extension: "" }];
  assert.equal(prepareFuzzy("보고"), null);
  assert.deepEqual(searchEntries(entries, "보고", { fuzzy: true }), []);
});
