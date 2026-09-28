"use strict";

// IMAP 동기화: 가짜 IMAP 접속으로 새 메일만 가져오기·최신순·UIDVALIDITY 변경·첨부 내용 검색을 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { syncAccount, parseMailPath } = require("../src/imap");
const { openContentIndex, searchContent, mailEntries } = require("../src/contentIndex");
const { searchEntries, tokenize } = require("../src/search");

function eml(subject, body, attachment) {
  const boundary = `b${Math.random().toString(36).slice(2)}`;
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body, "utf8").toString("base64")}\r\n`];
  if (attachment) parts.push(`--${boundary}\r\nContent-Type: text/plain; name="${enc(attachment.name)}"\r\nContent-Disposition: attachment; filename="${enc(attachment.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(attachment.text, "utf8").toString("base64")}\r\n`);
  return Buffer.from([`From: 홍길동 <hong@corp.co.kr>`, `To: kim@corp.co.kr`, `Subject: ${enc(subject)}`, `Date: Tue, 22 Sep 2026 09:30:00 +0900`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, `--${boundary}--`, ""].join("\r\n"));
}

// 폴더: { uidValidity, messages: Map<uid, Buffer> }
function fakeServer(folders) {
  const fetched = [];
  const createClient = () => {
    const imap = {
      mailbox: null,
      async connect() {},
      async logout() {},
      async list() { return Object.keys(folders).map((path) => ({ path, flags: new Set() })); },
      async getMailboxLock(path) { imap.mailbox = { path, uidValidity: folders[path].uidValidity }; return { release() {} }; },
      async search(query) {
        const from = Number(String(query.uid).split(":")[0]);
        return [...folders[imap.mailbox.path].messages.keys()].filter((uid) => uid >= from);
      },
      async *fetch(range) {
        for (const uid of range.split(",").map(Number)) {
          fetched.push(uid);
          yield { uid, source: folders[imap.mailbox.path].messages.get(uid), internalDate: new Date("2026-09-22") };
        }
      }
    };
    return imap;
  };
  return { createClient, fetched };
}

const account = { id: "acc1", host: "imap.example.com", port: 993, security: "ssl", user: "kim" };

test("IMAP: 최신 메일부터 가져오고, 다음에는 새 메일만, 첨부 내용까지 검색된다", async () => {
  const db = openContentIndex(":memory:");
  const folders = {
    INBOX: { uidValidity: 7, messages: new Map([
      [1, eml("주간 보고", "이번 주 서버 점검 완료")],
      [2, eml("견적 요청드립니다", "첨부 확인 부탁드립니다", { name: "견적.txt", text: "WEB 서버 3대 설치 비용 1,200만원" })]
    ]) }
  };
  const server = fakeServer(folders);
  const first = await syncAccount(db, account, "pw", { createClient: server.createClient });
  assert.equal(first.fetched, 2);
  assert.deepEqual(server.fetched, [2, 1], "최신 메일(UID 큰 것)부터");

  // 검색: 첨부파일 내용, 제목
  const entries = mailEntries(db);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ["견적 요청드립니다", "주간 보고"]);
  const hit = searchEntries(entries, "설치 비용", {}, 200, searchContent(db, tokenize("설치 비용")));
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, "견적 요청드립니다");
  assert.equal(hit[0].hits[0].location, "첨부 견적.txt 1번째 줄");
  assert.deepEqual(parseMailPath(hit[0].path), { account: "acc1", folder: "INBOX", uidValidity: "7", uid: 2 });

  // 새 메일 하나만 추가 → 그것만 가져온다
  folders.INBOX.messages.set(3, eml("회의록", "다음 회의는 목요일"));
  server.fetched.length = 0;
  const second = await syncAccount(db, account, "pw", { createClient: server.createClient });
  assert.equal(second.fetched, 1);
  assert.deepEqual(server.fetched, [3]);
  assert.equal(mailEntries(db).length, 3);
});

test("IMAP: 서버의 UIDVALIDITY가 바뀌면 그 폴더를 비우고 다시 가져온다", async () => {
  const db = openContentIndex(":memory:");
  const folders = { INBOX: { uidValidity: 1, messages: new Map([[1, eml("예전 메일", "옛 본문")]]) } };
  const server = fakeServer(folders);
  await syncAccount(db, account, "pw", { createClient: server.createClient });
  folders.INBOX = { uidValidity: 2, messages: new Map([[1, eml("새 번호 메일", "새 본문")]]) };
  await syncAccount(db, account, "pw", { createClient: server.createClient });
  assert.deepEqual(mailEntries(db).map((entry) => entry.name), ["새 번호 메일"]);
  assert.equal(searchContent(db, ["옛"]).size, 0, "예전 폴더 내용은 지워진다");
});
