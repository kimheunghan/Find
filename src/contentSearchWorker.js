"use strict";

// 파일 내용 검색은 이 worker에서 한다. 내용 DB(수 GB)를 읽느라 몇 초씩 걸릴 때가 있어,
// 파일 이름 검색(검색 worker)과 나눠 두면 이름 결과는 그동안 기다리지 않고 바로 나온다.
const { parentPort, workerData } = require("node:worker_threads");
const { openContentIndex, searchContent, contentHits, contentLookup, searchContentFuzzy } = require("./contentIndex");

const db = openContentIndex(workerData.dbPath, { migrate: false });

// type: match(어느 파일이 맞는지 — 미리보기 없이 빨리) | hits(화면에 보일 파일의 미리보기) | warm(켤 때 미리 준비)
// fuzzy: 오탈자 검색 (검색어와 한 글자만 다른 말로 찾는다)
parentPort.on("message", ({ id, type = "match", terms = [], fuzzy, paths = [] }) => {
  try {
    let result;
    if (type === "warm") result = Boolean(contentLookup(db));
    else if (type === "hits") result = contentHits(db, paths, terms);
    else if (fuzzy) result = searchContentFuzzy(db, terms);
    else result = searchContent(db, terms, { hits: false });
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
