"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { extractImageText } = require("./ocr");

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const CHUNK_CHARS = 800;
const TEXT_EXTENSIONS = new Set(["txt", "csv", "md", "log"]);
const ZIP_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "hwpx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...ZIP_EXTENSIONS, ...IMAGE_EXTENSIONS, "hwp", "pdf"]);
// 형식별 추출 방식 버전. 올리면 그 형식의 파일만 백그라운드에서 다시 추출한다 (PDF·이미지 OCR은 다시 하지 않음).
// 2: 실제 일치한 줄·칸 위치(marks), HWP·HWPX·DOCX 쪽 번호, PPTX 발표 순서·시작 번호
// 이미지: 4 = Windows OCR 빠른 판독(작은 글씨 2배 확대, 세로쓰기 다시 읽기), 5 = 빠른 판독 + PaddleOCR 정밀 판독 (PRECISE_OCR_VERSION)
const EXTRACTOR_VERSIONS = {
  txt: 2, csv: 2, md: 2, log: 2, docx: 2, xlsx: 2, pptx: 2, hwpx: 2, hwp: 2,
  png: 4, jpg: 4, jpeg: 4, gif: 4, webp: 4, bmp: 4, tif: 4, tiff: 4
};
const PRECISE_OCR_VERSION = 5;

// 정밀 판독: 두 OCR 엔진이 서로 다른 글자를 놓치므로(Windows는 작은 한글, PaddleOCR은 한자·일부 글자) 두 결과를 합친다.
// 같은 줄은 한 번만 넣는다. 어느 한쪽이라도 맞게 읽으면 검색된다.
async function extractImagePrecise(filePath) {
  const results = await Promise.allSettled([extractImageText(filePath, "windows"), extractImageText(filePath, "paddle")]);
  const ok = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!ok.length) throw results[0].reason;
  const seen = new Set();
  const lines = [];
  for (const chunks of ok) {
    for (const chunk of chunks) {
      const key = chunk.text.replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(chunk.text);
    }
  }
  return lines.map((text, index) => ({ location: { ocr: true, line: index + 1 }, text }));
}

// ---- 텍스트 파일 ----

function decodeText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString("utf8");
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // 한국어 Windows에서 만든 메모장·CSV 파일은 CP949(EUC-KR)인 경우가 많다.
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

// 줄을 모아 적당한 길이의 조각으로 나눈다. 조각 안에서 위치 표시(줄·문단·쪽)가 바뀌는 곳은
// marks에 [조각 안 글자 위치, 위치]로 남겨, 조각 첫 줄이 아니라 실제로 일치한 줄의 위치를 보여 준다 (resolveLocation).
function chunkLines(lines, makeLocation) {
  const chunks = [];
  let buffer = [];
  let size = 0;
  let marks = [];
  let lastLabel = null;
  const flush = () => {
    if (!buffer.length) return;
    const location = marks.length > 1 ? { ...marks[0][1], marks } : marks[0][1];
    chunks.push({ location, text: buffer.join("\n") });
    buffer = [];
    size = 0;
    marks = [];
    lastLabel = null;
  };
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    const location = makeLocation(index);
    const label = describeLocation(location);
    if (label !== lastLabel) {
      marks.push([size + buffer.length, location]);
      lastLabel = label;
    }
    buffer.push(text);
    size += text.length;
    if (size >= CHUNK_CHARS) flush();
  });
  flush();
  return chunks;
}

// 조각 안 글자 위치(at)에 해당하는 실제 위치를 고른다. marks가 없으면 조각의 위치 그대로다.
function resolveLocation(location, at) {
  if (!location || !Array.isArray(location.marks) || at === undefined || at === null) return location;
  let current = location.marks[0][1];
  for (const [offset, mark] of location.marks) {
    if (offset > at) break;
    current = mark;
  }
  return current;
}

function extractPlainText(buffer) {
  return chunkLines(decodeText(buffer).split(/\r?\n/), (index) => ({ line: index + 1 }));
}

// ---- ZIP (DOCX/XLSX/PPTX/HWPX) ----

