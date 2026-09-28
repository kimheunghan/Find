"use strict";

// POP3: 테스트 안에 가짜 POP3 서버를 띄워 로그인·새 메일만·최신순·서버 메일 보존·첨부 내용 검색·열기를 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const pop3 = require("../src/pop3");
const { openContentIndex, searchContent, mailEntries } = require("../src/contentIndex");
const { searchEntries, tokenize } = require("../src/search");

function eml(subject, body, attachment) {
  const boundary = `b${Math.random().toString(36).slice(2)}`;
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  // 본문은 8bit 그대로 두고, "."로 시작하는 줄(dot-stuffing 대상)을 넣는다
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n.점으로 시작하는 줄\r\n`];
  if (attachment) parts.push(`--${boundary}\r\nContent-Type: text/plain; name="${enc(attachment.name)}"\r\nContent-Disposition: attachment; filename="${enc(attachment.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(attachment.text, "utf8").toString("base64")}\r\n`);
  return [`From: kim@corp.co.kr`, `To: lee@corp.co.kr`, `Subject: ${enc(subject)}`, `Date: Tue, 22 Sep 2026 09:30:00 +0900`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, `--${boundary}--`, ""].join("\r\n");
}

function fakePop3(messages) {
  const log = [];
  const server = net.createServer((socket) => {
    socket.write("+OK fake pop3 ready\r\n");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      let at;
      while ((at = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const [command, arg] = line.split(" ");
        log.push(command);
        if (command === "USER") socket.write("+OK\r\n");
        else if (command === "PASS") socket.write(arg === "secret" ? "+OK logged in\r\n" : "-ERR [AUTH] invalid password\r\n");
        else if (command === "UIDL") socket.write(`+OK\r\n${messages.map((m, i) => `${i + 1} ${m.uid}`).join("\r\n")}\r\n.\r\n`);
        else if (command === "RETR") {
          const body = messages[Number(arg) - 1].source.replace(/^\./gm, "..");
          socket.write(`+OK\r\n${body}\r\n.\r\n`);
        } else if (command === "QUIT") socket.end("+OK bye\r\n");
        else socket.write("-ERR unknown\r\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, log })));
}

test("POP3: 로그인 후 새 메일만 최신순으로 가져오고, 서버 메일은 지우지 않으며, 첨부 내용까지 검색된다", async () => {
  const messages = [
    { uid: "a-001", source: eml("주간 보고", "서버 점검 완료") },
    { uid: "a-002", source: eml("견적 요청", "첨부 확인 부탁", { name: "견적.txt", text: "WEB 서버 설치 비용 1,200만원" }) }
  ];
  const { server, port, log } = await fakePop3(messages);
  const account = { id: "pop1", protocol: "pop3", host: "127.0.0.1", port, security: "none", user: "kim" };
  try {
    await assert.rejects(pop3.testConnection(account, "wrong"), /AUTHENTICATIONFAILED/);
    assert.deepEqual(await pop3.testConnection(account, "secret"), { folders: 1, inboxMessages: 2 });

    const db = openContentIndex(":memory:");
    log.length = 0;
    const first = await pop3.syncAccount(db, account, "secret");
    assert.equal(first.fetched, 2);
    assert.deepEqual(log.filter((c) => c === "RETR").length, 2);
    assert.ok(!log.includes("DELE"), "서버의 메일을 지우지 않는다");
    assert.deepEqual(mailEntries(db).map((e) => e.name).sort(), ["견적 요청", "주간 보고"]);

    const entries = mailEntries(db);
    const hit = searchEntries(entries, "설치 비용", {}, 200, searchContent(db, tokenize("설치 비용")));
    assert.equal(hit[0].name, "견적 요청");
    assert.equal(hit[0].hits[0].location, "첨부 견적.txt 1번째 줄");
    assert.equal(searchEntries(entries, "점으로", {}, 200, searchContent(db, tokenize("점으로"))).length, 2, "dot-stuffing 복원");

    // 새 메일 하나 추가 → 그것만
    messages.push({ uid: "a-003", source: eml("회의록", "다음 회의는 목요일") });
    log.length = 0;
    const second = await pop3.syncAccount(db, account, "secret");
    assert.equal(second.fetched, 1);
    assert.equal(log.filter((c) => c === "RETR").length, 1);

    // 열기: UIDL로 찾아 원문을 받는다
    const target = pop3.parsePopPath(hit[0].path);
    const source = await pop3.fetchSource(account, "secret", target.uid);
    assert.match(source.toString("utf8"), /Content-Type: multipart\/mixed/);
  } finally {
    server.close();
  }
});
