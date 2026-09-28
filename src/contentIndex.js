"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { MAX_FILE_SIZE, IMAGE_EXTENSIONS, SUPPORTED_EXTENSIONS, EXTRACTOR_VERSIONS, extractFile, describeLocation, resolveLocation } = require("./extract");
const { TOKENIZER_VERSION, toTokens, toChars, textRuns, singleChar, needsScan, toMatchPhrase } = require("./tokens");
const { displayText, findRanges, termRegex, isStrictTerm } = require("./renderer/highlight");

// 이미지 OCR은 한 장에 수 초가 걸린다. 아이콘 같은 작은 이미지와 시스템·앱·캐시 폴더의 이미지는 건너뛴다.
const MIN_OCR_IMAGE_SIZE = 15 * 1024;
const OCR_SKIP_PATH = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)\\|\\(appdata|node_modules|\.git|\.vscode|\.gradle|\.cache|\.m2|\.nuget|\.npm)\\/i;
const HITS_PER_FILE = 3;
const SNIPPET_RADIUS = 40;

// migrate: 토큰화 규칙이 바뀌었을 때 토큰을 다시 만들지 여부. 수 분이 걸릴 수 있어
// 메인 프로세스(검색용)는 false로 열고, 색인 worker가 맡는다.
function openContentIndex(dbPath, { migrate = true } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 30000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      size INTEGER,
      modified_at INTEGER,
      status TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      location TEXT,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(tokens, content='', contentless_delete=1);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_chars USING fts5(chars, content='', contentless_delete=1);
  `);
  // 형식별 추출 방식 버전(extract.js EXTRACTOR_VERSIONS). 예전 DB에는 열이 없어 추가한다.
  if (!db.prepare("PRAGMA table_info(files)").all().some((column) => column.name === "extractor")) {
    try {
      db.exec("ALTER TABLE files ADD COLUMN extractor INTEGER");
    } catch {
      // 다른 연결(메인·worker)이 먼저 추가했으면 그대로 쓴다.
    }
  }

  // 토큰화 방식이 바뀌면 이전 색인과 섞이지 않도록 전체를 다시 만든다 (ADR-0002).
  const version = db.prepare("SELECT value FROM meta WHERE key = 'tokenizer'").get();
  if (migrate && (!version || Number(version.value) !== TOKENIZER_VERSION)) retokenize(db);
  return db;
}

// 토큰화 규칙이 바뀌면 저장된 본문(chunks.text)으로 토큰만 다시 만든다. 파일을 다시 추출하지 않아 빠르다.
function retokenize(db) {
  transaction(db, () => {
    db.exec("INSERT INTO chunk_fts (chunk_fts) VALUES ('delete-all')");
    db.exec("INSERT INTO chunk_chars (chunk_chars) VALUES ('delete-all')");
    const insert = db.prepare("INSERT INTO chunk_fts (rowid, tokens) VALUES (?, ?)");
    const insertChars = db.prepare("INSERT INTO chunk_chars (rowid, chars) VALUES (?, ?)");
    for (const row of db.prepare("SELECT id, text FROM chunks").iterate()) {
      insert.run(row.id, toTokens(row.text).join(" "));
      insertChars.run(row.id, toChars(row.text).join(" "));
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tokenizer', ?)").run(String(TOKENIZER_VERSION));
  });
}

function removeChunks(db, fileId) {
  db.prepare("DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)").run(fileId);
  db.prepare("DELETE FROM chunk_chars WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)").run(fileId);
  db.prepare("DELETE FROM chunks WHERE file_id = ?").run(fileId);
}

// 문서 worker와 OCR worker가 같은 DB에 동시에 쓴다. 그냥 BEGIN은 읽다가 쓰기로 바뀌는 순간 다른 쪽이 먼저 썼으면
// 기다리지 않고 바로 "database is locked"로 실패한다. IMMEDIATE로 시작부터 쓰기 잠금을 잡아 busy_timeout만큼 기다린다.
function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function extractorVersion(filePath) {
  return EXTRACTOR_VERSIONS[path.extname(filePath).slice(1).toLowerCase()] || 1;
}

function saveFile(db, filePath, stat, status, chunks, error) {
  transaction(db, () => {
    const existing = db.prepare("SELECT id FROM files WHERE path = ?").get(filePath);
    const extractor = extractorVersion(filePath);
    let fileId;
    if (existing) {
      fileId = existing.id;
      removeChunks(db, fileId);
      db.prepare("UPDATE files SET size = ?, modified_at = ?, status = ?, error = ?, extractor = ? WHERE id = ?")
        .run(stat.size, Math.trunc(stat.mtimeMs), status, error || null, extractor, fileId);
    } else {
      fileId = db.prepare("INSERT INTO files (path, size, modified_at, status, error, extractor) VALUES (?, ?, ?, ?, ?, ?)")
        .run(filePath, stat.size, Math.trunc(stat.mtimeMs), status, error || null, extractor).lastInsertRowid;
    }
    const insertChunk = db.prepare("INSERT INTO chunks (file_id, location, text) VALUES (?, ?, ?)");
    const insertTokens = db.prepare("INSERT INTO chunk_fts (rowid, tokens) VALUES (?, ?)");
    const insertChars = db.prepare("INSERT INTO chunk_chars (rowid, chars) VALUES (?, ?)");
    for (const chunk of chunks) {
      const chunkId = insertChunk.run(fileId, JSON.stringify(chunk.location || null), chunk.text).lastInsertRowid;
      insertTokens.run(chunkId, toTokens(chunk.text).join(" "));
      insertChars.run(chunkId, toChars(chunk.text).join(" "));
    }
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// DB가 잠겨 저장하지 못하면 잠시 뒤 다시 시도한다. 끝내 실패하면 그 파일만 건너뛴다 (다음 색인 때 다시 시도).
async function safeSave(db, ...args) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      saveFile(db, ...args);
      return true;
    } catch (error) {
      if (!/locked|busy/i.test(error.message)) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  return false;
}

// 이름 색인 결과(entries) 중 지원 형식 파일의 내용을 추출한다. 크기·수정 시각이 같으면 건너뛴다.
async function indexContent(db, entries, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const supported = entries.filter((entry) => entry.kind === "file" && SUPPORTED_EXTENSIONS.has(entry.extension));
  // 문서를 먼저 색인하고, 오래 걸리는 이미지 OCR은 맨 뒤로 보낸다.
  let targets = [
    ...supported.filter((entry) => !IMAGE_EXTENSIONS.has(entry.extension)),
    ...supported.filter((entry) => IMAGE_EXTENSIONS.has(entry.extension))
  ];
  // newestFirst: 최근에 바뀐 파일부터 처리한다 (이미지 OCR은 한 장에 수 초라, 방금 만든 캡처를 먼저 찾을 수 있게).
  if (options.newestFirst) {
    const stamped = [];
    for (const entry of targets) {
      const modified = await fs.stat(entry.path).then((stat) => stat.mtimeMs, () => 0);
      stamped.push([modified, entry]);
    }
    targets = stamped.sort((a, b) => b[0] - a[0]).map(([, entry]) => entry);
  }
  // options.owns(path): 이 작업이 맡은 파일인지 (문서 worker와 OCR worker가 동시에 돌 때 서로의 기록을 지우지 않게)
  const owns = options.owns || (() => true);
  const known = new Map(db.prepare("SELECT id, path, size, modified_at, status FROM files").all()
    .filter((row) => owns(row.path))
    .map((row) => [row.path, row]));
  const summary = { total: targets.length, extracted: 0, skipped: 0, errors: 0 };

  for (const [index, entry] of targets.entries()) {
    known.delete(entry.path);
    let stat;
    try {
      stat = await fs.stat(entry.path);
    } catch {
      continue;
    }
    const previous = db.prepare("SELECT size, modified_at, status, extractor FROM files WHERE path = ?").get(entry.path);
    const unchanged = previous && previous.size === stat.size && previous.modified_at === Math.trunc(stat.mtimeMs);
    // 추출 방식이 바뀐 형식은 파일이 그대로여도 다시 추출한다 (예전 행은 extractor가 비어 있어 1로 본다).
    const sameExtractor = previous && (previous.extractor || 1) >= extractorVersion(entry.path);
    if (unchanged && sameExtractor && previous.status !== "error") {
      summary.skipped += 1;
    } else if (stat.size === 0) {
      await safeSave(db, entry.path, stat, "empty", []);
      summary.skipped += 1;
    } else if (stat.size > MAX_FILE_SIZE) {
      await safeSave(db, entry.path, stat, "too_large", []);
      summary.skipped += 1;
    } else if (IMAGE_EXTENSIONS.has(entry.extension) && (stat.size < MIN_OCR_IMAGE_SIZE || OCR_SKIP_PATH.test(entry.path))) {
      await safeSave(db, entry.path, stat, "ocr_skipped", []);
      summary.skipped += 1;
    } else {
      let chunks = null;
      let failure = null;
      try {
        chunks = await extractFile(entry.path) || [];
      } catch (error) {
        failure = error;
      }
      const saved = failure
        ? await safeSave(db, entry.path, stat, "error", [], failure.message)
        : await safeSave(db, entry.path, stat, "done", chunks);
      if (failure || !saved) summary.errors += 1;
      else summary.extracted += 1;
    }
    if ((index + 1) % 20 === 0 || index + 1 === targets.length) {
      onProgress({ done: index + 1, total: targets.length, current: entry.path });
    }
  }

  // 이름 색인에서 사라진 파일(삭제·제외·검색 위치에서 빠짐)은 내용 색인에서도 지운다.
  transaction(db, () => {
    for (const row of known.values()) {
      removeChunks(db, row.id);
      db.prepare("DELETE FROM files WHERE id = ?").run(row.id);
    }
  });
  return summary;
}

// 미리보기는 정규화한 글자(displayText)에서 잘라 낸다. 원문과 정규화 결과의 글자 수가 달라
// 강조 위치가 밀리는 문제(예: "사양" 검색에 "양과"가 강조됨)를 막는다.
function makeSnippet(rawText, term) {
  const text = displayText(rawText);
  const [range] = findRanges(text, [term]);
  if (!range) {
    const head = text.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, " ");
    return { before: head, match: "", after: text.length > SNIPPET_RADIUS * 2 ? "…" : "" };
  }
  const [at, until] = range;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, until + SNIPPET_RADIUS);
  return {
    at,
    before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`.replace(/\s+/g, " "),
    match: text.slice(at, until).replace(/\s+/g, " "),
    after: `${text.slice(until, end)}${end < text.length ? "…" : ""}`.replace(/\s+/g, " ")
  };
}