function readZipEntries(buffer) {
  const minEocd = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP 형식이 아닙니다");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP 목록이 손상되었습니다");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const local = entry.localOffset;
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return data.toString("utf8");
      if (entry.method === 8) return zlib.inflateRawSync(data).toString("utf8");
      throw new Error(`지원하지 않는 ZIP 압축 방식(${entry.method})입니다`);
    }
  };
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// 지정한 태그(예: w:t, a:t, hp:t) 안의 글자만 모은다.
function textOf(xml, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let text = "";
  let match;
  while ((match = pattern.exec(xml)) !== null) text += decodeXml(match[1]);
  return text;
}

function paragraphs(xml, paragraphTag, textTag) {
  const pattern = new RegExp(`<${paragraphTag}[\\s>][\\s\\S]*?</${paragraphTag}>`, "g");
  return (xml.match(pattern) || []).map((paragraph) => textOf(paragraph, textTag));
}

function byNumber(pattern) {
  return (a, b) => Number(pattern.exec(a)[1]) - Number(pattern.exec(b)[1]);
}

// DOCX 쪽 번호: Word는 저장할 때 화면에서 쪽이 넘어간 자리에 <w:lastRenderedPageBreak/>를 남긴다.
// 이 표시가 있으면 그것만 세고(직접 넣은 쪽 나눔도 여기에 포함된다), 없으면 직접 넣은 쪽 나눔만 센다.
// 둘 다 없으면 쪽을 알 수 없으므로 문단 번호로 표시한다.
function extractDocx(zip) {
  const xml = zip.read("word/document.xml") || "";
  const rendered = /<w:lastRenderedPageBreak\b/.test(xml);
  const breakPattern = rendered
    ? /<w:lastRenderedPageBreak\b/g
    : /<w:br\b[^>]*\bw:type="page"|<w:pageBreakBefore\b(?![^>]*w:val="(?:0|false)")/g;
  const hasPages = rendered || breakPattern.test(xml);
  const list = [];
  let page = 1;
  for (const match of xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0];
    const firstText = paragraph.search(/<w:t[\s>]/);
    const head = firstText < 0 ? paragraph : paragraph.slice(0, firstText);
    const before = (head.match(breakPattern) || []).length;
    const total = (paragraph.match(breakPattern) || []).length;
    page += before;
    list.push({ text: textOf(paragraph, "w:t"), page });
    page += total - before;
  }
  return chunkLines(list.map((item) => item.text), (index) => (
    hasPages ? { page: list[index].page, paragraph: index + 1 } : { paragraph: index + 1 }
  ));
}

// 슬라이드 번호는 파일 이름(slide41.xml)이 아니라 presentation.xml의 발표 순서를 따른다.
// 슬라이드를 옮기거나 지우면 둘이 달라진다 (예: 파일은 slide41, 실제로는 40번째).
function pptxSlideOrder(zip) {
  const presentation = zip.read("ppt/presentation.xml") || "";
  const rels = zip.read("ppt/_rels/presentation.xml.rels") || "";
  const targets = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0]);
    const target = /\bTarget="([^"]+)"/.exec(match[0]);
    if (id && target) targets.set(id[1], `ppt/${target[1].replace(/^\/?ppt\//, "").replace(/^\//, "")}`);
  }
  const ordered = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const relId = /\br:id="([^"]+)"/.exec(match[0]);
    const target = relId && targets.get(relId[1]);
    if (target && zip.names.includes(target)) ordered.push(target);
  }
  if (ordered.length) return ordered;
  const pattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  return zip.names.filter((name) => pattern.test(name)).sort(byNumber(pattern));
}

function extractPptx(zip) {
  const first = Number(/\bfirstSlideNum="(\d+)"/.exec(zip.read("ppt/presentation.xml") || "")?.[1] ?? 1);
  return pptxSlideOrder(zip).flatMap((name, index) => {
    const slide = index + first;
    const text = paragraphs(zip.read(name), "a:p", "a:t").map((line) => line.trim()).filter(Boolean).join("\n");
    return text ? [{ location: { slide }, text }] : [];
  });
}

