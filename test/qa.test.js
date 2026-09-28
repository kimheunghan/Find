"use strict";

// 검색 전수 검수: 한글 1·2글자/긴 단어, 띄어쓰기·특수문자, 영문·숫자·한영 혼합,
// 제목·경로·본문, 형식별(HWP·PDF·DOCX·XLSX·PPTX·HWPX·TXT), 여러 검색어·따옴표, 누락과 강조 위치.
// (이미지 OCR 본문은 Python OCR이 필요해 scripts/qa-ocr.js 로 따로 검수한다.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { makeDocx, makePptx, makeXlsx, makeHwpx, makeHwp, makePdf } = require("./helpers");
const { openContentIndex, indexContent, searchContent } = require("../src/contentIndex");
const { searchEntries, tokenize } = require("../src/search");
const { displayText, findRanges, termRegex, queryTerms } = require("../src/renderer/highlight");

let entries;
let db;

test.before(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-qa-"));
  const dir = path.join(root, "업무자료");
  const folder = path.join(dir, "설치 자료");
  await fs.mkdir(folder, { recursive: true });
  const files = {
    "장비설치확인서.hwp": makeHwp(["장비 설치 확인서", "운영서버 점검 결과 이상 없음", "서버 사양: CPU 8core / RAM 64GB"]),
    "납품장비_환경정보(IP,계정).xlsx": makeXlsx("서버", [["호스트", "IP", "용도"], ["WEB01", "10.0.3.21", "웹 서버"], ["DB01", "10.0.3.31", "데이터베이스"]]),
    "제안서.pptx": makePptx(["사업 개요", "시스템 구축 방안과 설치정보 관리"]),
    "회의록.docx": makeDocx(["㈜비아이매트릭스 회의록", "견적 사양 검토"]),
    "보고서.hwpx": makeHwpx(["주간 보고", "설치 정보 정리 완료"]),
    "memo.txt": Buffer.from(`${"서버".normalize("NFD")} 교체 요청`, "utf8"),
    "spec.pdf": makePdf(["Project overview", "WEB SERVER spec: 8core CPU"]),
    "서버01_구성도.txt": Buffer.from("네트워크 구성", "utf8")
  };
  for (const [name, data] of Object.entries(files)) await fs.writeFile(path.join(dir, name), data);
  await fs.writeFile(path.join(folder, "readme.txt"), "참고");

  entries = [{ name: "설치 자료", path: folder, kind: "folder", extension: "" }];
  for (const name of [...Object.keys(files)]) {
    entries.push({ name, path: path.join(dir, name), kind: "file", extension: path.extname(name).slice(1).toLowerCase() });
  }
  entries.push({ name: "readme.txt", path: path.join(folder, "readme.txt"), kind: "file", extension: "txt" });
  db = openContentIndex(":memory:");
  const summary = await indexContent(db, entries);
  assert.equal(summary.errors, 0);
});

function find(query, filters = {}) {
  const stats = {};
  const results = searchEntries(entries, query, filters, 200, searchContent(db, tokenize(query)), stats);
  // 모든 결과의 강조를 검사한다: 제목·경로 일치면 제목이나 경로에 강조가 있어야 하고, 본문 일치면 미리보기 강조가 검색어와 일치해야 한다.
  const terms = queryTerms(query);
  for (const item of results) {
    if (item.matchedIn.includes("name")) {
      const marked = findRanges(displayText(item.name), terms).length + findRanges(displayText(item.path), terms).length;
      assert.ok(marked > 0, `${query}: ${item.name} 제목·경로 강조 없음`);
    }
    for (const hit of item.hits) {
      assert.ok(hit.snippet.match, `${query}: ${item.name} ${hit.location} 본문 강조 없음`);
      const matchesTerm = terms.some((term) => {
        const pattern = termRegex(term);
        return pattern && new RegExp(`^(?:${pattern.source})$`, "iu").test(hit.snippet.match);
      });
      assert.ok(matchesTerm, `${query}: ${item.name} 강조 "${hit.snippet.match}"가 검색어와 다름`);
    }
  }
  return Object.assign(results, { total: stats.total });
}

const names = (results) => results.map((item) => item.name).sort();
const byName = (results, name) => results.find((item) => item.name === name);

test("한글 1글자: 제목과 본문에서 찾고 그 글자를 강조한다", () => {
  const results = find("치");
  assert.ok(byName(results, "장비설치확인서.hwp"));
  assert.ok(byName(results, "제안서.pptx"), "본문 '설치정보'의 '치'");
  assert.equal(byName(results, "제안서.pptx").hits[0].snippet.match, "치");
});

test("한글 2글자: 조사·특수문자가 붙은 본문에서도 찾고 강조 위치가 밀리지 않는다", () => {
  const results = find("사양");
  assert.deepEqual(names(results), ["장비설치확인서.hwp", "회의록.docx"]);
  const docx = byName(results, "회의록.docx");
  assert.equal(docx.hits[0].snippet.match, "사양");
  assert.match(docx.hits[0].snippet.before, /견적 $/);
});

