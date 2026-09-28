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

function client(account, password) {
  const security = account.security || "ssl";
  return new ImapFlow({
    host: account.host,
    port: Number(account.port),
    secure: security === "ssl",
    // STARTTLS: 평문으로 접속한 뒤 암호화로 바꾼다. "없음"이면 암호화하지 않는다 (화면에서 경고함).
    doSTARTTLS: security === "starttls" ? true : security === "none" ? false : undefined,
    auth: { user: account.user, pass: password },
    logger: false,
    // 사내 메일 서버의 자체 서명 인증서도 접속할 수 있게 한다 (사용자가 직접 입력한 서버)
    tls: { rejectUnauthorized: account.allowSelfSigned === true ? false : true },
    socketTimeout: 60_000
  });
}

const mailPath = (account, folder, uidValidity, uid) => `imap://${account.id}/${encodeURIComponent(folder)}/${uidValidity}/${uid}`;

async function testConnection(account, password) {
  const imap = client(account, password);
  await imap.connect();
  try {
    const folders = await imap.list();
    const inbox = await imap.status("INBOX", { messages: true });
    return { folders: folders.filter((folder) => !folder.flags?.has("\\Noselect")).length, inboxMessages: inbox.messages };
  } finally {
    await imap.logout().catch(() => {});
  }
}

// 계정 하나를 동기화한다. 폴더마다 새 메일(마지막 UID 이후)을 최신 것부터 가져온다.
// options.createClient: 테스트에서 가짜 IMAP 접속을 넣을 때 쓴다.
async function syncAccount(db, account, password, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const imap = (options.createClient || client)(account, password);
  await imap.connect();
  const summary = { folders: 0, fetched: 0, errors: 0 };
  try {
    const folders = (await imap.list()).filter((folder) => !folder.flags?.has("\\Noselect"));
    for (const folder of folders) {
      summary.folders += 1;
      const lock = await imap.getMailboxLock(folder.path, { readOnly: true });
      try {
        const box = imap.mailbox;
        const uidValidity = String(box.uidValidity);
        const cursor = db.prepare("SELECT uid_validity, last_uid FROM mail_folders WHERE account = ? AND folder = ?").get(account.id, folder.path);
        // UIDVALIDITY가 바뀌면 서버가 번호를 새로 매긴 것이라 그 폴더를 처음부터 다시 가져온다.
        if (cursor && cursor.uid_validity !== uidValidity) removeMailFolder(db, account.id, folder.path);
        const lastUid = cursor && cursor.uid_validity === uidValidity ? cursor.last_uid : 0;
        const uids = ((await imap.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || [])
          .filter((uid) => uid > lastUid)
          .sort((a, b) => b - a); // 최신 메일부터
        for (let i = 0; i < uids.length; i += BATCH) {
          const batch = uids.slice(i, i + BATCH);
          for await (const message of imap.fetch(batch.join(","), { uid: true, source: true, internalDate: true }, { uid: true })) {
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
        const maxUid = uids.length ? uids[0] : lastUid;
        db.prepare("INSERT OR REPLACE INTO mail_folders (account, folder, uid_validity, last_uid, synced_at) VALUES (?, ?, ?, ?, ?)")
          .run(account.id, folder.path, uidValidity, maxUid, Date.now());
      } finally {
        lock.release();
      }
    }
  } finally {
    await imap.logout().catch(() => {});
  }
  return summary;
}

// 메일 하나의 원문을 서버에서 받는다 (열기용).
async function fetchSource(account, password, folder, uid) {
  const imap = client(account, password);
  await imap.connect();
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
