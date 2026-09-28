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

// stats를 넘기면 상한(limit)과 관계없이 일치한 전체 개수를 stats.total에 담는다.
function searchEntries(entries, query, filters = {}, limit = 200, contentMatches = new Map(), stats = {}) {
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
  return found
    .sort((a, b) => b.result.score - a.result.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ entry, contentMatch, result }) => ({
      ...entry,
      score: result.score,
      matchedIn: result.matchedIn,
      hits: result.matchedIn.includes("content") ? contentMatch.hits : []
    }));
}

module.exports = { normalize, tokenize, scoreEntry, isInScope, matchesFilters, prepareEntries: normalizedKeys, searchEntries };
