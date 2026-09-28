"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const CHUNK_CHARS = 800;
const TEXT_EXTENSIONS = new Set(["txt", "csv", "md", "log"]);
const ZIP_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "hwpx"]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...ZIP_EXTENSIONS, "hwp", "pdf"]);

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

// 줄을 모아 적당한 길이의 조각으로 나누고, 조각이 시작하는 줄 번호를 위치로 남긴다.
function chunkLines(lines, makeLocation) {
  const chunks = [];
  let buffer = [];
  let size = 0;
  let start = 0;
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    if (!buffer.length) start = index;
    buffer.push(text);
    size += text.length;
    if (size >= CHUNK_CHARS) {
      chunks.push({ location: makeLocation(start), text: buffer.join("\n") });
      buffer = [];
      size = 0;
    }
  });
  if (buffer.length) chunks.push({ location: makeLocation(start), text: buffer.join("\n") });
  return chunks;
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

function extractDocx(zip) {
  const xml = zip.read("word/document.xml") || "";
  return chunkLines(paragraphs(xml, "w:p", "w:t"), (index) => ({ paragraph: index + 1 }));
}

function extractPptx(zip) {
  const pattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  return zip.names.filter((name) => pattern.test(name)).sort(byNumber(pattern)).flatMap((name) => {
    const slide = Number(pattern.exec(name)[1]);
    const text = paragraphs(zip.read(name), "a:p", "a:t").map((line) => line.trim()).filter(Boolean).join("\n");
    return text ? [{ location: { slide }, text }] : [];
  });
}

function extractHwpx(zip) {
  const pattern = /^Contents\/section(\d+)\.xml$/;
  return zip.names.filter((name) => pattern.test(name)).sort(byNumber(pattern)).flatMap((name) => {
    const section = Number(pattern.exec(name)[1]) + 1;
    return chunkLines(paragraphs(zip.read(name), "hp:p", "hp:t"), (index) => ({ section, paragraph: index + 1 }));
  });
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
        chunks.push({ location: { sheet, cell: cells[0].cell }, text: cells.map((item) => item.value).join(" | ") });
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

function hwpSectionParagraphs(buffer) {
  const paragraphs = [];
  for (let offset = 0; offset + 4 <= buffer.length;) {
    const header = buffer.readUInt32LE(offset);
    const tag = header & 0x3ff;
    let size = header >>> 20;
    offset += 4;
    if (size === 0xfff) {
      size = buffer.readUInt32LE(offset);
      offset += 4;
    }
    if (tag === HWPTAG_PARA_TEXT) paragraphs.push(hwpParagraphText(buffer.subarray(offset, offset + size)));
    offset += size;
  }
  return paragraphs;
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
  for (let index = 0; ; index += 1) {
    const entry = CFB.find(doc, `/BodyText/Section${index}`);
    if (!entry) break;
    const raw = Buffer.from(entry.content);
    const data = compressed ? zlib.inflateRawSync(raw) : raw;
    chunks.push(...chunkLines(hwpSectionParagraphs(data), (paragraph) => ({ section: index + 1, paragraph: paragraph + 1 })));
  }
  return chunks;
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

async function extractFile(filePath) {
  const extension = path.extname(filePath).slice(1).toLocaleLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) return null;
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
  if (location.sheet !== undefined) return `${location.sheet} 시트 ${location.cell || ""}`.trim();
  if (location.page) return `${location.page}쪽`;
  if (location.slide) return `슬라이드 ${location.slide}`;
  if (location.section) return `${location.section}구역 ${location.paragraph}번째 문단`;
  if (location.paragraph) return `${location.paragraph}번째 문단`;
  if (location.line) return `${location.line}번째 줄`;
  return "";
}

module.exports = { MAX_FILE_SIZE, SUPPORTED_EXTENSIONS, decodeText, readZipEntries, extractFile, describeLocation };