// 본문 줄 배치로 쪽을 센다 (HWP·HWPX 공통): "쪽의 첫 줄" 표시(bit 0)가 있거나,
// 단 바뀜(bit 1)이 아닌데 줄의 세로 위치가 위로 돌아가면 새 쪽이다.
function countPage(state, vpos, flags) {
  state.sawLayout = true;
  const newColumnOnly = (flags & 0x2) && !(flags & 0x1);
  const movedUp = state.lastVpos !== null && vpos < state.lastVpos && !newColumnOnly;
  if ((flags & 0x1) || movedUp || state.page === 0) state.page += 1;
  state.lastVpos = vpos;
}

// HWPX 문단을 문서 순서대로 { text, page, inTable }로 돌려준다. 본문(최상위) 문단의 <hp:lineseg>로 쪽을 세고,
// 표 안 문단은 표를 담은 본문 문단의 쪽(표가 시작하는 쪽)을 따른다.
const HWPX_TOKEN = /<(\/?)hp:(p|t|lineseg|tbl|tc|cellAddr|cellSpan|cellSz|sz|pagePr|margin)\b([^>]*?)(\/?)>|<[^>]*>|([^<]+)/g;
const attr = (attrs, name) => Number(new RegExp(`\\b${name}="(-?\\d+)"`).exec(attrs)?.[1] || 0);

function hwpxParagraphs(xml, state) {
  const out = [];
  const stack = [];
  let inText = 0;
  let tableDepth = 0;
  let table = null; // 본문 표 { height, rows: Map<행, 높이>, cells: [{ row, paragraphs }] }
  let cell = null;
  let pageHeight = 0;
  for (const [, close, name, attrs, selfClosing, text] of xml.matchAll(HWPX_TOKEN)) {
    if (text !== undefined) {
      if (inText > 0 && stack.length) stack[stack.length - 1].text += decodeXml(text);
    } else if (name === "p" && !selfClosing) {
      if (!close) {
        const paragraph = { text: "", page: null, vpos: null, inTable: tableDepth > 0, top: stack.length === 0 && tableDepth === 0, start: out.length, tables: [] };
        out.push(paragraph);
        stack.push(paragraph);
        if (cell) cell.paragraphs.push(paragraph);
        else if (table && tableDepth === 1) table.captions.push(paragraph); // 표 제목(캡션): 표가 시작하는 쪽
      } else {
        const paragraph = stack.pop();
        if (paragraph?.top && paragraph.page !== null) {
          for (let i = paragraph.start; i < out.length; i += 1) out[i].page ??= paragraph.page;
          // 표 칸의 쪽: 표를 담은 문단의 줄 위치 + 칸 위 행들의 높이 (HWP와 같은 계산).
          // 한 문단에 표가 여러 개면 앞 표 아래에 이어 놓인 것으로 보고 차례로 쌓는다.
          if (paragraph.tables.length && state.bodyHeight) {
            let top = Math.max(paragraph.vpos || 0, 0);
            for (const table of paragraph.tables) {
              const rowTop = new Map();
              let y = 0;
              for (let row = 0; row <= Math.max(-1, ...table.rows.keys()); row += 1) {
                rowTop.set(row, y);
                y += table.rows.get(row) || 0;
              }
              for (const caption of table.captions) {
                caption.page = paragraph.page + Math.floor(top / state.bodyHeight);
                caption.inTable = false;
              }
              for (const item of table.cells) {
                for (const inner of item.paragraphs) {
                  inner.page = paragraph.page + Math.floor((top + (rowTop.get(item.row) || 0)) / state.bodyHeight);
                  inner.inTable = false;
                }
              }
              top += table.height || y;
            }
            if (top > state.bodyHeight) {
              state.page = Math.max(state.page, paragraph.page + Math.floor(top / state.bodyHeight));
              state.lastVpos = top % state.bodyHeight;
            }
          }
        }
      }
    } else if (name === "t" && !selfClosing) {
      inText += close ? -1 : 1;
    } else if (name === "tbl" && !selfClosing) {
      if (!close && tableDepth === 0 && stack[stack.length - 1]?.top) {
        table = { height: null, rows: new Map(), cells: [], captions: [] };
        stack[stack.length - 1].tables.push(table);
      }
      tableDepth += close ? -1 : 1;
      if (close && tableDepth === 0) table = null;
    } else if (name === "sz" && table && tableDepth === 1 && !cell && table.height === null) {
      table.height = attr(attrs, "height");
    } else if (name === "tc" && table && tableDepth === 1 && !selfClosing) {
      if (!close) cell = { row: 0, rowSpan: 1, paragraphs: [] };
      else if (cell) {
        table.cells.push(cell);
        cell = null;
      }
    } else if (cell && tableDepth === 1 && name === "cellAddr") {
      cell.row = attr(attrs, "rowAddr");
    } else if (cell && tableDepth === 1 && name === "cellSpan") {
      cell.rowSpan = attr(attrs, "rowSpan") || 1;
    } else if (cell && tableDepth === 1 && name === "cellSz" && cell.rowSpan === 1) {
      table.rows.set(cell.row, Math.max(table.rows.get(cell.row) || 0, attr(attrs, "height")));
    } else if (name === "pagePr" && !close) {
      pageHeight = attr(attrs, "height");
    } else if (name === "margin" && pageHeight && !state.bodyHeight) {
      state.bodyHeight = pageHeight - attr(attrs, "top") - attr(attrs, "bottom") - attr(attrs, "header") - attr(attrs, "footer");
    } else if (name === "lineseg") {
      const paragraph = stack[stack.length - 1];
      if (paragraph?.top) {
        countPage(state, attr(attrs, "vertpos"), attr(attrs, "flags"));
        paragraph.page ??= Math.max(state.page, 1);
        paragraph.vpos ??= attr(attrs, "vertpos");
      }
    }
  }
  return out.map(({ text, page, inTable }) => ({ text, page: state.sawLayout ? page ?? Math.max(state.page, 1) : null, inTable }));
}

