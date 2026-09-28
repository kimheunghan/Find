"use strict";

// 검색은 이 worker에서 한다. 메인 프로세스는 창의 키 입력·한/영 전환(IME) 메시지를 처리하는데,
// 157만 개 목록과 본문 검색(수백 ms~수 초)을 메인에서 돌리면 그동안 입력이 막힌다.
// 파일 목록(수백 MB)도 이 worker만 들고 있어 메인 프로세스는 가볍게 뜬다.
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
const { searchEntries, tokenize, prepareEntries, updateEntries } = require("./search");
const { openContentIndex, searchContent, mailEntries } = require("./contentIndex");
const { SUPPORTED_EXTENSIONS, IMAGE_EXTENSIONS } = require("./extract");

const db = openContentIndex(workerData.dbPath, { migrate: false });
let entries = [];
let mails = []; // IMAP 메일 목록 (mail_messages)

function reloadMails() {
  mails = mailEntries(db);
  prepareEntries(mails);
  return mails.length;
}

function contentTargets(group) {
  return entries
    .filter((entry) => entry.kind === "file" && SUPPORTED_EXTENSIONS.has(entry.extension)
      && (group === "images") === IMAGE_EXTENSIONS.has(entry.extension))
    .map(({ name, path, kind, extension }) => ({ name, path, kind, extension }));
}

// 색인 파일을 (다시) 읽는다. 예전 파일에는 검색 위치·제외 폴더 설정도 함께 들어 있다.
function load() {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(workerData.indexPath, "utf8"));
  } catch {
    state = {};
  }
  entries = state.entries || [];
  prepareEntries(entries);
  // 마지막 전체 색인 뒤에 폴더 감시로 반영한 변경분
  try {
    const delta = JSON.parse(fs.readFileSync(workerData.deltaPath, "utf8"));
    updateEntries(entries, delta.added || [], delta.removed || []);
  } catch {
    // 변경분 파일이 없으면 그대로
  }
  return {
    entryCount: entries.length,
    errorCount: (state.errors || []).length,
    indexedAt: state.indexedAt || null,
    roots: state.roots || [],
    excludedPaths: state.excludedPaths || [],
    targets: { documents: contentTargets("documents"), images: contentTargets("images") }
  };
}

// 최신순 정렬용 날짜. 파일은 수정한 날짜를 디스크에서 읽어 기억해 두고(목록이 바뀌면 비움), 메일은 보낸 날짜.
const fileTimes = new Map();
function fileTime(entry) {
  let time = fileTimes.get(entry.path);
  if (time === undefined) {
    time = fs.statSync(entry.path, { throwIfNoEntry: false })?.mtimeMs || 0;
    fileTimes.set(entry.path, time);
  }
  return time;
}
// 하루 넘게 미래인 날짜(잘못 적힌 파일 날짜)는 최신순에서 날짜 모름으로
const sortTime = (item) => (item.time > Date.now() + 86_400_000 ? 0 : item.time || 0);
const mailTime = (entry) => Date.parse(entry.date || "") || 0;

parentPort.on("message", ({ id, type, query, filters }) => {
  try {
    if (type === "load") {
      const loaded = load();
      reloadMails();
      parentPort.postMessage({ id, result: { ...loaded, mailCount: mails.length } });
    } else if (type === "mailFolders") {
      const counts = new Map();
      for (const entry of mails) {
        const key = `${entry.account}	${entry.folder}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      parentPort.postMessage({ id, result: [...counts].map(([key, count]) => ({ key, account: key.split("	")[0], folder: key.split("	")[1], count })) });
    } else if (type === "reloadMail") {
      parentPort.postMessage({ id, result: { mailCount: reloadMails() } });
    } else if (type === "update") {
      updateEntries(entries, query.added, query.removed);
      for (const entry of query.added || []) fileTimes.delete(entry.path);
      parentPort.postMessage({ id, result: { entryCount: entries.length } });
    } else if (type === "search") {
      // 분류: pc(파일·폴더), mail(메일 계정), all(둘 다). 메일은 범위·형식 조건을 적용하지 않는다.
      const source = filters?.source || "all";
      const contentMatches = searchContent(db, tokenize(query));
      const pcStats = {};
      const mailStats = {};
      const sort = filters?.sort === "newest" ? "newest" : "relevance";
      const pc = source === "mail" ? [] : searchEntries(entries, query, filters || {}, 200, contentMatches, pcStats, fileTime);
      // 메일 폴더 조건 (메일 탭에서 고른 폴더만). 폴더 키는 "계정	폴더"
      const folderKeys = new Set(filters?.mailFolders || []);
      const mailList = folderKeys.size ? mails.filter((entry) => folderKeys.has(`${entry.account}	${entry.folder}`)) : mails;
      const mail = source === "pc" ? [] : searchEntries(mailList, query, { sort }, 200, contentMatches, mailStats, mailTime);
      const items = [...pc, ...mail]
        .sort(sort === "newest" ? (a, b) => sortTime(b) - sortTime(a) || b.score - a.score : (a, b) => b.score - a.score)
        .slice(0, 200);
      parentPort.postMessage({ id, result: { items, total: (pcStats.total || 0) + (mailStats.total || 0), pcTotal: pcStats.total || 0, mailTotal: mailStats.total || 0 } });
    }
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
