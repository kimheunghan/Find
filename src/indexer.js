"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

// 색인 파일 형식. 2: 폴더 항목에 수정 시각(mtime)을 적어 둔다 (켤 때 바뀐 폴더만 다시 읽으려고)
const INDEX_FORMAT = 2;

// 폴더를 동시에 몇 개 읽을지. 디스크가 한 번에 여러 요청을 처리하므로 하나씩 읽을 때보다 몇 배 빠르다.
// (실측: 폴더 15만 개 확인이 하나씩 58초 → 16개씩 7초. 더 늘려도 빨라지지 않았다)
const CONCURRENCY = 16;

const DEFAULT_EXCLUDES = new Set([
  "$recycle.bin",
  "system volume information",
  "node_modules",
  ".git"
]);

// 캐시·임시 파일이 쉴 새 없이 바뀌는 시스템·앱 폴더. 폴더 감시와 켤 때 따라잡기에서 뺀다 (목록에는 전체 색인 때 들어간다).
// (C:\ 전체를 감시하면 AppData 캐시 변경이 3초마다 수천 건씩 몰려 메인 프로세스가 멈춘다)
const CHURN_PATH = /\\(appdata|\$recycle\.bin|system volume information|node_modules|\.git|\.cache|\.claude|\.vscode|\.gradle|temp|tmp)(\\|$)|^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/i;

// 감시·따라잡기에서 뺄 곳인지. 사용자가 그런 곳(예: D:\tmp\자료)을 검색 위치로 직접 골랐으면 그 안은 빼지 않는다.
function isChurn(target, roots) {
  if (!CHURN_PATH.test(target)) return false;
  const lower = target.toLocaleLowerCase();
  return !roots.some((root) => {
    if (!CHURN_PATH.test(root)) return false;
    const prefix = root.toLocaleLowerCase();
    return lower === prefix || lower.startsWith(prefix.endsWith(path.sep) ? prefix : prefix + path.sep);
  });
}

function isInside(targetPath, parentPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative));
}

function isExcluded(targetPath, excludedPaths) {
  const normalized = path.resolve(targetPath).toLocaleLowerCase();
  if (excludedPaths.some((item) => isInside(normalized, path.resolve(item).toLocaleLowerCase()))) {
    return true;
  }
  return DEFAULT_EXCLUDES.has(path.basename(normalized));
}

// isExcluded와 같은 판단을, 제외 폴더 목록을 한 번만 정리해 두고 빠르게 한다 (항목 수십만 개에 매번 path.resolve를 하면 느리다).
function makeExcluder(excludedPaths) {
  const prefixes = excludedPaths.map((item) => {
    const resolved = path.resolve(item).toLocaleLowerCase();
    return resolved.endsWith(path.sep) ? resolved : resolved + path.sep;
  });
  return (fullPath, name) => {
    if (DEFAULT_EXCLUDES.has(name.toLocaleLowerCase())) return true;
    if (!prefixes.length) return false;
    const lower = fullPath.toLocaleLowerCase() + path.sep;
    return prefixes.some((prefix) => lower.startsWith(prefix));
  };
}

function makeEntry(name, fullPath, kind) {
  return kind === "folder"
    ? { name, path: fullPath, kind, extension: "" }
    : { name, path: fullPath, kind, extension: path.extname(name).slice(1).toLocaleLowerCase() };
}

// items를 limit개씩 동시에 처리한다. 처리 중에 items 뒤에 더 붙여도(하위 폴더) 끝까지 처리한다.
function runPool(items, limit, work) {
  let next = 0;
  let active = 0;
  return new Promise((resolve, reject) => {
    const pump = () => {
      while (active < limit && next < items.length) {
        const item = items[next];
        items[next] = undefined; // 다 쓴 자리는 비워 메모리를 돌려준다
        next += 1;
        active += 1;
        work(item).then(() => {
          active -= 1;
          pump();
        }, reject);
      }
      if (!active && next >= items.length) resolve();
    };
    pump();
  });
}

// 폴더들(starts: [{ path, entry }]) 아래를 모두 훑는다. 폴더 항목(entry)에는 읽기 직전의 수정 시각을 적는다.
async function walk(starts, { excluded, onProgress = () => {}, entries = [], errors = [] }) {
  const queue = [...starts];
  let scanned = 0;
  let lastReport = 0;
  await runPool(queue, CONCURRENCY, async ({ path: folder, entry }) => {
    let items;
    try {
      // 시각을 먼저 읽고 목록을 읽는다. 그 사이에 바뀌면 다음 따라잡기 때 다시 읽힌다.
      if (entry) entry.mtime = Math.trunc((await fs.stat(folder)).mtimeMs);
      items = await fs.readdir(folder, { withFileTypes: true });
    } catch (error) {
      errors.push({ path: folder, message: error.message });
      return;
    }
    for (const item of items) {
      const fullPath = path.join(folder, item.name);
      if (excluded(fullPath, item.name)) continue;
      const kind = item.isDirectory() ? "folder" : item.isFile() ? "file" : null;
      if (!kind) continue;
      const child = makeEntry(item.name, fullPath, kind);
      entries.push(child);
      if (kind === "folder") queue.push({ path: fullPath, entry: child });
      scanned += 1;
    }
    if (scanned - lastReport >= 250) {
      lastReport = scanned;
      onProgress({ scanned, current: folder });
    }
  });
  return { entries, errors };
}