function extractHwpx(zip) {
  const pattern = /^Contents\/section(\d+)\.xml$/;
  const state = { page: 0, lastVpos: null, sawLayout: false };
  return zip.names.filter((name) => pattern.test(name)).sort(byNumber(pattern)).flatMap((name) => {
    const section = Number(pattern.exec(name)[1]) + 1;
    return chunkPages(hwpxParagraphs(zip.read(name), state), (page, paragraph, inTable) => hwpLocation(page, section, paragraph, inTable));
  });
}

// 쪽을 모르면(줄 배치 정보 없음) 구역·문단 번호로, 표 안이면 표가 시작하는 쪽으로 표시한다.
function hwpLocation(page, section, paragraph, inTable) {
  if (!page) return { section, paragraph: paragraph + 1 };
  return inTable ? { tableFrom: page, section, paragraph: paragraph + 1 } : { page, section, paragraph: paragraph + 1 };
}

function extractXlsx(zip) {
  const shared = paragraphs(zip.read("xl/sharedStrings.xml") || "", "si", "t");
  const workbook = zip.read("xl/workbook.xml") || "";
  const rels = zip.read("xl/_rels/workbook.xml.rels") || "";
  const targets = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0]);
    const target = /\bTarget="([^"]+)"/.exec(match[0]);
    if (id && target) targets.set(id[1], target[1].replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const chunks = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(match[0]);
    const relId = /\br:id="([^"]+)"/.exec(match[0]);
    const target = relId && targets.get(relId[1]);
    const xml = target && zip.read(`xl/${target}`);
    if (!xml) continue;
    const sheet = decodeXml(name ? name[1] : "");

    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(cell[1]);
        const type = /\bt="([^"]+)"/.exec(cell[1]);
        const body = cell[2] || "";
        let value;
        if (type && type[1] === "s") value = shared[Number(textOf(body, "v"))];
        else if (type && type[1] === "inlineStr") value = textOf(body, "t");
        else value = textOf(body, "v");
        if (value && value.trim()) cells.push({ cell: ref ? ref[1] : "", value: value.trim() });
      }
      if (cells.length) {
        // 한 행을 한 조각으로 저장하되, 칸마다 시작 위치를 marks로 남겨 실제 일치한 칸(B4, C4 …)을 보여 준다.
        const marks = [];
        let offset = 0;
        for (const item of cells) {
          marks.push([offset, { sheet, cell: item.cell }]);
          offset += item.value.length + 3; // " | "
        }
        const location = marks.length > 1 ? { sheet, cell: cells[0].cell, marks } : { sheet, cell: cells[0].cell };
        chunks.push({ location, text: cells.map((item) => item.value).join(" | ") });
      }
    }
  }
  return chunks;
}

