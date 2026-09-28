"use strict";

// 테스트용 파일 생성 도구: ZIP(DOCX/XLSX/PPTX/HWPX), HWP 5.0, 영문 PDF
const zlib = require("node:zlib");

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

const xml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function makeDocx(paragraphs) {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join("");
  return makeZip({ "word/document.xml": `<w:document><w:body>${body}</w:body></w:document>` });
}

function makePptx(slides) {
  const files = {};
  slides.forEach((text, index) => {
    files[`ppt/slides/slide${index + 1}.xml`] = `<p:sld><a:p><a:r><a:t>${xml(text)}</a:t></a:r></a:p></p:sld>`;
  });
  return makeZip(files);
}

function makeXlsx(sheetName, rows) {
  const strings = [];
  const sheetRows = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((value, c) => {
    strings.push(value);
    return `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="s"><v>${strings.length - 1}</v></c>`;
  }).join("")}</row>`).join("");
  return makeZip({
    "xl/workbook.xml": `<workbook><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${strings.map((s) => `<si><t>${xml(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`
  });
}

function makeHwpx(paragraphs) {
  const body = paragraphs.map((text) => `<hp:p><hp:run><hp:t>${xml(text)}</hp:t></hp:run></hp:p>`).join("");
  return makeZip({ "Contents/section0.xml": `<hs:sec>${body}</hs:sec>` });
}

function hwpRecord(tag, data) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE((data.length << 20) | tag, 0);
  return Buffer.concat([header, data]);
}

function makeHwp(paragraphs) {
  const CFB = require("cfb");
  const fileHeader = Buffer.alloc(256);
  fileHeader.write("HWP Document File", 0, "latin1");
  fileHeader.writeUInt32LE(0x1, 36);
  const section = Buffer.concat(paragraphs.map((text) => hwpRecord(67, Buffer.concat([Buffer.from(text, "utf16le"), Buffer.from([13, 0])]))));
  const doc = CFB.utils.cfb_new();
  CFB.utils.cfb_add(doc, "/FileHeader", fileHeader);
  CFB.utils.cfb_add(doc, "/BodyText/Section0", zlib.deflateRawSync(section));
  return CFB.write(doc, { type: "buffer" });
}

// 영문 글꼴(Helvetica)만 쓰는 최소 PDF. 쪽마다 한 줄.
function makePdf(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const text of pages) {
    const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentRef = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

module.exports = { makeZip, makeDocx, makePptx, makeXlsx, makeHwpx, makeHwp, makePdf };
