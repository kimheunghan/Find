"use strict";

const fs = require("node:fs/promises");
const { DatabaseSync } = require("node:sqlite");
const { MAX_FILE_SIZE, SUPPORTED_EXTENSIONS, extractFile, describeLocation } = require("./extract");
const { TOKENIZER_VERSION, normalizeText, toTokens, needsScan, toMatchPhrase } = require("./tokens");

const HITS_PER_FILE = 3;
const ROWS_PER_TERM = 5000;
const SNIPPET_RADIUS = 40;

function openContentIndex(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
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
  `);

  // 토큰화 방식이 바뀌면 이전 색인과 섞이지 않도록 전체를 다시 만든다 (ADR-0002).
  const version = db.prepare("SELECT value FROM meta WHERE key = 'tokenizer'").get();
  if (!version || Number(version.value) !== TOKENIZER_VERSION) {
    db.exec("DELETE FROM chunk_fts; DELETE FROM chunks; DELETE FROM files;");
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tokenizer', ?)").run(String(TOKENIZER_VERSION));
  }
  return db;
}

function removeChunks(db, fileId) {
  db.prepare("DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)").run(fileId);
  db.prepare("DELETE FROM chunks WHERE file_id = ?").run(fileId);
}

function transaction(db, work) {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function saveFile(db, filePath, stat, status, chunks, error) {
  transaction(db, () => {
    const existing = db.prepare("SELECT id FROM files WHERE path = ?").get(filePath);
    let fileId;
    if (existing) {
      fileId = existing.id;
      removeChunks(db, fileId);
      db.prepare("UPDATE files SET size = ?, modified_at = ?, status = ?, error = ? WHERE id = ?")
        .run(stat.size, Math.trunc(stat.mtimeMs), status, error || null, fileId);
    } else {
      fileId = db.prepare("INSERT INTO files (path, size, modified_at, status, error) VALUES (?, ?, ?, ?, ?)")
        .run(filePath, stat.size, Math.trunc(stat.mtimeMs), status, error || null).lastInsertRowid;
    }
    const insertChunk = db.prepare("INSERT INTO chunks (file_id, location, text) VALUES (?, ?, ?)");
    const insertTokens = db.prepare("INSERT INTO chunk_fts (rowid, tokens) VALUES (?, ?)");
    for (const chunk of chunks) {
      const chunkId = insertChunk.run(fileId, JSON.stringify(chunk.location || null), chunk.text).lastInsertRowid;
      insertTokens.run(chunkId, toTokens(chunk.text).join(" "));
    }
  });
}

// 이름 색인 결과(entries) 중 지원 형식 파일의 내용을 추출한다. 크기·수정 시각이 같으면 건너뛴다.
async function indexContent(db, entries, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const targets = entries.filter((entry) => entry.kind === "file" && SUPPORTED_EXTENSIONS.has(entry.extension));
  const known = new Map(db.prepare("SELECT id, path, size, modified_at, status FROM files").all().map((row) => [row.path, row]));
  const summary = { total: targets.length, extracted: 0, skipped: 0, errors: 0 };

  for (const [index, entry] of targets.entries()) {
    known.delete(entry.path);
    let stat;
    try {
      stat = await fs.stat(entry.path);
    } catch {
      continue;
    }
    const previous = db.prepare("SELECT size, modified_at, status FROM files WHERE path = ?").get(entry.path);
    if (previous && previous.size === stat.size && previous.modified_at === Math.trunc(stat.mtimeMs) && previous.status !== "error") {
      summary.skipped += 1;
    } else if (stat.size > MAX_FILE_SIZE) {
      saveFile(db, entry.path, stat, "too_large", []);
      summary.skipped += 1;
    } else {
      try {
        saveFile(db, entry.path, stat, "done", await extractFile(entry.path) || []);
        summary.extracted += 1;
      } catch (error) {
        saveFile(db, entry.path, stat, "error", [], error.message);
        summary.errors += 1;
      }
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

function makeSnippet(text, term) {
  const lower = normalizeText(text);
  const at = lower.indexOf(term);
  if (at < 0) {
    const head = text.slice(0, SNIPPET_RADIUS * 2);
    return { before: head, match: "", after: text.length > head.length ? "…" : "" };
  }
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + term.length + SNIPPET_RADIUS);
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`.replace(/\s+/g, " "),
    match: text.slice(at, at + term.length),
    after: `${text.slice(at + term.length, end)}${end < text.length ? "…" : ""}`.replace(/\s+/g, " ")
  };
}

function rowsForTerm(db, term) {
  if (needsScan(term)) {
    const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
    return db.prepare(`
      SELECT chunks.id, chunks.location, chunks.text, files.path
      FROM chunks JOIN files ON files.id = chunks.file_id
      WHERE lower(chunks.text) LIKE ? ESCAPE '\\' LIMIT ?
    `).all(`%${escaped}%`, ROWS_PER_TERM);
  }
  const phrase = toMatchPhrase(term);
  if (!phrase) return [];
  return db.prepare(`
    SELECT chunks.id, chunks.location, chunks.text, files.path
    FROM chunk_fts JOIN chunks ON chunks.id = chunk_fts.rowid JOIN files ON files.id = chunks.file_id
    WHERE chunk_fts MATCH ? ORDER BY rank LIMIT ?
  `).all(phrase, ROWS_PER_TERM);
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
        match.hits.push({ location: describeLocation(JSON.parse(row.location)), snippet: makeSnippet(row.text, term) });
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