test("긴 단어: 제목 일치를 찾고 제목에서 그 단어를 강조한다", () => {
  const results = find("설치확인서");
  assert.equal(results[0].name, "장비설치확인서.hwp");
  const [range] = findRanges(displayText(results[0].name), ["설치확인서"]);
  assert.equal(results[0].name.slice(range[0], range[1]), "설치확인서");
});

test("띄어쓰기: 따옴표 \"설치 정보\"는 띄어 쓴 본문과 붙여 쓴 본문을 모두 찾는다", () => {
  const results = find('"설치 정보"');
  assert.deepEqual(names(results), ["보고서.hwpx", "제안서.pptx"]);
  assert.equal(byName(results, "보고서.hwpx").hits[0].snippet.match, "설치 정보");
  assert.equal(byName(results, "제안서.pptx").hits[0].snippet.match, "설치정보");
});

test("띄어쓰기: 따옴표 없이 두 단어를 쓰면 둘 다 들어 있는 파일만 찾는다", () => {
  assert.deepEqual(names(find("설치 정보")), ["보고서.hwpx", "제안서.pptx"]);
});

test("특수문자: IP 주소는 정확히 찾고 셀 위치를 표시한다", () => {
  const results = find("10.0.3.21");
  assert.deepEqual(names(results), ["납품장비_환경정보(IP,계정).xlsx"]);
  assert.equal(results[0].hits[0].location, "서버 시트 B2", "행의 첫 칸이 아니라 IP가 있는 칸");
  assert.equal(results[0].hits[0].snippet.match, "10.0.3.21");
  assert.deepEqual(names(find("10.0.3.31")), ["납품장비_환경정보(IP,계정).xlsx"]);
  assert.deepEqual(find("10.0.3.99").length, 0);
});

test("특수문자: 괄호·쉼표가 섞인 제목을 찾고 강조한다", () => {
  const results = find("IP,계정");
  assert.deepEqual(names(results), ["납품장비_환경정보(IP,계정).xlsx"]);
});

test("영문: 대소문자를 구분하지 않고, 앞부분만 써도 찾는다", () => {
  assert.deepEqual(names(find("web server")), ["spec.pdf"]);
  assert.equal(byName(find("SERVER"), "spec.pdf").hits[0].location, "2쪽");
  assert.deepEqual(names(find("web")), ["spec.pdf", "납품장비_환경정보(IP,계정).xlsx"]);
  assert.equal(byName(find("web"), "납품장비_환경정보(IP,계정).xlsx").hits[0].snippet.match, "WEB");
});

test("숫자·한영 혼합: 8core, 서버01", () => {
  assert.deepEqual(names(find("8core")), ["spec.pdf", "장비설치확인서.hwp"]);
  const mixed = find("서버01");
  assert.equal(mixed[0].name, "서버01_구성도.txt");
});

test("분리된 한글 자모(NFD)로 저장된 본문도 찾고 강조한다", () => {
  const memo = byName(find("서버"), "memo.txt");
  assert.ok(memo);
  assert.equal(memo.hits[0].snippet.match, "서버");
});

test("여러 검색어: 제목과 본문에 나뉘어 있어도 찾는다", () => {
  const results = find("제안서 설치정보");
  assert.deepEqual(names(results), ["제안서.pptx"]);
  assert.deepEqual(results[0].matchedIn, ["name", "content"]);
});

test("따옴표 구문: 순서가 같은 구문만 찾는다", () => {
  assert.deepEqual(names(find('"운영서버 점검"')), ["장비설치확인서.hwp"]);
  assert.deepEqual(find('"점검 운영서버"').length, 0);
});

test("경로: 폴더 이름으로 폴더와 그 안의 파일을 찾는다", () => {
  assert.deepEqual(names(find('"설치 자료"')), ["readme.txt", "설치 자료"]);
});

test("형식별 본문 위치: HWP·HWPX·DOCX·PPTX·XLSX·PDF·TXT", () => {
  const where = (query, name) => byName(find(query), name)?.hits[0]?.location;
  assert.equal(where("점검", "장비설치확인서.hwp"), "1구역 2번째 문단");
  assert.equal(where("주간", "보고서.hwpx"), "1구역 1번째 문단");
  assert.equal(where("견적", "회의록.docx"), "2번째 문단");
  assert.equal(where("구축", "제안서.pptx"), "슬라이드 2");
  assert.equal(where("데이터베이스", "납품장비_환경정보(IP,계정).xlsx"), "서버 시트 C3");
  assert.equal(where("overview", "spec.pdf"), "1쪽");
  assert.equal(where("네트워크", "서버01_구성도.txt"), "1번째 줄");
});

test("결과 누락: 상한(200개)을 넘으면 전체 개수를 따로 알려 준다", () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ name: `설치${i}.txt`, path: `C:\\x\\설치${i}.txt`, kind: "file", extension: "txt" }));
  const stats = {};
  const results = searchEntries(many, "설치", {}, 200, new Map(), stats);
  assert.equal(results.length, 200);
  assert.equal(stats.total, 250);
});

