"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_EXCLUDES = new Set([
  "$recycle.bin",
  "system volume information",
  "node_modules",
  ".git"
]);

function isExcluded(targetPath, excludedPaths) {
  const normalized = path.resolve(targetPath).toLocaleLowerCase();
  if (excludedPaths.some((item) => normalized.startsWith(path.resolve(item).toLocaleLowerCase()))) {
    return true;
  }
  return DEFAULT_EXCLUDES.has(path.basename(normalized));
}

async function indexRoots(roots, options = {}) {
  const excludedPaths = options.excludedPaths || [];
  const onProgress = options.onProgress || (() => {});
  const entries = [];
  const errors = [];
  const queue = roots.map((root) => path.resolve(root));
  let scanned = 0;

  while (queue.length) {
    const current = queue.shift();
    if (isExcluded(current, excludedPaths)) continue;

    let dirEntries;
    try {
      dirEntries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      errors.push({ path: current, message: error.message });
      continue;
    }

    for (const item of dirEntries) {
      const fullPath = path.join(current, item.name);
      if (isExcluded(fullPath, excludedPaths)) continue;

      if (item.isDirectory()) {
        entries.push({ name: item.name, path: fullPath, kind: "folder", extension: "" });
        queue.push(fullPath);
      } else if (item.isFile()) {
        entries.push({
          name: item.name,
          path: fullPath,
          kind: "file",
          extension: path.extname(item.name).slice(1).toLocaleLowerCase()
        });
      }
      scanned += 1;
      if (scanned % 250 === 0) onProgress({ scanned, current });
    }
  }

  return { entries, errors, indexedAt: new Date().toISOString() };
}

module.exports = { indexRoots, isExcluded };
