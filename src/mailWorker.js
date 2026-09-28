"use strict";

// 메일 계정 작업(연결 시험·동기화·원문 받기)을 메인 프로세스 밖에서 한다.
// 네트워크 대기와 메일·첨부 해석(수백 ms~수 초)이 창 입력을 막지 않게 하기 위해서다.
// 비밀번호는 메인 프로세스가 복호화해 메시지로만 넘기고, 여기서는 저장하지 않는다.
const { parentPort, workerData } = require("node:worker_threads");
const { openContentIndex, removeMailFolder } = require("./contentIndex");
const imap = require("./imap");
const pop3 = require("./pop3");

// 계정의 연결 방식(IMAP·POP3)에 맞는 모듈
const protocolOf = (account) => (account?.protocol === "pop3" ? pop3 : imap);
const { stopOcr } = require("./ocr");

const db = openContentIndex(workerData.dbPath, { migrate: false });

// 메일 서버 오류를 사용자가 고칠 수 있는 안내로 바꾼다
function friendlyError(error) {
  const text = [error.code, error.responseText, error.message].filter(Boolean).join(" ");
  if (/NOTPOP3/.test(text)) return "POP3 서버가 아닙니다. 받는 메일 서버(POP3/IMAP) 주소와 포트를 확인하세요. (smtp로 시작하는 주소는 보내는 메일 서버입니다)";
  if (/NoConnection|Connection not available|ETIMEOUT|Socket timeout/.test(text)) return "메일 서버와 연결이 끊겼습니다. 잠시 뒤 다시 가져오기를 누르세요. (받은 메일은 이어서 가져옵니다)";
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return "서버 주소를 찾을 수 없습니다. IMAP 서버 이름을 확인하세요.";
  if (/ECONNREFUSED/.test(text)) return "서버가 연결을 거부했습니다. 포트와 보안 방식을 확인하세요.";
  if (/ETIMEDOUT|timeout|Timeout/.test(text)) return "서버 응답이 없습니다. 포트·보안 방식이나 회사 방화벽을 확인하세요.";
  if (/AUTHENTICATIONFAILED|Invalid credentials|authentication failed|LOGIN failed|auth|password|5\.7\.\d/i.test(text)) return "로그인에 실패했습니다. 아이디와 앱 비밀번호를 확인하세요. (로그인 비밀번호가 아니라 메일 서비스에서 발급받은 앱 비밀번호가 필요합니다)";
  if (/certificate|self.signed|CERT_|UNABLE_TO_VERIFY/i.test(text)) return "서버 인증서를 확인할 수 없습니다. 사내 서버라면 '자체 서명 인증서 허용'을 켜세요.";
  if (/wrong version number|EPROTO|ssl3_get_record/i.test(text)) return "보안 방식이 서버와 맞지 않습니다. SSL/TLS와 STARTTLS를 바꿔 보세요.";
  return error.responseText || error.message || String(error);
}

// 연결 끊김 같은 늦은 오류로 worker가 죽지 않게 한다 (진행 중인 작업은 명령 실패로 알려진다)
process.on("uncaughtException", (error) => console.error("mail worker", error));
process.on("unhandledRejection", (error) => console.error("mail worker", error));

parentPort.on("message", async ({ id, type, account, password, folder, uid }) => {
  try {
    if (type === "test") {
      parentPort.postMessage({ id, result: await protocolOf(account).testConnection(account, password) });
    } else if (type === "sync") {
      const result = await protocolOf(account).syncAccount(db, account, password, {
        onProgress: (progress) => parentPort.postMessage({ type: "progress", progress })
      });
      parentPort.postMessage({ id, result });
    } else if (type === "remove") {
      removeMailFolder(db, account.id);
      parentPort.postMessage({ id, result: true });
    } else if (type === "fetch") {
      const source = account.protocol === "pop3"
        ? await pop3.fetchSource(account, password, uid)
        : await imap.fetchSource(account, password, folder, uid);
      parentPort.postMessage({ id, result: { source: Buffer.from(source).toString("base64") } });
    }
  } catch (error) {
    parentPort.postMessage({ id, error: friendlyError(error) });
  } finally {
    if (type === "sync") stopOcr();
  }
});