test("IP·번호는 문장부호까지 그대로 일치해야 한다 (쉼표로 쓴 10,0,3,21은 제외)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-qa-ip-"));
  const csv = path.join(dir, "log.csv");
  await fs.writeFile(csv, "a,10,0,3,21,b\n");
  const ocr = path.join(dir, "ocr.txt");
  await fs.writeFile(ocr, "WEB01IP10.0.3.21");
  const local = [
    { name: "log.csv", path: csv, kind: "file", extension: "csv" },
    { name: "ocr.txt", path: ocr, kind: "file", extension: "txt" }
  ];
  const localDb = openContentIndex(":memory:");
  await indexContent(localDb, local);
  const results = searchEntries(local, "10.0.3.21", {}, 200, searchContent(localDb, tokenize("10.0.3.21")));
  assert.deepEqual(results.map((item) => item.name), ["ocr.txt"]);
  assert.equal(results[0].hits[0].snippet.match, "10.0.3.21");
});

test("결과 누락: 일치하는 조각이 아주 많은 파일이 있어도 다른 파일을 빠뜨리지 않는다", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-qa-many-"));
  const big = path.join(dir, "big.txt");
  await fs.writeFile(big, `${"설치 ".repeat(200)}\n`.repeat(6000));
  const small = path.join(dir, "small.txt");
  await fs.writeFile(small, "장비 설치");
  const local = [
    { name: "big.txt", path: big, kind: "file", extension: "txt" },
    { name: "small.txt", path: small, kind: "file", extension: "txt" }
  ];
  const localDb = openContentIndex(":memory:");
  await indexContent(localDb, local);
  for (const query of ["설치", "치"]) {
    const results = searchEntries(local, query, {}, 200, searchContent(localDb, tokenize(query)));
    assert.deepEqual(results.map((item) => item.name).sort(), ["big.txt", "small.txt"], query);
  }
});

test("한 글자가 섞인 검색어(21세, 3층)는 색인 교집합으로 빠르게 찾고, 붙어 있을 때만 결과로 낸다", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-qa-mixed-"));
  const files = { "a.txt": "아들 홍묵 21세 기록", "b.txt": "21 명이 세 번 모였다", "c.txt": "본관 3층 회의실" };
  const local = [];
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), text);
    local.push({ name, path: path.join(dir, name), kind: "file", extension: "txt" });
  }
  const localDb = openContentIndex(":memory:");
  await indexContent(localDb, local);
  const find21 = searchEntries(local, "21세", {}, 200, searchContent(localDb, tokenize("21세")));
  assert.deepEqual(find21.map((item) => item.name), ["a.txt"], "21과 세가 떨어져 있는 b.txt는 제외");
  assert.equal(find21[0].hits[0].snippet.match, "21세");
  assert.deepEqual(searchEntries(local, "3층", {}, 200, searchContent(localDb, tokenize("3층"))).map((item) => item.name), ["c.txt"]);
});

test("폴더 감시 변경분: 새 파일은 목록에 더하고 지운 파일은 빼며, 바로 검색된다", () => {
  const { updateEntries } = require("../src/search");
  const list = [
    { name: "old.txt", path: "C:\\x\\old.txt", kind: "file", extension: "txt" },
    { name: "keep.txt", path: "C:\\x\\keep.txt", kind: "file", extension: "txt" }
  ];
  searchEntries(list, "keep"); // 정규화 캐시를 먼저 만든다
  updateEntries(list, [{ name: "최삼순.png", path: "C:\\x\\최삼순.png", kind: "file", extension: "png" }], ["C:\\x\\old.txt"]);
  assert.deepEqual(list.map((item) => item.name), ["keep.txt", "최삼순.png"]);
  assert.deepEqual(searchEntries(list, "최삼순").map((item) => item.name), ["최삼순.png"]);
  assert.deepEqual(searchEntries(list, "old"), []);
});

test("두 worker가 같은 DB에 동시에 써도 잠김 오류로 멈추지 않는다", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-qa-lock-"));
  const dbPath = path.join(dir, "content.db");
  const first = openContentIndex(dbPath);
  const second = openContentIndex(dbPath, { migrate: false });
  const makeFiles = async (prefix) => {
    const list = [];
    for (let i = 0; i < 30; i += 1) {
      const file = path.join(dir, `${prefix}${i}.txt`);
      await fs.writeFile(file, `${prefix} 문서 ${i}`);
      list.push({ name: `${prefix}${i}.txt`, path: file, kind: "file", extension: "txt" });
    }
    return list;
  };
  const [a, b] = await Promise.all([makeFiles("가"), makeFiles("나")]);
  const owns = (prefix) => (filePath) => path.basename(filePath).startsWith(prefix);
  const [ra, rb] = await Promise.all([
    indexContent(first, a, { owns: owns("가") }),
    indexContent(second, b, { owns: owns("나") })
  ]);
  assert.equal(ra.extracted + rb.extracted, 60);
  assert.equal(first.prepare("SELECT COUNT(*) AS n FROM files").get().n, 60, "서로의 기록을 지우지 않는다");
});
