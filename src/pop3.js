"use strict";

// POP3 메일 가져오기. POP3는 폴더 없이 받은편지함만 있고, 메일마다 고유 번호(UIDL)가 있다.
// - 서버의 메일은 지우지 않는다 (DELE를 보내지 않음).
// - 이미 받은 메일은 UIDL로 구분해 새 메일만, 최신 메일(번호가 큰 것)부터 가져온다.
// - 메일 원문은 저장하지 않고, 열 때 UIDL로 찾아 다시 받는다.
const net = require("node:net");
const tls = require("node:tls");
const { parseMail } = require("./mail");
const { mailChunks } = require("./extract");
const { saveMail } = require("./contentIndex");

const FOLDER = "받은편지함";
const TIMEOUT_MS = 60_000;

// 아주 작은 POP3 접속: 명령 한 줄을 보내고 응답(한 줄 또는 "."로 끝나는 여러 줄)을 받는다.
class Pop3Connection {
  constructor(account) {
    this.account = account;
    this.buffer = Buffer.alloc(0);
    this.waiting = null;
  }

  attach(socket) {
    this.socket = socket;
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("ETIMEDOUT: 서버 응답 시간 초과")));
    socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.pump();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("서버가 연결을 끊었습니다")));
  }

  fail(error) {
    if (!this.waiting) return;
    const { reject } = this.waiting;
    this.waiting = null;
    reject(error);
  }

  pump() {
    if (!this.waiting) return;
    const { multiline, resolve, reject } = this.waiting;
    const firstEnd = this.buffer.indexOf("\r\n");
    if (firstEnd < 0) return;
    const status = this.buffer.subarray(0, firstEnd).toString("latin1");
    if (!status.startsWith("+OK")) {
      this.buffer = this.buffer.subarray(firstEnd + 2);
      this.waiting = null;
      reject(new Error(status.startsWith("-ERR") ? (status.slice(5) || "POP3 오류") : `NOTPOP3 ${status.slice(0, 80)}`));
      return;
    }
    if (!multiline) {
      this.buffer = this.buffer.subarray(firstEnd + 2);
      this.waiting = null;
      resolve({ status, data: null });
      return;
    }
    const end = this.buffer.indexOf("\r\n.\r\n", firstEnd);
    const emptyEnd = this.buffer.subarray(firstEnd + 2, firstEnd + 5).toString("latin1") === ".\r\n";
    if (end < 0 && !emptyEnd) return;
    const bodyEnd = emptyEnd ? firstEnd + 2 : end + 2;
    const raw = this.buffer.subarray(firstEnd + 2, bodyEnd);
    this.buffer = this.buffer.subarray(emptyEnd ? firstEnd + 5 : end + 5);
    this.waiting = null;
    // 줄 맨 앞의 ".."은 "."로 되돌린다 (dot-stuffing)
    resolve({ status, data: Buffer.from(raw.toString("latin1").replace(/^\.\./gm, "."), "latin1") });
  }

  read(multiline = false) {
    return new Promise((resolve, reject) => {
      this.waiting = { multiline, resolve, reject };
      this.pump();
    });
  }

  command(line, multiline = false) {
    const reply = this.read(multiline);
    this.socket.write(`${line}\r\n`);
    return reply;
  }

  async connect() {
    const { host, port, security, allowSelfSigned } = this.account;
    const tlsOptions = { host, servername: host, rejectUnauthorized: allowSelfSigned !== true };
    const socket = security === "ssl"
      ? tls.connect({ ...tlsOptions, port: Number(port) })
      : net.connect({ host, port: Number(port) });
    this.attach(socket);
    await this.read(); // 인사말
    if (security === "starttls") {
      await this.command("STLS");
      socket.removeAllListeners("data");
      const secure = tls.connect({ ...tlsOptions, socket });
      await new Promise((resolve, reject) => { secure.once("secureConnect", resolve); secure.once("error", reject); });
      this.buffer = Buffer.alloc(0);
      this.attach(secure);
    }
    await this.command(`USER ${this.account.user}`);
    try {
      await this.command(`PASS ${this.password}`);
    } catch (error) {
      throw new Error(`AUTHENTICATIONFAILED ${error.message}`);
    }
  }

  // [{ number, uid }]
  async uidl() {
    const { data } = await this.command("UIDL", true);
    return data.toString("latin1").split("\r\n").filter(Boolean).map((line) => {
      const [number, uid] = line.trim().split(/\s+/);
      return { number: Number(number), uid };
    });
  }

  async retrieve(number) {
    return (await this.command(`RETR ${number}`, true)).data;
  }

  async quit() {
    try {
      await this.command("QUIT");
    } catch {
      // 이미 끊겼으면 그대로
    }
    this.socket?.destroy();
  }
}

async function open(account, password) {
  const connection = new Pop3Connection(account);
  connection.password = password;
  await connection.connect();
  return connection;
}

const mailPath = (account, uid) => `pop3://${account.id}/${encodeURIComponent(FOLDER)}/0/${encodeURIComponent(uid)}`;

async function testConnection(account, password) {
  const connection = await open(account, password);
  try {
    return { folders: 1, inboxMessages: (await connection.uidl()).length };
  } finally {
    await connection.quit();
  }
}

async function syncAccount(db, account, password, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const connection = await open(account, password);
  const summary = { folders: 1, fetched: 0, errors: 0 };
  try {
    const known = new Set(db.prepare("SELECT path FROM mail_messages WHERE account = ?").all(account.id).map((row) => row.path));
    const fresh = (await connection.uidl())
      .filter((item) => !known.has(mailPath(account, item.uid)))
      .sort((a, b) => b.number - a.number); // 최신 메일부터
    for (const [index, item] of fresh.entries()) {
      try {
        const source = await connection.retrieve(item.number);
        const mail = await parseMail(source, "eml");
        const chunks = await mailChunks(mail, options.extractOptions || {}, 0);
        await saveMail(db, {
          path: mailPath(account, item.uid),
          account: account.id,
          folder: FOLDER,
          uid: item.number,
          subject: mail.subject,
          sender: mail.from,
          recipients: [mail.to, mail.cc].filter(Boolean).join(", "),
          date: mail.date,
          size: source.length,
          attachments: (mail.attachments || []).map((attachment) => attachment.name).join(", ")
        }, chunks);
        summary.fetched += 1;
      } catch (error) {
        if (!connection.socket || connection.socket.destroyed) throw error;
        summary.errors += 1;
      }
      if ((index + 1) % 10 === 0 || index + 1 === fresh.length) {
        onProgress({ account: account.id, folder: FOLDER, done: index + 1, total: fresh.length, fetched: summary.fetched });
      }
    }
  } finally {
    await connection.quit();
  }
  return summary;
}

// 열기: UIDL로 지금 번호를 찾아 원문을 받는다 (POP3의 번호는 접속할 때마다 바뀔 수 있다)
async function fetchSource(account, password, uid) {
  const connection = await open(account, password);
  try {
    const item = (await connection.uidl()).find((entry) => entry.uid === uid);
    if (!item) throw new Error("서버에서 메일을 찾지 못했습니다 (삭제되었을 수 있습니다)");
    return await connection.retrieve(item.number);
  } finally {
    await connection.quit();
  }
}

function parsePopPath(mailUri) {
  const match = /^pop3:\/\/([^/]+)\/[^/]+\/0\/(.+)$/.exec(mailUri);
  return match ? { account: match[1], uid: decodeURIComponent(match[2]) } : null;
}

module.exports = { testConnection, syncAccount, fetchSource, parsePopPath, mailPath, FOLDER };