// 검색어와 일치하는 모든 파일을 찾고, 파일마다 미리보기용 조각을 최대 HITS_PER_FILE개 돌려준다.
// 조각 수로 자르면(예: 5,000개) 조각이 많은 파일이 목록을 채워 다른 파일이 빠지므로, 먼저 id만 모두 모은다.
function rowsForTerm(db, term) {
  let candidates;
  const char = singleChar(term);
  if (char) {
    candidates = db.prepare(`
      SELECT chunks.id, chunks.file_id FROM chunk_chars JOIN chunks ON chunks.id = chunk_chars.rowid
      WHERE chunk_chars MATCH ? ORDER BY chunks.file_id, chunks.id
    `).all(`"${char}"`);
  } else if (needsScan(term)) {
    // "21세", "3층", "설 치"처럼 한 글자 묶음이 섞인 검색어: 2.5GB 본문을 훑으면 수십 초가 걸리므로
    // 묶음마다 색인(한 글자는 글자 색인, 나머지는 토큰 색인)으로 찾아 교집합을 낸 뒤, 붙어 있는지는 아래에서 본문으로 확인한다.
    const parts = [];
    const params = [];
    for (const run of textRuns(term)) {
      const one = singleChar(run);
      if (one) {
        parts.push("SELECT rowid FROM chunk_chars WHERE chunk_chars MATCH ?");
        params.push(`"${one}"`);
      } else {
        const phrase = toMatchPhrase(run);
        if (!phrase) continue;
        parts.push("SELECT rowid FROM chunk_fts WHERE chunk_fts MATCH ?");
        params.push(phrase);
      }
    }
    if (!parts.length) return [];
    candidates = db.prepare(`
      SELECT chunks.id, chunks.file_id FROM chunks WHERE chunks.id IN (${parts.join(" INTERSECT ")})
      ORDER BY chunks.file_id, chunks.id
    `).all(...params);
  } else {
    const phrase = toMatchPhrase(term);
    if (!phrase) return [];
    candidates = db.prepare(`
      SELECT chunks.id, chunks.file_id FROM chunk_fts JOIN chunks ON chunks.id = chunk_fts.rowid
      WHERE chunk_fts MATCH ? ORDER BY chunks.file_id, chunks.id
    `).all(phrase);
  }

  // IP·번호처럼 문장부호가 든 검색어는 글자 그대로 들어 있는 조각만 인정한다 ("10.0.3.21" ≠ "10,0,3,21").
  // 교집합으로 찾은 검색어(needsScan)도 실제로 붙어 있는지 본문으로 확인한다.
  const strict = isStrictTerm(term) || needsScan(term) ? termRegex(term) : null;
  const readChunk = db.prepare(`
    SELECT chunks.id, chunks.location, chunks.text, files.path
    FROM chunks JOIN files ON files.id = chunks.file_id WHERE chunks.id = ?
  `);
  const rows = [];
  let fileId = null;
  let taken = 0;
  for (const candidate of candidates) {
    if (candidate.file_id !== fileId) {
      fileId = candidate.file_id;
      taken = 0;
    }
    if (taken >= HITS_PER_FILE) continue;
    const row = readChunk.get(candidate.id);
    // 검색하는 사이 색인 worker가 그 파일을 다시 추출하면 조각이 지워져 있을 수 있다. 그런 조각은 건너뛴다.
    if (!row) continue;
    if (strict && !new RegExp(strict.source, "iu").test(displayText(row.text))) continue;
    rows.push(row);
    taken += 1;
  }
  return rows;
}

// 검색어별로 내용이 일치한 파일을 찾는다. 반환값: Map<경로, { terms: Set<검색어>, hits: [{ location, snippet }] }>
function searchContent(db, terms) {
  const matches = new Map();
  for (const term of terms) {
    for (const row of rowsForTerm(db, term)) {
      let match = matches.get(row.path);
      if (!match) {
        match = { terms: new Set(), hits: [], chunkIds: new Set() };
        matches.set(row.path, match);
      }
      match.terms.add(term);
      if (match.hits.length < HITS_PER_FILE && !match.chunkIds.has(row.id)) {
        match.chunkIds.add(row.id);
        const snippet = makeSnippet(row.text, term);
        match.hits.push({ location: describeLocation(resolveLocation(JSON.parse(row.location), snippet.at)), snippet });
      }
    }
  }
  for (const match of matches.values()) delete match.chunkIds;
  return matches;
}

function contentStats(db) {
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM files GROUP BY status").all();
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

module.exports = { openContentIndex, indexContent, searchContent, contentStats, makeSnippet };
