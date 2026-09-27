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

function searchEntries(entries, query, limit = 200) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ entry, score }) => ({ ...entry, score }));
}

module.exports = { normalize, tokenize, scoreEntry, searchEntries };