// ---- HWP 5.0 (OLE 복합 문서) ----

const HWPTAG_PARA_TEXT = 67;
// 제어 문자 중 한 글자짜리(0, 10, 13, 24~31)를 뺀 나머지는 8글자(16바이트)를 차지한다.
const HWP_SINGLE_CHAR_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

function hwpParagraphText(data) {
  let text = "";
  for (let i = 0; i + 1 < data.length;) {
    const code = data.readUInt16LE(i);
    if (code >= 32) {
      text += String.fromCharCode(code);
      i += 2;
    } else if (HWP_SINGLE_CHAR_CONTROLS.has(code)) {
      if (code === 10) text += "\n";
      i += 2;
    } else {
      if (code === 9) text += "\t";
      i += 16;
    }
  }
  return text;
}

const HWPTAG_PARA_HEADER = 66;
const HWPTAG_PARA_LINE_SEG = 69;
const LINE_SEG_SIZE = 36;

const HWPTAG_CTRL_HEADER = 71;
const HWPTAG_LIST_HEADER = 72;
const HWPTAG_PAGE_DEF = 73;
const CTRL_TABLE = 0x74626c20; // 'tbl '

// 본문 표의 칸이 몇 쪽에 오는지 계산한다: 표 위치(담은 문단의 줄 위치) + 그 칸 위 행들의 높이를 쪽 본문 높이로 나눈다.
// 표가 여러 쪽에 걸치면 표 뒤 본문의 쪽도 그만큼 넘긴다. 쪽 본문 높이를 모르면 "표가 시작하는 쪽"으로만 남긴다.
function finishHwpTable(table, state) {
  if (!table || !state.bodyHeight || table.startPage === null) return;
  const rowTop = new Map();
  let top = 0;
  for (let row = 0; row <= Math.max(-1, ...table.rows.keys()); row += 1) {
    rowTop.set(row, top);
    top += table.rows.get(row) || 0;
  }
  for (const paragraph of table.paragraphs) {
    const y = table.top + (rowTop.get(paragraph.tableRow) || 0);
    paragraph.page = table.startPage + Math.floor(y / state.bodyHeight);
    paragraph.inTable = false; // 쪽을 계산했으므로 "표가 시작하는 쪽"이 아니라 그 쪽으로 표시한다
  }
  const end = table.top + table.height;
  if (end > state.bodyHeight) {
    state.page = Math.max(state.page, table.startPage + Math.floor(end / state.bodyHeight));
    state.lastVpos = end % state.bodyHeight;
  }
}

