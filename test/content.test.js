"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { toTokens, needsScan, toMatchPhrase } = require("../src/tokens");
const { extractFile } = require("../src/extract");
const { openContentIndex, indexContent, searchContent } = require("../src/contentIndex");
const { searchEntries, tokenize } = require("../src/search");

// 테스트용 최소 ZIP 작성기 (DEFLATE)
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const data = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "findinside-"));
}

test("한국어는 2글자 단위, 영문·숫자는 단어 단위로 토큰을 만든다", () => {
  assert.deepEqual(toTokens("서버구축 WEB01 10.0.3.21"), ["서버", "버구", "구축", "web01", "10", "0", "3", "21"]);
  assert.equal(toMatchPhrase("서버의"), '"서버 버의"');
  assert.equal(needsScan("사"), true);
  assert.equal(needsScan("서버"), false);
});

test("DOCX·PPTX·XLSX·HWPX에서 텍스트와 내부 위치를 추출한다", async () => {
  const dir = await tempDir();
  const docx = path.join(dir, "a.docx");
  await fs.writeFile(docx, makeZip({
    "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>운영 서버 목록</w:t></w:r></w:p><w:p><w:r><w:t xml:space=\"preserve\">IP &amp; 사양</w:t></w:r></w:p></w:body></w:document>"
  }));
  const pptx = path.join(dir, "b.pptx");
  await fs.writeFile(pptx, makeZip({
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>둘째 장 견적</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>표지</a:t></a:r></a:p></p:sld>"
  }));
  const xlsx = path.join(dir, "c.xlsx");
  await fs.writeFile(xlsx, makeZip({
    "xl/workbook.xml": "<workbook><sheets><sheet name=\"서버\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
    "xl/sharedStrings.xml": "<sst><si><t>WEB SERVER</t></si><si><r><t>CPU</t></r><r><t> 8core</t></r></si></sst>",
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row r=\"4\"><c r=\"B4\" t=\"s\"><v>0</v></c><c r=\"C4\" t=\"s\"><v>1</v></c><c r=\"D4\"><v>64</v></c></row></sheetData></worksheet>"
  }));
  const hwpx = path.join(dir, "d.hwpx");
  await fs.writeFile(hwpx, makeZip({
    "Contents/section0.xml": "<hs:sec><hp:p id=\"1\"><hp:run><hp:t>설치 정보</hp:t></hp:run></hp:p></hs:sec>"
  }));

  assert.deepEqual(await extractFile(docx), [{ location: { paragraph: 1 }, text: "운영 서버 목록\nIP & 사양" }]);
  assert.deepEqual(await extractFile(pptx), [
    { location: { slide: 1 }, text: "표지" },
    { location: { slide: 2 }, text: "둘째 장 견적" }
  ]);
  assert.deepEqual(await extractFile(xlsx), [{ location: { sheet: "서버", cell: "B4" }, text: "WEB SERVER | CPU 8core | 64" }]);
  assert.deepEqual(await extractFile(hwpx), [{ location: { section: 1, paragraph: 1 }, text: "설치 정보" }]);
});

function hwpRecord(tag, data) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE((data.length << 20) | tag, 0);
  return Buffer.concat([header, data]);
}

test("HWP 5.0 본문 문단과 위치를 추출하고 제어 문자는 건너뛴다", async () => {
  const CFB = require("cfb");
  const fileHeader = Buffer.alloc(256);
  fileHeader.write("HWP Document File", 0, "latin1");
  fileHeader.writeUInt32LE(0x1, 36); // 압축됨
  // 확장 제어 문자(2, 8글자 차지) 뒤에 본문, 그리고 문단 끝(13)
  const control = Buffer.alloc(16);
  control.writeUInt16LE(2, 0);
  const text = Buffer.concat([control, Buffer.from("장비 설치 확인", "utf16le"), Buffer.from([13, 0])]);
  const section = Buffer.concat([hwpRecord(66, Buffer.alloc(8)), hwpRecord(67, text), hwpRecord(67, Buffer.from("둘째 문단", "utf16le"))]);

  const doc = CFB.utils.cfb_new();
  CFB.utils.cfb_add(doc, "/FileHeader", fileHeader);
  CFB.utils.cfb_add(doc, "/BodyText/Section0", zlib.deflateRawSync(section));
  const dir = await tempDir();
  const file = path.join(dir, "확인서.hwp");
  await fs.writeFile(file, CFB.write(doc, { type: "buffer" }));

  assert.deepEqual(await extractFile(file), [{ location: { section: 1, paragraph: 1 }, text: "장비 설치 확인\n둘째 문단" }]);
});

test("CP949로 저장된 한국어 텍스트 파일을 읽는다", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "memo.txt");
  // "서버" (CP949: BC AD B9 F6)
  await fs.writeFile(file, Buffer.from([0xbc, 0xad, 0xb9, 0xf6]));
  assert.equal((await extractFile(file))[0].text, "서버");
});

test("파일 내용으로 검색하고, 변경되지 않은 파일은 다시 추출하지 않는다", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "설치정보.txt");
  await fs.writeFile(file, "시스템 개요\nWEB01 운영서버의 IP는 10.0.3.21 입니다\n");
  const other = path.join(dir, "메모.txt");
  await fs.writeFile(other, "점심 메뉴");
  const entries = [
    { name: "설치정보.txt", path: file, kind: "file", extension: "txt" },
    { name: "메모.txt", path: other, kind: "file", extension: "txt" }
  ];
  const db = openContentIndex(":memory:");

  const first = await indexContent(db, entries);
  assert.equal(first.extracted, 2);
  const second = await indexContent(db, entries);
  assert.equal(second.skipped, 2);

  const query = "서버 10.0.3.21";
  const results = searchEntries(entries, query, {}, 200, searchContent(db, tokenize(query)));
  assert.deepEqual(results.map((item) => item.name), ["설치정보.txt"]);
  assert.deepEqual(results[0].matchedIn, ["content"]);
  assert.equal(results[0].hits[0].location, "1번째 줄");
  assert.equal(results[0].hits[0].snippet.match, "서버");

  // 검색 범위 조건은 내용 검색 결과에도 적용된다
  assert.deepEqual(searchEntries(entries, "서버", { scopes: ["Z:\\다른곳"] }, 200, searchContent(db, ["서버"])), []);
});

test("이름 색인에서 사라진 파일은 내용 색인에서도 지운다", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "a.txt");
  await fs.writeFile(file, "견적서 내용");
  const db = openContentIndex(":memory:");
  await indexContent(db, [{ name: "a.txt", path: file, kind: "file", extension: "txt" }]);
  assert.equal(searchContent(db, ["견적"]).size, 1);
  await indexContent(db, []);
  assert.equal(searchContent(db, ["견적"]).size, 0);
});

test("한 글자 검색어는 색인 대신 본문을 훑어 찾는다", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "a.txt");
  await fs.writeFile(file, "사과 주문");
  const db = openContentIndex(":memory:");
  await indexContent(db, [{ name: "a.txt", path: file, kind: "file", extension: "txt" }]);
  assert.equal(searchContent(db, ["과"]).size, 1);
});
