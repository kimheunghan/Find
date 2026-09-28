"use strict";

// 이미지 OCR 본문 검수: 한글·영문·숫자가 섞인 이미지를 만들어 실제 OCR로 색인하고 검색·강조를 확인한다.
// 실행: npm run setup:ocr 후 `npm run qa:ocr` (Python OCR 필요, 수십 초 걸림)
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ENGINE, pythonExecutable, stopOcr } = require("../src/ocr");
const { openContentIndex, indexContent, searchContent } = require("../src/contentIndex");
const { searchEntries, tokenize } = require("../src/search");
const { termRegex } = require("../src/renderer/highlight");

const dir = path.join(__dirname, "..", ".qa-ocr");
const draw = `
import sys
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype(r"C:\\Windows\\Fonts\\malgun.ttf", 40)
lines = ["장비 설치 확인서", "서버 사양: CPU 8core / RAM 64GB", "WEB01 IP 10.0.3.21", "운영 서버 점검 결과"]
image = Image.new("RGB", (1100, 60 + 70 * len(lines)), "white")
d = ImageDraw.Draw(image)
for i, line in enumerate(lines):
    d.text((40, 30 + 70 * i), line, fill="black", font=font)
image.save(sys.argv[1])
image.convert("L").save(sys.argv[2], quality=90)
# 세로쓰기 (족보처럼 글자를 위에서 아래로)
vfont = ImageFont.truetype(r"C:\\Windows\\Fonts\\malgun.ttf", 28)
columns = ["아들홍묵", "권지구일일록쪽기록", "21세", "최삼순"]
vertical = Image.new("RGB", (80 + 60 * len(columns), 420), (252, 248, 236))
vd = ImageDraw.Draw(vertical)
for i, text in enumerate(columns):
    for j, ch in enumerate(text):
        vd.text((40 + 60 * i, 20 + j * 38), ch, fill=(40, 40, 40), font=vfont)
vertical.save(sys.argv[3])
`;

(async () => {
  await fs.mkdir(dir, { recursive: true });
  const png = path.join(dir, "스캔_설치확인.png");
  const jpg = path.join(dir, "스캔 사본.jpg");
  const vertical = path.join(dir, "족보 세로쓰기.png");
  execFileSync(pythonExecutable(), ["-c", draw, png, jpg, vertical], { env: { ...process.env, PYTHONUTF8: "1" } });
  const entries = [png, jpg, vertical].map((file) => ({ name: path.basename(file), path: file, kind: "file", extension: path.extname(file).slice(1) }));

  const db = openContentIndex(":memory:");
  const started = Date.now();
  const summary = await indexContent(db, entries);
  stopOcr();
  console.log("OCR 색인", summary, `${((Date.now() - started) / 1000).toFixed(1)}초`);
  assert.equal(summary.extracted, 3, "세 이미지 모두 OCR되어야 한다");

  const cases = [
    ["설치", 2], ["사양", 2], ["치", 2], ["10.0.3.21", 2], ["8core", 2],
    ["운영 서버", 2], ['"운영 서버"', 2], ["web01", 2], ["점검 결과", 2], ["없는단어", 0],
    // 세로쓰기
    ["아들홍묵", 1], ["최삼순", 1], ["21세", 1], ["권지구일일록", 1]
  ];
  let failed = 0;
  for (const [query, expected] of cases) {
    const results = searchEntries(entries, query, {}, 200, searchContent(db, tokenize(query)));
    const hits = results.flatMap((item) => item.hits.map((hit) => ({ name: item.name, ...hit })));
    const badMark = hits.find((hit) => !tokenize(query).some((term) => new RegExp(`^(?:${termRegex(term).source})$`, "iu").test(hit.snippet.match)));
    const ok = results.length === expected && !badMark && hits.every((hit) => hit.location.startsWith("이미지 OCR"));
    // Windows OCR은 WEB01의 0·1을 O·I로 읽는다 (인식 한계, 검색으로 고칠 수 없음)
    const known = !ok && ENGINE === "windows" && query === "web01";
    if (!ok && !known) failed += 1;
    console.log(`${ok ? "✔" : known ? "△(알려진 한계)" : "✖"} ${query}: ${results.length}/${expected}개`, hits.slice(0, 2).map((hit) => `[${hit.location}] ${hit.snippet.before}〔${hit.snippet.match}〕${hit.snippet.after}`).join(" / "));
  }
  await fs.rm(dir, { recursive: true, force: true });
  if (failed) {
    console.log(`실패 ${failed}건`);
    process.exitCode = 1;
  }
})();