// 문단마다 { text, page, inTable }을 돌려준다. 쪽 번호는 한글이 마지막으로 저장한 본문 줄 배치(PARA_LINE_SEG)로 구한다:
// "쪽의 첫 줄" 표시(flags bit 0)가 있거나, 단 바뀜(bit 1)이 아닌데 줄의 세로 위치가 위로 돌아가면 새 쪽이다.
// 본문 표 안 글자는 용지(PAGE_DEF)·표 높이·칸 높이로 쪽을 계산한다 (finishHwpTable).
// state는 구역(Section)을 넘어 이어진다.
function hwpSectionParagraphs(buffer, state = { page: 0, lastVpos: null }) {
  const paragraphs = [];
  let topLevel = null; // 현재 본문(최상위) 문단 { page, vpos, members: [] }
  let table = null; // 현재 본문 표 { startPage, top, height, rows: Map<행, 높이>, paragraphs }
  let tableRow = 0;
  for (let offset = 0; offset + 4 <= buffer.length;) {
    const header = buffer.readUInt32LE(offset);
    const tag = header & 0x3ff;
    const level = (header >>> 10) & 0x3ff;
    let size = header >>> 20;
    offset += 4;
    if (size === 0xfff) {
      size = buffer.readUInt32LE(offset);
      offset += 4;
    }
    const data = buffer.subarray(offset, offset + size);
    if (tag === HWPTAG_PAGE_DEF && data.length >= 32) {
      // 용지 높이 - 위·아래 여백 - 머리말·꼬리말 여백 = 본문 높이
      const [height, top, bottom, headerMargin, footerMargin] = [4, 16, 20, 24, 28].map((at) => data.readUInt32LE(at));
      state.bodyHeight = height - top - bottom - headerMargin - footerMargin;
    } else if (tag === HWPTAG_PARA_HEADER && level === 0) {
      finishHwpTable(table, state);
      table = null;
      topLevel = { page: null, vpos: null, members: [] };
    } else if (tag === HWPTAG_PARA_TEXT) {
      const paragraph = { text: hwpParagraphText(data), page: topLevel?.page ?? null, inTable: level > 1 };
      paragraphs.push(paragraph);
      if (topLevel && topLevel.page === null) topLevel.members.push(paragraph);
      if (table && level > 1) {
        paragraph.tableRow = tableRow;
        table.paragraphs.push(paragraph);
      }
    } else if (tag === HWPTAG_PARA_LINE_SEG && level === 1 && topLevel) {
      for (let i = 0; i + LINE_SEG_SIZE <= data.length; i += LINE_SEG_SIZE) {
        countPage(state, data.readInt32LE(i + 4), data.readUInt32LE(i + 32));
        if (i === 0 && topLevel.page === null) {
          topLevel.page = Math.max(state.page, 1);
          topLevel.vpos = data.readInt32LE(i + 4);
          for (const member of topLevel.members) member.page = topLevel.page;
        }
      }
    } else if (tag === HWPTAG_CTRL_HEADER && level === 1 && topLevel && data.length >= 24 && data.readUInt32LE(0) === CTRL_TABLE) {
      finishHwpTable(table, state);
      table = { startPage: topLevel.page, top: Math.max(topLevel.vpos || 0, 0), height: data.readUInt32LE(20), rows: new Map(), paragraphs: [] };
    } else if (tag === HWPTAG_LIST_HEADER && level === 2 && table && data.length >= 24) {
      // 표 칸: 행 번호(10), 행 병합 수(14), 칸 높이(20). 병합하지 않은 칸의 높이로 행 높이를 정한다.
      tableRow = data.readUInt16LE(10);
      if (data.readUInt16LE(14) === 1) table.rows.set(tableRow, Math.max(table.rows.get(tableRow) || 0, data.readUInt32LE(20)));
    }
    offset += size;
  }
  finishHwpTable(table, state);
  // 줄 배치 정보가 없는 파일은 쪽을 추정하지 않는다 (문단 번호로 표시).
  for (const paragraph of paragraphs) paragraph.page = state.sawLayout ? paragraph.page ?? Math.max(state.page, 1) : null;
  return paragraphs;
}

// 쪽이나 표 안/밖이 바뀌면 조각을 나눠, 조각의 위치 표시가 실제 일치한 줄과 어긋나지 않게 한다.
function chunkPages(paragraphs, makeLocation) {
  const chunks = [];
  let start = 0;
  const key = (paragraph) => `${paragraph.page}|${paragraph.inTable}`;
  for (let i = 1; i <= paragraphs.length; i += 1) {
    if (i === paragraphs.length || key(paragraphs[i]) !== key(paragraphs[start])) {
      const { page, inTable } = paragraphs[start];
      chunks.push(...chunkLines(paragraphs.slice(start, i).map((p) => p.text), (index) => makeLocation(page, start + index, inTable)));
      start = i;
    }
  }
  return chunks;
}