async function indexRoots(roots, options = {}) {
  const excludedPaths = options.excludedPaths || [];
  const excluded = makeExcluder(excludedPaths);
  const starts = roots
    .map((root) => path.resolve(root))
    .filter((root) => !isExcluded(root, excludedPaths))
    .map((root) => ({ path: root, entry: null }));
  const { entries, errors } = await walk(starts, { excluded, onProgress: options.onProgress });
  return { format: INDEX_FORMAT, entries, errors, indexedAt: new Date().toISOString() };
}

// ---- 켤 때 따라잡기 ----
// 앱이 꺼져 있던 동안 생기거나 지워진 파일을 찾는다. 폴더 안에서 파일이 생기거나 지워지거나 이름이 바뀌면
// 그 폴더의 수정 시각이 바뀐다(NTFS). 그래서 폴더마다 시각만 확인하고(15만 개에 몇 초), 바뀐 폴더만 다시 읽는다.
// 파일 내용이 바뀐 것은 여기서 찾지 않는다 (이름 목록은 그대로이고, 내용 색인이 크기·수정 시각으로 따로 확인한다).
// 반환값: { added: 새 항목과 시각이 바뀐 폴더 항목, removed: 없어진 경로, checked, changed }
async function catchUp(entries, roots, options = {}) {
  const excluded = makeExcluder(options.excludedPaths || []);
  const onProgress = options.onProgress || (() => {});
  const rootList = roots.map((root) => path.resolve(root));
  const skip = options.skip || ((target) => isChurn(target, rootList));
  const rootPrefixes = rootList.map((root) => (root.endsWith(path.sep) ? root : root + path.sep).toLocaleLowerCase());
  const underRoot = (target) => {
    const lower = target.toLocaleLowerCase();
    return rootPrefixes.some((prefix) => lower.startsWith(prefix));
  };

  // 폴더마다 그 안에 있던 항목 (이름 → 항목)
  const children = new Map();
  const folders = [];
  for (const entry of entries) {
    const parent = path.dirname(entry.path);
    let inside = children.get(parent);
    if (!inside) children.set(parent, inside = new Map());
    inside.set(entry.name, entry);
    if (entry.kind === "folder" && !skip(entry.path) && underRoot(entry.path)) folders.push(entry);
  }

  const added = [];
  const removed = [];
  const removeTree = (entry) => {
    removed.push(entry.path);
    if (entry.kind !== "folder") return;
    for (const child of children.get(entry.path)?.values() || []) removeTree(child);
  };

  // 0) 폴더 감시는 지워진 폴더 자신만 목록에서 빼므로 그 안의 항목이 남아 있을 수 있다. 부모 폴더가 목록에 없는 항목을 정리한다.
  const folderPaths = new Set(entries.filter((entry) => entry.kind === "folder").map((entry) => entry.path.toLocaleLowerCase()));
  const rootPaths = new Set(rootList.map((root) => root.toLocaleLowerCase()));
  for (const [parent, inside] of children) {
    const lower = parent.toLocaleLowerCase();
    if (folderPaths.has(lower) || rootPaths.has(lower) || !underRoot(parent)) continue;
    for (const orphan of inside.values()) removeTree(orphan);
  }

  // 1) 시각이 바뀐 폴더를 찾는다. 검색 위치(최상위)는 시각을 적어 두지 않으므로 늘 다시 읽는다 (항목이 적다).
  const changed = rootList.map((root) => ({ path: root, entry: null, mtime: null }));
  let checked = 0;
  await runPool([...folders], CONCURRENCY, async (entry) => {
    let stat;
    try {
      stat = await fs.stat(entry.path);
    } catch {
      return; // 없어진 폴더는 부모 폴더를 다시 읽을 때 정리된다
    }
    const mtime = Math.trunc(stat.mtimeMs);
    if (entry.mtime !== mtime) changed.push({ path: entry.path, entry, mtime });
    checked += 1;
    if (checked % 2000 === 0) onProgress({ scanned: checked, current: entry.path });
  });

  // 2) 바뀐 폴더를 다시 읽어 전에 있던 항목과 견준다
  const newFolders = [];
  await runPool(changed, CONCURRENCY, async ({ path: folder, entry, mtime }) => {
    let items;
    try {
      items = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    if (entry) added.push({ ...entry, mtime }); // 새 시각을 적어 둔다
    const known = children.get(folder) || new Map();
    const seen = new Set();
    for (const item of items) {
      const fullPath = path.join(folder, item.name);
      if (excluded(fullPath, item.name)) continue;
      const kind = item.isDirectory() ? "folder" : item.isFile() ? "file" : null;
      if (!kind) continue;
      seen.add(item.name);
      const old = known.get(item.name);
      if (old && old.kind === kind) continue;
      if (old) removeTree(old);
      const fresh = makeEntry(item.name, fullPath, kind);
      added.push(fresh);
      if (kind === "folder") newFolders.push({ path: fullPath, entry: fresh });
    }
    for (const [name, old] of known) if (!seen.has(name)) removeTree(old);
  });

  // 3) 새로 생긴 폴더는 그 아래를 모두 읽는다
  if (newFolders.length) await walk(newFolders, { excluded, entries: added });
  // 지웠다가 다시 생긴 것은 지운 목록에서 뺀다
  const addedPaths = new Set(added.map((entry) => entry.path));
  return { added, removed: [...new Set(removed)].filter((target) => !addedPaths.has(target)), checked, changed: changed.length };
}

module.exports = { INDEX_FORMAT, CHURN_PATH, isChurn, indexRoots, isExcluded, catchUp };
