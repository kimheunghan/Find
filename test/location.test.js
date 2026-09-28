"use strict";

// 문서 안 위치 표시: HWP·HWPX·DOCX 쪽 번호, PPTX 발표 순서와 시작 번호
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { makeZip } = require("./helpers");
const { extractFile, describeLocation, resolveLocation } = require("../src/extract");

async function write(name, data) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-loc-"));
  const file = path.join(dir, name);
  await fs.writeFile(file, data);
  return file;
}

// 검색어가 있는 곳의 위치 표시
function whereIs(chunks, word) {
  const chunk = chunks.find((item) => item.text.includes(word));
  assert.ok(chunk, `${word} 없음`);
  return describeLocation(resolveLocation(chunk.location, chunk.text.indexOf(word)));
}

function record(tag, level, data) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(((data.length << 20) | (level << 10) | tag) >>> 0, 0);
  return Buffer.concat([header, data]);
}

function lineSeg(vpos, flags = 0x60000) {
  const seg = Buffer.alloc(36);
  seg.writeInt32LE(vpos, 4);
  seg.writeUInt32LE(flags, 32);
  return seg;
}

// 용지 정의: 본문 높이 = 용지 높이 - 위·아래·머리말·꼬리말 여백
function pageDef(bodyHeight) {
  const data = Buffer.alloc(40);
  data.writeUInt32LE(bodyHeight + 4000, 4);
  data.writeUInt32LE(1000, 16);
  data.writeUInt32LE(1000, 20);
  data.writeUInt32LE(1000, 24);
  data.writeUInt32LE(1000, 28);
  return data;
}

function tableHeader(height) {
  const data = Buffer.alloc(40);
  data.writeUInt32LE(0x74626c20, 0); // 'tbl '
  data.writeUInt32LE(height, 20);
  return data;
}

function cellHeader(row, height) {
  const data = Buffer.alloc(34);
  data.writeUInt16LE(row, 10);
  data.writeUInt16LE(1, 14);
  data.writeUInt32LE(height, 20);
  return data;
}

const paraText = (text) => Buffer.concat([Buffer.from(text, "utf16le"), Buffer.from([13, 0])]);

// paragraphs: [{ text, vpos, table: { rowHeight, cells: [칸 글자...] } }]
function makeHwpWithLayout(paragraphs, bodyHeight = 70000) {
  const CFB = require("cfb");
  const fileHeader = Buffer.alloc(256);
  fileHeader.write("HWP Document File", 0, "latin1");
  fileHeader.writeUInt32LE(0x1, 36);
  const records = [record(73, 2, pageDef(bodyHeight))];
  for (const paragraph of paragraphs) {
    records.push(record(66, 0, Buffer.alloc(8)));
    records.push(record(67, 1, paraText(paragraph.text)));
    records.push(record(69, 1, lineSeg(paragraph.vpos)));
    if (paragraph.table) {
      const { rowHeight, cells } = paragraph.table;
      records.push(record(71, 1, tableHeader(rowHeight * cells.length)));
      cells.forEach((cell, row) => {
        records.push(record(72, 2, cellHeader(row, rowHeight)));
        records.push(record(66, 2, Buffer.alloc(8)));
        records.push(record(67, 3, paraText(cell)));
        records.push(record(69, 3, lineSeg(0)));
      });
    }
  }
  const doc = CFB.utils.cfb_new();
  CFB.utils.cfb_add(doc, "/FileHeader", fileHeader);
  CFB.utils.cfb_add(doc, "/BodyText/Section0", zlib.deflateRawSync(Buffer.concat(records)));
  return CFB.write(doc, { type: "buffer" });
}

test("HWP: 줄 위치가 위로 돌아가면 새 쪽, 표 칸은 행 높이로 쪽을 계산하고 여러 쪽 표 뒤 본문도 넘긴다", async () => {
  // 본문 높이 70000. 2쪽 맨 위에서 시작한 표(행 4개 × 30000)는 셋째 행까지 2쪽, 넷째 행은 3쪽.
  const file = await write("a.hwp", makeHwpWithLayout([
    { text: "첫째 쪽 머리말", vpos: 0 },
    { text: "첫째 쪽 끝", vpos: 60000 },
    { text: "둘째 쪽 시작 견적", vpos: 0, table: { rowHeight: 30000, cells: ["첫 행 사양", "둘째 행", "셋째 행 단가", "넷째 행 합계"] } },
    { text: "셋째 쪽 결론", vpos: 60000 }
  ]));
  const chunks = await extractFile(file);
  assert.equal(whereIs(chunks, "머리말"), "1쪽");
  assert.equal(whereIs(chunks, "견적"), "2쪽");
  assert.equal(whereIs(chunks, "사양"), "2쪽");
  assert.equal(whereIs(chunks, "단가"), "2쪽");
  assert.equal(whereIs(chunks, "합계"), "3쪽");
  assert.equal(whereIs(chunks, "결론"), "3쪽", "여러 쪽에 걸친 표 뒤의 본문");
});

test("HWP: 용지 정보가 없으면 표 칸의 쪽을 추정하지 않고 표가 시작하는 쪽만 알린다", async () => {
  const file = await write("b.hwp", makeHwpWithLayout([
    { text: "둘째 줄", vpos: 0, table: { rowHeight: 30000, cells: ["표 안 사양"] } }
  ], 0));
  assert.equal(whereIs(await extractFile(file), "사양"), "1쪽에서 시작하는 표 안");
});