function extractHwp(buffer) {
  const CFB = require("cfb");
  const doc = CFB.read(buffer, { type: "buffer" });
  const header = CFB.find(doc, "/FileHeader");
  if (!header || !Buffer.from(header.content).toString("latin1").startsWith("HWP Document File")) {
    throw new Error("HWP 5.0 형식이 아닙니다");
  }
  const flags = Buffer.from(header.content).readUInt32LE(36);
  if (flags & 0x2) throw new Error("암호가 걸린 HWP 문서입니다");
  if (flags & 0x4) throw new Error("배포용 HWP 문서는 아직 지원하지 않습니다");
  const compressed = Boolean(flags & 0x1);

  const chunks = [];
  const state = { page: 0, lastVpos: null, sawLayout: false };
  for (let index = 0; ; index += 1) {
    const entry = CFB.find(doc, `/BodyText/Section${index}`);
    if (!entry) break;
    const raw = Buffer.from(entry.content);
    const data = compressed ? zlib.inflateRawSync(raw) : raw;
    chunks.push(...chunkPages(hwpSectionParagraphs(data, state), (page, paragraph, inTable) => hwpLocation(page, index + 1, paragraph, inTable)));
  }
  return chunks;
}

// ---- 이미지 크기 (헤더만 읽음) ----

// PNG·JPEG·GIF·BMP·WEBP 헤더에서 가로·세로 픽셀을 읽는다. 알 수 없으면 null.
function imageSize(buffer) {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.toString("latin1", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 26 && buffer.toString("latin1", 0, 2) === "BM") {
    return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
  }
  if (buffer.length >= 30 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") {
    const chunk = buffer.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    // JPEG: SOF(0xC0~0xCF, 0xC4·0xC8·0xCC 제외) 표시를 찾는다
    for (let i = 2; i + 9 < buffer.length;) {
      if (buffer[i] !== 0xff) { i += 1; continue; }
      const marker = buffer[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buffer.readUInt16BE(i + 2);
    }
  }
  return null;
}

async function readImageSize(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(65536), 0, 65536, 0);
    return imageSize(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

// ---- PDF ----

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ||= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0
  });
  const chunks = [];
  try {
    const document = await loadingTask.promise;
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      let text = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      text = text.replace(/[ \t]+\n/g, "\n").trim();
      if (text) chunks.push({ location: { page }, text });
    }
  } finally {
    await loadingTask.destroy();
  }
  return chunks;
}

// options.preciseOcr: 이미지를 두 OCR 엔진으로 정밀 판독한다.
async function extractFile(filePath, options = {}) {
  const extension = path.extname(filePath).slice(1).toLocaleLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) return null;
  // 이미지는 Python OCR 프로세스가 직접 읽는다. 큰 이미지 전체를 Node 메모리에 중복 적재하지 않는다.
  if (IMAGE_EXTENSIONS.has(extension)) return options.preciseOcr ? extractImagePrecise(filePath) : extractImageText(filePath, "windows");
  const buffer = await fs.readFile(filePath);
  if (TEXT_EXTENSIONS.has(extension)) return extractPlainText(buffer);
  if (extension === "hwp") return extractHwp(buffer);
  if (extension === "pdf") return extractPdf(buffer);

  const zip = readZipEntries(buffer);
  if (extension === "docx") return extractDocx(zip);
  if (extension === "pptx") return extractPptx(zip);
  if (extension === "xlsx") return extractXlsx(zip);
  return extractHwpx(zip);
}

function describeLocation(location) {
  if (!location) return "";
  if (location.ocr) return location.line ? `이미지 OCR ${location.vertical ? "세로 " : ""}${location.line}번째 줄` : "이미지 OCR";
  if (location.sheet !== undefined) return `${location.sheet} 시트 ${location.cell || ""}`.trim();
  if (location.tableFrom) return `${location.tableFrom}쪽에서 시작하는 표 안`;
  if (location.page) return `${location.page}쪽`;
  if (location.slide !== undefined) return `슬라이드 ${location.slide}`;
  if (location.section) return `${location.section}구역 ${location.paragraph}번째 문단`;
  if (location.paragraph) return `${location.paragraph}번째 문단`;
  if (location.line) return `${location.line}번째 줄`;
  return "";
}

module.exports = { imageSize, readImageSize, MAX_FILE_SIZE, IMAGE_EXTENSIONS, SUPPORTED_EXTENSIONS, EXTRACTOR_VERSIONS, PRECISE_OCR_VERSION, decodeText, readZipEntries, extractFile, describeLocation, resolveLocation };
