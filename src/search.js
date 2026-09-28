"use strict";

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

function tokenize(query) {
  const tokens = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(query)) !== null) {
    tokens.push(normalize(match[1] || match[2]));
  }
  return tokens.filter(Boolean);
}

function scoreEntry(entry, tokens) {
  if (!tokens.length) return 0;
  const name = normalize(entry.name);
  const path = normalize(entry.path);
  let score = 0;

  for (const token of tokens) {
    if (!name.includes(token) && !path.includes(token)) return -1;
    if (name === token) score += 120;
    else if (name.startsWith(token)) score += 70;
    else if (name.includes(token)) score += 45;
    if (path.includes(token)) score += 15;
  }

  if (entry.kind === "folder") score += 3;
  return score;
}

function comparablePath(value) {
  return normalize(value).replace(/\//g, "\\").replace(/\\+$/, "");
}

function isInScope(entryPath, scope) {
  const target = comparablePath(entryPath);
  const parent = comparablePath(scope);
  if (!parent) return true;
  return target === parent || target.startsWith(`${parent}\\`);
}

function normalizeExtensions(extensions) {
  return [...new Set((extensions || [])
    .map((item) => normalize(item).trim().replace(/^\*?\./, ""))
    .filter(Boolean))];
}

function matchesFilters(entry, filters) {
  const scopes = filters.scopes || [];
  if (scopes.length && !scopes.some((scope) => isInScope(entry.path, scope))) return false;
  if (filters.kind === "file" || filters.kind === "folder") {
    if (entry.kind !== filters.kind) return false;
  }
  const extensions = normalizeExtensions(filters.extensions);
  if (extensions.length && (entry.kind !== "file" || !extensions.includes(normalize(entry.extension)))) {
    return false;
  }
  return true;
}

// 검색어마다 파일명·경로 또는 파일 내용 중 한 곳에는 있어야 한다.
// contentMatches: Map<경로, { terms: Set<검색어>, hits }> (contentIndex.searchContent 결과)
function scoreKeys({ name, path }, kind, tokens, contentMatch) {
  let score = 0;
  let nameMatched = false;
  let contentMatched = false;

  for (const token of tokens) {
    // 따옴표로 묶은 "설치 정보"는 띄어쓰기 없이 쓴 "설치정보"와도 일치로 본다.
    const compact = /\s/.test(token) ? token.replace(/\s+/g, "") : null;
    const inName = name.includes(token) || path.includes(token)
      || Boolean(compact && path.replace(/\s+/g, "").includes(compact));
    const inContent = Boolean(contentMatch && contentMatch.terms.has(token));
    if (!inName && !inContent) return null;
    if (inName) {
      nameMatched = true;
      if (name === token) score += 120;
      else if (name.startsWith(token)) score += 70;
      else if (name.includes(token)) score += 45;
      if (path.includes(token)) score += 15;
    }
    if (inContent) {
      contentMatched = true;
      score += 30;
    }
  }

  if (kind === "folder") score += 3;
  const matchedIn = [nameMatched && "name", contentMatched && "content"].filter(Boolean);
  return { score, matchedIn };
}

// 항목이 수백만 개면 검색할 때마다 이름·경로를 정규화하는 데만 몇 초가 걸려 창이 멈춘다.
// 목록(배열)별로 정규화 결과를 한 번만 만들어 두고 재사용한다.
const normalizedCache = new WeakMap();

function normalizedKeys(entries) {
  let keys = normalizedCache.get(entries);
  if (!keys || keys.length !== entries.length) {
    keys = entries.map((entry) => ({ name: normalize(entry.name), path: comparablePath(entry.path) }));
    normalizedCache.set(entries, keys);
  }
  return keys;
}

// 최신순 정렬에서 날짜를 확인할 최대 개수 (파일 날짜는 디스크에서 읽어 오므로 관련도 높은 것부터 이만큼만)
const NEWEST_CANDIDATES = 20000;

// stats를 넘기면 상한(limit)과 관계없이 일치한 전체 개수를 stats.total에 담는다.
// filters.sort가 "newest"이면 dateOf(entry)가 돌려준 시각(ms)이 최근인 것부터 보여 준다.
function searchEntries(entries, query, filters = {}, limit = 200, contentMatches = new Map(), stats = {}, dateOf = null) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const keys = normalizedKeys(entries);
  const scopes = (filters.scopes || []).map(comparablePath).filter(Boolean);
  const kind = filters.kind === "file" || filters.kind === "folder" ? filters.kind : null;
  const extensions = new Set(normalizeExtensions(filters.extensions));
  const found = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const key = keys[i];
    if (kind && entry.kind !== kind) continue;
    if (extensions.size && (entry.kind !== "file" || !extensions.has(entry.extension))) continue;
    if (scopes.length && !scopes.some((scope) => key.path === scope || key.path.startsWith(`${scope}\\`))) continue;

    const contentMatch = contentMatches.get(entry.path);
    const result = scoreKeys(key, entry.kind, tokens, contentMatch);
    if (result) found.push({ entry, contentMatch, result });
  }

  stats.total = found.length;
  found.sort((a, b) => b.result.score - a.result.score || a.entry.name.localeCompare(b.entry.name));
  let ordered = found;
  if (filters.sort === "newest" && dateOf) {
    ordered = found.slice(0, NEWEST_CANDIDATES);
    for (const item of ordered) item.time = dateOf(item.entry) || 0;
    // 날짜가 잘못 적힌 파일(예: 2069년)이 맨 위를 차지하지 않게, 하루 넘게 미래인 날짜는 날짜 모름으로 정렬한다
    const latest = Date.now() + 86_400_000;
    const sortTime = (item) => (item.time > latest ? 0 : item.time);
    ordered.sort((a, b) => sortTime(b) - sortTime(a) || b.result.score - a.result.score);
  }
  // 보여 줄 결과에는 정렬과 관계없이 날짜를 붙인다 (같은 이름의 파일을 구분할 수 있게)
  return ordered
    .slice(0, limit)
    .map(({ entry, contentMatch, result, time }) => ({
      ...entry,
      time: time ?? (dateOf ? dateOf(entry) || 0 : 0),
      score: result.score,
      matchedIn: result.matchedIn,
      hits: result.matchedIn.includes("content") ? contentMatch.hits : []
    }));
}

// 새로 생기거나 바뀐 항목(added)과 지워진 경로(removed)를 목록에 반영한다. 배열과 정규화 캐시를 제자리에서 고쳐
// 157만 개 전체를 다시 정규화(수 초)하지 않는다.
function updateEntries(entries, added = [], removed = []) {
  const keys = normalizedKeys(entries);
  const drop = new Set(removed);
  for (const entry of added) drop.add(entry.path);
  if (drop.size) {
    let write = 0;
    for (let read = 0; read < entries.length; read += 1) {
      if (drop.has(entries[read].path)) continue;
      entries[write] = entries[read];
      keys[write] = keys[read];
      write += 1;
    }
    entries.length = write;
    keys.length = write;
  }
  for (const entry of added) {
    entries.push(entry);
    keys.push({ name: normalize(entry.name), path: comparablePath(entry.path) });
  }
}

module.exports = { normalize, tokenize, scoreEntry, isInScope, matchesFilters, prepareEntries: normalizedKeys, updateEntries, searchEntries };
