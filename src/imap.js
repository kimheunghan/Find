"use strict";

// 범용 IMAP 메일 가져오기 (ADR-0004 결정 5). 메일 worker 안에서 돈다.
// - 서버·포트·보안 방식(SSL/TLS·STARTTLS·없음)은 사용자가 입력한 값을 그대로 쓴다 (하드코딩하지 않음).
// - 메일 원문은 PC에 저장하지 않고 추출한 글자와 목록 정보만 저장한다. 열 때 서버에서 다시 받는다.
// - 폴더마다 UIDVALIDITY와 마지막 UID를 저장해 다음부터는 새 메일만 가져온다.
const { ImapFlow } = require("imapflow");
const { parseMail } = require("./mail");
const { mailChunks } = require("./extract");
const { saveMail, removeMailFolder } = require("./contentIndex");

const BATCH = 20;

function client(account, password, loginMethod) {
  const security = account.security || "ssl";
  return new ImapFlow({
    host: account.host,
    port: Number(account.port),
    secure: security === "ssl",
    // STARTTLS: 평문으로 접속한 뒤 암호화로 바꾼다. "없음"이면 암호화하지 않는다 (화면에서 경고함).
    doSTARTTLS: security === "starttls" ? true : security === "none" ? false : undefined,
    auth: loginMethod ? { user: account.user, pass: password, loginMethod } : { user: account.user, pass: password },
    logger: false,
    // 사내 메일 서버의 자체 서명 인증서도 접속할 수 있게 한다 (사용자가 직접 입력한 서버)
    tls: { rejectUnauthorized: account.allowSelfSigned === true ? false : true },
    socketTimeout: 60_000
  });
}

// 접속하고 로그인한다. 일부 서버(예: 메일플러그)는 AUTHENTICATE PLAIN을 지원한다고 알리고도
// "invalid command"로 거부하므로, 그때는 기본 LOGIN 명령으로 다시 시도한다.
async function connect(account, password, createClient = client) {
  const imap = createClient(account, password);
  try {
    imap.on?.("error", () => {}); // 처리기가 없으면 끊김 오류가 프로세스 전체 오류가 된다
    await imap.connect();
    return imap;
  } catch (error) {
    const rejectedMethod = error.responseStatus === "BAD" || /invalid command/i.test(error.responseText || error.message || "");
    if (!rejectedMethod || createClient !== client) throw error;
    const retry = client(account, password, "LOGIN");
    retry.on("error", () => {});
    await retry.connect();
    return retry;
  }
}

const mailPath = (account, folder, uidValidity, uid) => `imap://${account.id}/${encodeURIComponent(folder)}/${uidValidity}/${uid}`;

async function testConnection(account, password) {
  const imap = await connect(account, password);
  try {
    const folders = await imap.list();
    const inbox = await imap.status("INBOX", { messages: true });
    return { folders: folders.filter((folder) => !folder.flags?.has("\\Noselect")).length, inboxMessages: inbox.messages };
  } finally {
    await imap.logout().catch(() => {});
  }
}