test("HWPX: <hp:lineseg>로 쪽을 세고 표 안 글자는 표가 시작하는 쪽", async () => {
  const p = (text, vertpos, inner = "") => `<hp:p><hp:run><hp:t>${text}</hp:t>${inner}</hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${vertpos}" flags="393216"/></hp:linesegarray></hp:p>`;
  const table = `<hp:tbl><hp:tr><hp:tc><hp:subList>${p("표 안 사양", 0)}</hp:subList></hp:tc></hp:tr></hp:tbl>`;
  const xml = `<hs:sec>${p("첫째 쪽", 0)}${p("첫째 쪽 아래", 50000)}${p("둘째 쪽 견적", 0, table)}</hs:sec>`;
  const file = await write("a.hwpx", makeZip({ "Contents/section0.xml": xml }));
  const chunks = await extractFile(file);
  assert.equal(whereIs(chunks, "아래"), "1쪽");
  assert.equal(whereIs(chunks, "견적"), "2쪽");
  assert.equal(whereIs(chunks, "사양"), "2쪽에서 시작하는 표 안");
});

test("HWPX: 용지·표·칸 높이로 여러 쪽에 걸친 표의 칸 쪽을 계산한다", async () => {
  const line = (vertpos) => `<hp:linesegarray><hp:lineseg textpos="0" vertpos="${vertpos}" flags="393216"/></hp:linesegarray>`;
  const p = (text, vertpos, inner = "") => `<hp:p><hp:run><hp:t>${text}</hp:t>${inner}</hp:run>${line(vertpos)}</hp:p>`;
  const cell = (row, text) => `<hp:tc><hp:subList>${p(text, 0)}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="1000" height="30000"/></hp:tc>`;
  const table = `<hp:tbl rowCnt="4" colCnt="1"><hp:sz width="1000" height="120000"/>${[0, 1, 2, 3].map((row) => `<hp:tr>${cell(row, ["첫 행 사양", "둘째 행", "셋째 행 단가", "넷째 행 합계"][row])}</hp:tr>`).join("")}</hp:tbl>`;
  const secPr = `<hp:secPr><hp:pagePr width="59528" height="74000"><hp:margin left="0" right="0" top="1000" bottom="1000" header="1000" footer="1000"/></hp:pagePr></hp:secPr>`;
  const xml = `<hs:sec>${p("첫 쪽", 0, secPr)}${p("첫 쪽 끝", 60000)}${p("둘째 쪽 견적", 0, table)}${p("셋째 쪽 결론", 60000)}</hs:sec>`;
  const chunks = await extractFile(await write("b.hwpx", makeZip({ "Contents/section0.xml": xml })));
  assert.equal(whereIs(chunks, "견적"), "2쪽");
  assert.equal(whereIs(chunks, "사양"), "2쪽");
  assert.equal(whereIs(chunks, "단가"), "2쪽");
  assert.equal(whereIs(chunks, "합계"), "3쪽");
  assert.equal(whereIs(chunks, "결론"), "3쪽");
});

test("DOCX: Word가 남긴 쪽 넘김 표시(lastRenderedPageBreak)로 쪽을 센다", async () => {
  const p = (text, lead = "") => `<w:p><w:r>${lead}<w:t>${text}</w:t></w:r></w:p>`;
  const xml = `<w:document><w:body>${p("첫 쪽 개요")}${p("둘째 쪽 사양", "<w:lastRenderedPageBreak/>")}${p("둘째 쪽 계속")}${p("셋째 쪽 결론", "<w:br w:type=\"page\"/><w:lastRenderedPageBreak/>")}</w:body></w:document>`;
  const file = await write("a.docx", makeZip({ "word/document.xml": xml }));
  const chunks = await extractFile(file);
  assert.equal(whereIs(chunks, "개요"), "1쪽");
  assert.equal(whereIs(chunks, "사양"), "2쪽");
  assert.equal(whereIs(chunks, "계속"), "2쪽");
  assert.equal(whereIs(chunks, "결론"), "3쪽", "직접 넣은 쪽 나눔과 렌더링 표시를 두 번 세지 않는다");
});

test("PPTX: 슬라이드 번호는 파일 이름이 아니라 발표 순서와 시작 번호(firstSlideNum)를 따른다", async () => {
  const slide = (text) => `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
  const file = await write("a.pptx", makeZip({
    "ppt/presentation.xml": `<p:presentation firstSlideNum="0"><p:sldIdLst><p:sldId id="1" r:id="rId3"/><p:sldId id="2" r:id="rId1"/><p:sldId id="3" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/><Relationship Id="rId3" Target="slides/slide3.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": slide("개요"),
    "ppt/slides/slide2.xml": slide("사양"),
    "ppt/slides/slide3.xml": slide("표지")
  }));
  const chunks = await extractFile(file);
  assert.equal(whereIs(chunks, "표지"), "슬라이드 0");
  assert.equal(whereIs(chunks, "개요"), "슬라이드 1");
  assert.equal(whereIs(chunks, "사양"), "슬라이드 2");
});
