"use strict";

// 파일 내용 추출·색인은 무거워서 메인 프로세스에서 돌리면 창 입력까지 멈춘다 (ADR-0001 결정 3).
// 이 worker가 자기 DB 연결로 색인을 쓰고, 메인 프로세스는 검색용으로 읽기만 한다 (WAL).
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { openContentIndex, indexContent } = require("./contentIndex");
const { IMAGE_EXTENSIONS } = require("./extract");
const { stopOcr } = require("./ocr");

// group: "documents"(문서) 또는 "images"(이미지 OCR). 토큰 재생성은 문서 worker만 한다.
const db = openContentIndex(workerData.dbPath, { migrate: workerData.group !== "images" });
const isImage = (filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).slice(1).toLowerCase());
const owns = workerData.group === "images" ? isImage : (filePath) => !isImage(filePath);

parentPort.on("message", async (message) => {
  if (message.type !== "index") return;
  try {
    const summary = await indexContent(db, message.entries, {
      owns,
      onProgress: (progress) => parentPort.postMessage({ type: "progress", progress })
    });
    parentPort.postMessage({ type: "done", summary });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error.message });
  } finally {
    stopOcr();
  }
});
