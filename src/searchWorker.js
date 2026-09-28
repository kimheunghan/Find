"use strict";

// 검색은 이 worker에서 한다. 메인 프로세스는 창의 키 입력·한/영 전환(IME) 메시지를 처리하는데,
// 157만 개 목록과 본문 검색(수백 ms~수 초)을 메인에서 돌리면 그동안 입력이 막힌다.
// 파일 목록(수백 MB)도 이 worker만 들고 있어 메인 프로세스는 가볍게 뜬다.
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
const { searchEntries, tokenize, prepareEntries, updateEntries } = require("./search");
const { openContentIndex, searchContent } = require("./contentIndex");
const { SUPPORTED_EXTENSIONS, IMAGE_EXTENSIONS } = require("./extract");

const db = openContentIndex(workerData.dbPath, { migrate: false });
let entries = [];

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

parentPort.on("message", ({ id, type, query, filters }) => {
  try {
    if (type === "load") {
      parentPort.postMessage({ id, result: load() });
    } else if (type === "update") {
      updateEntries(entries, query.added, query.removed);
      parentPort.postMessage({ id, result: { entryCount: entries.length } });
    } else if (type === "search") {
      const stats = {};
      const items = searchEntries(entries, query, filters || {}, 200, searchContent(db, tokenize(query)), stats);
      parentPort.postMessage({ id, result: { items, total: stats.total || 0 } });
    }
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