// 계정 하나를 동기화한다. 폴더마다 새 메일(마지막 UID 이후)을 최신 것부터 가져온다.
// 메일 원문은 묶음(BATCH)마다 먼저 모두 받은 뒤에 해석한다. 받는 도중에 첨부 OCR처럼 오래 걸리는 일을 하면
// FETCH 응답이 멈춘 것으로 보여 연결이 끊기기 때문이다. 그래도 끊기면 다시 접속해 이어서 받는다.
// options.createClient: 테스트에서 가짜 IMAP 접속을 넣을 때 쓴다.
async function syncAccount(db, account, password, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const createClient = options.createClient || client;
  const summary = { folders: 0, fetched: 0, errors: 0 };
  let imap = null;
  const open = async () => {
    if (imap && imap.usable !== false) return imap;
    if (imap) imap.close?.();
    imap = await connect(account, password, createClient);
    imap.on?.("error", () => {}); // 끊김은 다음 명령에서 오류로 받아 다시 접속한다
    return imap;
  };
  // 접속이 끊겨 실패하면 다시 접속해 3번까지 시도한다
  const withRetry = async (task) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await task(await open());
      } catch (error) {
        const lost = imap?.usable === false || /NoConnection|Connection not available|ETIMEOUT|Socket timeout|ECONNRESET|EPIPE|closed/i.test(`${error.code} ${error.message}`);
        if (!lost || attempt >= 3) throw error;
      }
    }
  };
  const inFolder = (folder, task) => withRetry(async (connection) => {
    const lock = await connection.getMailboxLock(folder, { readOnly: true });
    try {
      return await task(connection);
    } finally {
      lock.release();
    }
  });
  try {
    const folders = (await withRetry((connection) => connection.list())).filter((folder) => !folder.flags?.has("\Noselect"));
    for (const folder of folders) {
      summary.folders += 1;
      const { uidValidity, uids: found } = await inFolder(folder.path, async (connection) => {
        const current = String(connection.mailbox.uidValidity);
        const cursor = db.prepare("SELECT uid_validity, last_uid FROM mail_folders WHERE account = ? AND folder = ?").get(account.id, folder.path);
        const lastUid = cursor && cursor.uid_validity === current ? cursor.last_uid : 0;
        const uids = ((await connection.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []).filter((uid) => uid > lastUid);
        return { uidValidity: current, uids, cursor, lastUid };
      }).then((result) => {
        // UIDVALIDITY가 바뀌면 서버가 번호를 새로 매긴 것이라 그 폴더를 처음부터 다시 가져온다.
        if (result.cursor && result.cursor.uid_validity !== result.uidValidity) removeMailFolder(db, account.id, folder.path);
        return result;
      });
      // 지난번에 중간까지 받은 메일은 건너뛴다
      const known = new Set(db.prepare("SELECT path FROM mail_messages WHERE account = ? AND folder = ?").all(account.id, folder.path).map((row) => row.path));
      const uids = found.filter((uid) => !known.has(mailPath(account, folder.path, uidValidity, uid))).sort((a, b) => b - a); // 최신 메일부터
      for (let i = 0; i < uids.length; i += BATCH) {
        const batch = uids.slice(i, i + BATCH);
        const messages = await inFolder(folder.path, async (connection) => {
          const list = [];
          for await (const message of connection.fetch(batch.join(","), { uid: true, source: true, internalDate: true }, { uid: true })) list.push(message);
          return list;
        });
        for (const message of messages) {
          try {
            const mail = await parseMail(message.source, "eml");
            if (!mail.date && message.internalDate) mail.date = new Date(message.internalDate).toISOString();
            const chunks = await mailChunks(mail, options.extractOptions || {}, 0);
            await saveMail(db, {
              path: mailPath(account, folder.path, uidValidity, message.uid),
              account: account.id,
              folder: folder.path,
              uid: message.uid,
              subject: mail.subject,
              sender: mail.from,
              recipients: [mail.to, mail.cc].filter(Boolean).join(", "),
              date: mail.date,
              size: message.source.length,
              attachments: (mail.attachments || []).map((attachment) => attachment.name).join(", ")
            }, chunks);
            summary.fetched += 1;
          } catch {
            summary.errors += 1;
          }
        }
        onProgress({ account: account.id, folder: folder.path, done: Math.min(i + BATCH, uids.length), total: uids.length, fetched: summary.fetched });
      }
      // 폴더를 끝까지 가져온 뒤에만 마지막 UID를 옮긴다 (중간에 끊기면 다음에 이어서, 이미 받은 메일은 건너뜀)
      const maxUid = found.length ? Math.max(...found) : (db.prepare("SELECT last_uid FROM mail_folders WHERE account = ? AND folder = ? AND uid_validity = ?").get(account.id, folder.path, uidValidity)?.last_uid || 0);
      db.prepare("INSERT OR REPLACE INTO mail_folders (account, folder, uid_validity, last_uid, synced_at) VALUES (?, ?, ?, ?, ?)")
        .run(account.id, folder.path, uidValidity, maxUid, Date.now());
    }
  } finally {
    await imap?.logout().catch(() => {});
  }
  return summary;
}

// 메일 하나의 원문을 서버에서 받는다 (열기용).
async function fetchSource(account, password, folder, uid) {
  const imap = await connect(account, password);
  try {
    const lock = await imap.getMailboxLock(folder, { readOnly: true });
    try {
      const message = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (!message?.source) throw new Error("서버에서 메일을 찾지 못했습니다 (삭제되었거나 옮겨졌을 수 있습니다)");
      return message.source;
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout().catch(() => {});
  }
}

function parseMailPath(mailUri) {
  const match = /^imap:\/\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)$/.exec(mailUri);
  if (!match) return null;
  return { account: match[1], folder: decodeURIComponent(match[2]), uidValidity: match[3], uid: Number(match[4]) };
}

module.exports = { testConnection, syncAccount, fetchSource, parseMailPath, mailPath };
