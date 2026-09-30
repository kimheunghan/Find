"use strict";

// 스토어 스크린샷용 예시 문서 중 엑셀·워드·PDF·이미지를 만든다 (모두 지어낸 내용).
// 실행: npx electron scripts/store-demo-media.js <폴더>
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const dir = process.argv[process.argv.length - 1];

// ---- 아주 작은 ZIP 작성기 (DOCX·XLSX는 XML 파일들을 묶은 ZIP) ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const packed = zlib.deflateRawSync(data);
    const nameBuffer = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    locals.push(header, nameBuffer, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += header.length + nameBuffer.length + packed.length;
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

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function docx(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join("");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  });
}

function xlsx(sheetName, rows) {
  const col = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`).join("")}</row>`).join("");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
  });
}

function write(name, data) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  write("프로젝트/설치정보.xlsx", xlsx("서버목록", [
    ["구분", "서버명", "IP", "OS"],
    ["WEB", "web01", "192.168.10.21", "Rocky Linux 9"],
    ["WAS", "was01", "192.168.10.22", "Rocky Linux 9"],
    ["DB", "db01", "192.168.10.30", "Ubuntu 22.04"]
  ]));
  write("기획/제안요청서_최종(2).docx", docx([
    "제안요청서",
    "1. 사업 개요: 문서 관리 시스템 구축",
    "2. 운영 환경: 운영 서버 IP 대역은 192.168.10.0/24로 한다.",
    "3. 견적 조건: 단가와 유지보수 기간을 명시할 것"
  ]));

  // PDF·이미지: 창에 그려서 저장 (창을 여러 번 만들면 불러오기가 실패하므로 하나를 계속 쓴다)
  const win = new BrowserWindow({ width: 900, height: 560, show: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="font-family:'Malgun Gothic';padding:40px;line-height:1.8"><h2>설치 가이드 v2</h2><p>1. 접속 서버 IP: 192.168.10.30 (DB)</p><p>2. 관리자 계정으로 로그인한 뒤 백업 설정을 확인합니다.</p><p>3. 견적서에 적힌 유지보수 기간은 1년입니다.</p></body></html>`)}`);
  write("운영/설치가이드.pdf", await win.webContents.printToPDF({}));

  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:#f3f5f9;font-family:'Malgun Gothic'"><div style="margin:30px;padding:24px 30px;background:#fff;border:1px solid #d5dbe6;border-radius:8px;font-size:30px;color:#111"><div style="font-size:34px;font-weight:bold;margin-bottom:18px">관리 콘솔 - 서버 상태</div><div>web01  서버 IP 192.168.10.21  정상</div><div>was01  서버 IP 192.168.10.22  정상</div><div>db01  서버 IP 192.168.10.30  점검 필요</div></div></body></html>`)}`);
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width: 900, height: 360, deviceScaleFactor: 1, mobile: false });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png" });
  write("운영/화면캡처_0921.png", Buffer.from(data, "base64"));
  console.log("예시 문서: 설치정보.xlsx, 제안요청서_최종(2).docx, 설치가이드.pdf, 화면캡처_0921.png");
  app.quit();
});
