"use strict";

// 파일 내용 검색은 이 worker에서 한다. 내용 DB(수 GB)를 읽느라 몇 초씩 걸릴 때가 있어,
// 파일 이름 검색(검색 worker)과 나눠 두면 이름 결과는 그동안 기다리지 않고 바로 나온다.
const { parentPort, workerData } = require("node:worker_threads");
const { openContentIndex, searchContent, searchContentFuzzy } = require("./contentIndex");

const db = openContentIndex(workerData.dbPath, { migrate: false });

// fuzzy: 오탈자 검색 (검색어와 한 글자만 다른 말로 찾는다)
parentPort.on("message", ({ id, terms, fuzzy }) => {
  try {
    parentPort.postMessage({ id, result: fuzzy ? searchContentFuzzy(db, terms) : searchContent(db, terms) });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
