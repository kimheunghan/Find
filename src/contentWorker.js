"use strict";

// 파일 내용 추출·색인은 무거워서 메인 프로세스에서 돌리면 창 입력까지 멈춘다 (ADR-0001 결정 3).
// 이 worker가 자기 DB 연결로 색인을 쓰고, 메인 프로세스는 검색용으로 읽기만 한다 (WAL).
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { openContentIndex, indexContent } = require("./contentIndex");
const { IMAGE_EXTENSIONS, PRECISE_OCR_VERSION } = require("./extract");
const { stopOcr } = require("./ocr");

// group: "documents"(문서) 또는 "images"(이미지 OCR). 토큰 재생성은 문서 worker만 한다.
const db = openContentIndex(workerData.dbPath, { migrate: workerData.group === "documents" });
const isImage = (filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).slice(1).toLowerCase());
// delta(폴더 감시 변경분)와 ocr-precise(정밀 판독)는 넘겨받은 파일만 처리하고 다른 기록은 지우지 않는다.
const owns = ["delta", "ocr-precise"].includes(workerData.group) ? () => false
  : workerData.group === "images" ? isImage : (filePath) => !isImage(filePath);
const precise = workerData.group === "ocr-precise";

parentPort.on("message", async (message) => {
  if (message.type !== "index") return;
  try {
    const summary = await indexContent(db, message.entries, {
      owns,
      newestFirst: workerData.group === "images" || precise,
      // 빠른 판독은 OCR 프로세스 2개로 동시에 읽는다
      concurrency: workerData.group === "images" ? 2 : 1,
      extractOptions: { preciseOcr: precise },
      extractor: precise ? PRECISE_OCR_VERSION : undefined,
      onProgress: (progress) => parentPort.postMessage({ type: "progress", progress })
    });
    parentPort.postMessage({ type: "done", summary });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error.message });
  } finally {
    stopOcr();
  }
});
