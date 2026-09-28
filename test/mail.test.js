"use strict";

// 메일 파일(EML·MSG) 색인: 제목·주소·날짜·본문·첨부파일 이름·첨부파일 내용·첨부된 메일
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { makeDocx } = require("./helpers");
const { extractFile, describeLocation, resolveLocation } = require("../src/extract");
const { openContentIndex, indexContent, searchContent } = require("../src/contentIndex");
const { searchEntries, tokenize } = require("../src/search");

const b64 = (buffer) => Buffer.from(buffer).toString("base64").replace(/.{76}/g, "$&\r\n");

function makeEml({ subject, from, to, cc, date, body, attachments = [] }) {
  // 첨부된 메일과 구분자가 겹치지 않게 메일마다 다른 구분자를 쓴다
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(Buffer.from(body, "utf8"))}\r\n`
  ];
  for (const attachment of attachments) {
    const encodedName = `=?UTF-8?B?${Buffer.from(attachment.name, "utf8").toString("base64")}?=`;
    if (attachment.type === "message/rfc822") {
      parts.push(`--${boundary}\r\nContent-Type: message/rfc822; name="${encodedName}"\r\nContent-Disposition: attachment; filename="${encodedName}"\r\n\r\n${attachment.content}\r\n`);
    } else {
      parts.push(`--${boundary}\r\nContent-Type: application/octet-stream; name="${encodedName}"\r\nContent-Disposition: attachment; filename="${encodedName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(attachment.content)}\r\n`);
    }
  }
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  return [
    `From: ${from}`, `To: ${to}`, cc ? `Cc: ${cc}` : null, `Subject: ${encodedSubject}`, `Date: ${date}`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, `--${boundary}--`, ""
  ].filter((line) => line !== null).join("\r\n");
}

const where = (chunks, word) => {
  const chunk = chunks.find((item) => item.text.includes(word));
  assert.ok(chunk, `${word} 없음`);
  return describeLocation(resolveLocation(chunk.location, chunk.text.indexOf(word)));
};

test("EML: 제목·보낸 사람·받는 사람·참조·날짜·본문·첨부파일 이름과 내용·첨부된 메일까지 읽는다", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-mail-"));
  const inner = makeEml({ subject: "원본 견적 요청", from: "kim@a.com", to: "lee@b.com", date: "Mon, 21 Sep 2026 10:00:00 +0900", body: "WEB 서버 3대 견적 부탁드립니다" });
  const eml = makeEml({
    subject: "RE: 자료 전달드립니다",
    from: "홍길동 <hong@corp.co.kr>",
    to: "김종환 <kim@corp.co.kr>",
    cc: "전경애 <jeon@corp.co.kr>",
    date: "Tue, 22 Sep 2026 09:30:00 +0900",
    body: "안녕하세요.\r\n요청하신 설치 정보 첨부합니다.\r\n감사합니다.",
    attachments: [
      { name: "설치정보.docx", content: makeDocx(["운영 서버 IP 10.0.3.21", "사양 CPU 8core"]) },
      { name: "메모.txt", content: Buffer.from("비밀번호는 별도 전달", "utf8") },
      { name: "원본 메일.eml", type: "message/rfc822", content: inner }
    ]
  });
  const file = path.join(dir, "자료 전달.eml");
  await fs.writeFile(file, eml);

  const chunks = await extractFile(file);
  assert.equal(where(chunks, "자료 전달드립니다"), "메일 제목·주소");
  assert.equal(where(chunks, "hong@corp.co.kr"), "메일 제목·주소");
  assert.equal(where(chunks, "전경애"), "메일 제목·주소");
  assert.equal(where(chunks, "설치 정보 첨부"), "메일 본문 2번째 줄");
  assert.equal(where(chunks, "첨부: 설치정보.docx"), "첨부 설치정보.docx");
  assert.equal(where(chunks, "10.0.3.21"), "첨부 설치정보.docx 1번째 문단");
  assert.equal(where(chunks, "8core"), "첨부 설치정보.docx 2번째 문단");
  assert.equal(where(chunks, "별도 전달"), "첨부 메모.txt 1번째 줄");
  assert.equal(where(chunks, "WEB 서버 3대"), "첨부 원본 메일.eml 메일 본문 1번째 줄");
  assert.equal(where(chunks, "원본 견적 요청"), "첨부 원본 메일.eml 메일 제목·주소");

  // 검색으로도 찾는다
  const entries = [{ name: "자료 전달.eml", path: file, kind: "file", extension: "eml" }];
  const db = openContentIndex(":memory:");
  await indexContent(db, entries);
  for (const [query, location] of [["10.0.3.21", "첨부 설치정보.docx 1번째 문단"], ["전경애", "메일 제목·주소"], ["부탁드립니다", "첨부 원본 메일.eml 메일 본문 1번째 줄"], ['"원본 견적 요청"', "첨부 원본 메일.eml 메일 제목·주소"]]) {
    const results = searchEntries(entries, query, {}, 200, searchContent(db, tokenize(query)));
    assert.equal(results.length, 1, query);
    assert.equal(results[0].hits[0].location, location, query);
  }
});
