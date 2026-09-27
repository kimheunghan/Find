"use strict";

const rootsEl = document.querySelector("#roots");
const excludesEl = document.querySelector("#excludes");
const statusEl = document.querySelector("#indexStatus");
const queryEl = document.querySelector("#query");
const resultsEl = document.querySelector("#results");
const countEl = document.querySelector("#resultCount");
const hintEl = document.querySelector("#hint");
const template = document.querySelector("#resultTemplate");
let roots = [];
let excludedPaths = [];
let timer;

function renderFolderList(container, folders, onRemove) {
  container.replaceChildren();
  for (const folder of folders) {
    const item = document.createElement("div");
    item.className = "root";
    item.title = folder;
    const label = document.createElement("span");
    label.textContent = folder;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.title = "목록에서 빼기";
    remove.textContent = "×";
    remove.addEventListener("click", () => onRemove(folder));
    item.append(label, remove);
    container.append(item);
  }
}

function renderRoots() {
  renderFolderList(rootsEl, roots, async (folder) => {
    roots = await window.findInside.setRoots(roots.filter((item) => item !== folder));
    renderRoots();
    statusEl.textContent = "검색 위치가 변경되었습니다. 색인을 다시 시작하세요.";
  });
}

function renderExcludes() {
  renderFolderList(excludesEl, excludedPaths, async (folder) => {
    excludedPaths = await window.findInside.setExcludedPaths(excludedPaths.filter((item) => item !== folder));
    renderExcludes();
    statusEl.textContent = "제외 폴더가 변경되었습니다. 색인을 다시 시작하세요.";
  });
}

function renderResults(items) {
  resultsEl.replaceChildren();
  countEl.textContent = items.length;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = queryEl.value ? "일치하는 파일이나 폴더가 없습니다." : "검색어를 입력하세요.";
    resultsEl.append(empty);
    return;
  }

  for (const item of items) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector(".icon").textContent = item.kind === "folder" ? "▰" : "▤";
    row.querySelector(".name").textContent = item.name;
    row.querySelector(".path").textContent = item.path;
    row.querySelector(".type").textContent = item.kind === "folder" ? "폴더" : item.extension || "파일";
    row.querySelector(".open").addEventListener("click", () => window.findInside.openItem(item.path));
    row.querySelector(".show").addEventListener("click", () => window.findInside.showInFolder(item.path));
    resultsEl.append(row);
  }
}

document.querySelector("#addRoot").addEventListener("click", async () => {
  const selected = await window.findInside.chooseFolder();
  if (!selected || roots.includes(selected)) return;
  roots.push(selected);
  roots = await window.findInside.setRoots(roots);
  renderRoots();
  statusEl.textContent = "검색 위치가 추가되었습니다. 색인을 시작하세요.";
});

document.querySelector("#addExclude").addEventListener("click", async () => {
  const selected = await window.findInside.chooseFolder();
  if (!selected || excludedPaths.includes(selected)) return;
  excludedPaths = await window.findInside.setExcludedPaths([...excludedPaths, selected]);
  renderExcludes();
  statusEl.textContent = "제외 폴더가 추가되었습니다. 색인을 다시 시작하세요.";
});

document.querySelector("#reindex").addEventListener("click", async () => {
  if (!roots.length) return;
  statusEl.textContent = "파일과 폴더를 색인하고 있습니다…";
  const result = await window.findInside.rebuildIndex();
  statusEl.textContent = `${result.entryCount.toLocaleString()}개 항목 색인 완료 · 오류 ${result.errorCount}개`;
  queryEl.focus();
});

queryEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const query = queryEl.value.trim();
    hintEl.textContent = query ? `“${query}” 파일명·폴더명·경로 검색` : "검색어를 입력하세요.";
    renderResults(query ? await window.findInside.search(query) : []);
  }, 90);
});

window.findInside.onIndexProgress(({ scanned }) => {
  statusEl.textContent = `${scanned.toLocaleString()}개 항목 확인 중…`;
});

(async () => {
  const state = await window.findInside.getState();
  roots = state.roots;
  excludedPaths = state.excludedPaths || [];
  renderRoots();
  renderExcludes();
  if (state.entryCount) {
    statusEl.textContent = `${state.entryCount.toLocaleString()}개 항목 색인됨`;
  }
  renderResults([]);
})();
