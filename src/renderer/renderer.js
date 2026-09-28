"use strict";

const rootsEl = document.querySelector("#roots");
const excludesEl = document.querySelector("#excludes");
const statusEl = document.querySelector("#indexStatus");
const queryEl = document.querySelector("#query");
const resultsEl = document.querySelector("#results");
const countEl = document.querySelector("#resultCount");
const hintEl = document.querySelector("#hint");
const template = document.querySelector("#resultTemplate");
const filterPanelEl = document.querySelector("#filterPanel");
const filterToggleEl = document.querySelector("#toggleFilters");
const filterChipsEl = document.querySelector("#filterChips");
const clearFiltersEl = document.querySelector("#clearFilters");
const scopeOptionsEl = document.querySelector("#scopeOptions");
const extensionOptionsEl = document.querySelector("#extensionOptions");
const extensionInputEl = document.querySelector("#extensionInput");
const COMMON_EXTENSIONS = ["hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "txt", "csv"];
const KIND_LABELS = { file: "파일만", folder: "폴더만" };
let roots = [];
let excludedPaths = [];
let timer;
let filters = { scopes: [], kind: "all", extensions: [] };

const menuItems = {
  file: [{ label: "색인 시작", action: "reindex" }, { label: "종료", action: "quit" }],
  edit: [{ label: "검색어 전체 선택", action: "selectQuery" }, { label: "검색어 지우기", action: "clearQuery" }],
  view: [{ label: "새로 고침", action: "reload" }, { label: "확대", action: "zoomIn" }, { label: "축소", action: "zoomOut" }, { label: "기본 크기", action: "resetZoom" }]
};

function closeMenu() {
  document.querySelector("#menuPopup").hidden = true;
  document.querySelectorAll("[data-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

async function runMenuAction(action) {
  closeMenu();
  if (action === "reindex") document.querySelector("#reindex").click();
  else if (action === "selectQuery") { queryEl.focus(); queryEl.select(); }
  else if (action === "clearQuery") { queryEl.value = ""; queryEl.dispatchEvent(new Event("input")); queryEl.focus(); }
  else await window.findInside.runMenuAction(action);
}

document.querySelectorAll("[data-menu]").forEach((button) => {
  button.addEventListener("click", () => {
    const popup = document.querySelector("#menuPopup");
    const isOpen = button.getAttribute("aria-expanded") === "true";
    closeMenu();
    if (isOpen) return;
    popup.replaceChildren();
    for (const item of menuItems[button.dataset.menu]) {
      const menuButton = document.createElement("button");
      menuButton.textContent = item.label;
      menuButton.addEventListener("click", () => runMenuAction(item.action));
      popup.append(menuButton);
    }
    popup.style.left = `${button.offsetLeft}px`;
    popup.hidden = false;
    button.setAttribute("aria-expanded", "true");
  });
});

document.querySelector('[data-action="about"]').addEventListener("click", () => runMenuAction("about"));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".appMenu")) closeMenu();
});

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
  renderFilters();
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

function renderHits(list, hits) {
  list.hidden = !hits.length;
  for (const hit of hits) {
    const line = document.createElement("li");
    if (hit.location) {
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = hit.location;
      line.append(where);
    }
    const text = document.createElement("span");
    const mark = document.createElement("mark");
    mark.textContent = hit.snippet.match;
    text.append(hit.snippet.before, mark, hit.snippet.after);
    line.append(text);
    list.append(line);
  }
}

function renderResults(items) {
  resultsEl.replaceChildren();
  countEl.textContent = items.length;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = queryEl.value ? "일치하는 파일, 폴더 또는 내용이 없습니다." : "검색어를 입력하세요.";
    resultsEl.append(empty);
    return;
  }

  for (const item of items) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector(".icon").textContent = item.kind === "folder" ? "▰" : "▤";
    row.querySelector(".name").textContent = item.name;
    row.querySelector(".path").textContent = item.path;
    row.querySelector(".type").textContent = [
      item.matchedIn?.includes("content") ? "내용 일치" : "",
      item.kind === "folder" ? "폴더" : item.extension || "파일"
    ].filter(Boolean).join(" · ");
    renderHits(row.querySelector(".hits"), item.hits || []);
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
  showIndexDone(await window.findInside.rebuildIndex());
  queryEl.focus();
});

function samePath(a, b) {
  return pathKey(a) === pathKey(b);
}

function pathKey(value) {
  return String(value).replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function isUnder(target, parent) {
  const t = pathKey(target);
  const p = pathKey(parent);
  return t === p || t.startsWith(`${p}\\`);
}

function driveOf(folder) {
  const match = /^([a-z]):/i.exec(folder);
  return match ? `${match[1].toUpperCase()}:\\` : null;
}

function scopeCandidates() {
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.some((item) => samePath(item, value))) candidates.push(value);
  };
  roots.map(driveOf).sort().forEach(add);
  roots.forEach(add);
  filters.scopes.forEach(add);
  return candidates;
}

function isIndexedScope(scope) {
  return roots.some((root) => isUnder(scope, root) || isUnder(root, scope));
}

function hasFilters() {
  return filters.scopes.length > 0 || filters.kind !== "all" || filters.extensions.length > 0;
}

function toggleScope(scope) {
  filters.scopes = filters.scopes.some((item) => samePath(item, scope))
    ? filters.scopes.filter((item) => !samePath(item, scope))
    : [...filters.scopes, scope];
  onFiltersChanged();
}

function setExtensions(extensions) {
  filters.extensions = [...new Set(extensions
    .map((item) => item.trim().toLocaleLowerCase().replace(/^\*?\./, ""))
    .filter(Boolean))];
}

function toggleExtension(extension) {
  setExtensions(filters.extensions.includes(extension)
    ? filters.extensions.filter((item) => item !== extension)
    : [...filters.extensions, extension]);
  onFiltersChanged();
}

function optionButton(label, pressed, onClick, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "optionButton";
  button.textContent = label;
  button.title = title || label;
  button.setAttribute("aria-pressed", String(pressed));
  button.addEventListener("click", onClick);
  return button;
}

function chip(label, onRemove) {
  const item = document.createElement("span");
  item.className = "chip";
  item.title = label;
  const text = document.createElement("span");
  text.textContent = label;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.title = "조건 빼기";
  remove.textContent = "×";
  remove.addEventListener("click", onRemove);
  item.append(text, remove);
  return item;
}

function renderFilters() {
  scopeOptionsEl.replaceChildren(...scopeCandidates().map((scope) => optionButton(
    scope,
    filters.scopes.some((item) => samePath(item, scope)),
    () => toggleScope(scope)
  )));

  const extensionChoices = [...new Set([...COMMON_EXTENSIONS, ...filters.extensions])];
  extensionOptionsEl.replaceChildren(...extensionChoices.map((extension) => optionButton(
    extension.toUpperCase(),
    filters.extensions.includes(extension),
    () => toggleExtension(extension)
  )));
  if (document.activeElement !== extensionInputEl) extensionInputEl.value = filters.extensions.join(", ");
  document.querySelectorAll('input[name="kind"]').forEach((input) => { input.checked = input.value === filters.kind; });

  const chips = filters.scopes.map((scope) => chip(`범위: ${scope}`, () => toggleScope(scope)));
  if (filters.kind !== "all") {
    chips.push(chip(KIND_LABELS[filters.kind], () => { filters.kind = "all"; onFiltersChanged(); }));
  }
  for (const extension of filters.extensions) {
    chips.push(chip(extension.toUpperCase(), () => toggleExtension(extension)));
  }
  filterChipsEl.replaceChildren(...chips);
  clearFiltersEl.hidden = !hasFilters();
  filterToggleEl.classList.toggle("active", hasFilters());
}

function describeSearch(query) {
  const parts = [];
  parts.push(filters.scopes.length ? filters.scopes.join(", ") : "전체 검색 위치");
  if (filters.kind !== "all") parts.push(KIND_LABELS[filters.kind]);
  if (filters.extensions.length) parts.push(filters.extensions.map((item) => item.toUpperCase()).join("·"));
  return `“${query}” · ${parts.join(" · ")}`;
}

async function runSearch() {
  const query = queryEl.value.trim();
  const unindexed = filters.scopes.filter((scope) => !isIndexedScope(scope));
  hintEl.classList.toggle("warn", unindexed.length > 0);
  if (unindexed.length) {
    hintEl.textContent = `색인되지 않은 범위: ${unindexed.join(", ")} — 왼쪽 검색 위치에 추가하고 색인하세요.`;
  } else {
    hintEl.textContent = query
      ? `${describeSearch(query)}${contentIndexing ? " · 내용 색인 진행 중" : ""}`
      : "검색어를 입력하세요.";
  }
  renderResults(query ? await window.findInside.search(query, filters) : []);
}

function onFiltersChanged() {
  renderFilters();
  runSearch();
}

function loadFilterPanelOpen() {
  try {
    return localStorage.getItem("filterPanelOpen") === "1";
  } catch {
    return false;
  }
}

function setFilterPanelOpen(open) {
  filterPanelEl.hidden = !open;
  filterToggleEl.setAttribute("aria-expanded", String(open));
  filterToggleEl.textContent = open ? "상세 조건 접기 ▴" : "상세 조건 펼치기 ▾";
  try {
    localStorage.setItem("filterPanelOpen", open ? "1" : "0");
  } catch {
    // 저장하지 못해도 접기·펼치기는 동작한다.
  }
}

filterToggleEl.addEventListener("click", () => setFilterPanelOpen(filterPanelEl.hidden));

document.addEventListener("click", (event) => {
  if (!filterPanelEl.hidden && !event.target.closest("header")) setFilterPanelOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !filterPanelEl.hidden) {
    setFilterPanelOpen(false);
    filterToggleEl.focus();
  }
});

clearFiltersEl.addEventListener("click", () => {
  filters = { scopes: [], kind: "all", extensions: [] };
  onFiltersChanged();
});

document.querySelector("#addScope").addEventListener("click", async () => {
  const selected = await window.findInside.chooseFolder();
  if (!selected || filters.scopes.some((item) => samePath(item, selected))) return;
  filters.scopes = [...filters.scopes, selected];
  onFiltersChanged();
});

document.querySelectorAll('input[name="kind"]').forEach((input) => {
  input.addEventListener("change", () => {
    filters.kind = input.value;
    onFiltersChanged();
  });
});

extensionInputEl.addEventListener("change", () => {
  setExtensions(extensionInputEl.value.split(/[\s,;]+/));
  onFiltersChanged();
});

// 한글 조합 중(ㅅ→서→설)에는 자모마다 검색하지 않고, 입력이 잠시 멈췄을 때 한 번만 검색한다.
function scheduleSearch() {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 250);
}

queryEl.addEventListener("input", (event) => {
  if (event.isComposing) return;
  scheduleSearch();
});
queryEl.addEventListener("compositionend", scheduleSearch);

let contentIndexing = false;
let lastProgressSearch = 0;

function showIndexDone(result) {
  contentIndexing = false;
  statusEl.textContent = `${result.entryCount.toLocaleString()}개 항목 색인 완료 · 내용 추출 ${result.content.extracted.toLocaleString()}개(변경 없음 ${result.content.skipped.toLocaleString()}개) · 오류 ${(result.errorCount + result.content.errors).toLocaleString()}개`;
  if (queryEl.value.trim()) runSearch();
}

window.findInside.onIndexProgress((progress) => {
  if (progress.phase !== "content") {
    statusEl.textContent = `${progress.scanned.toLocaleString()}개 항목 확인 중…`;
    return;
  }
  contentIndexing = true;
  statusEl.textContent = `파일 내용 색인 중… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}
끝난 파일부터 검색 결과에 반영됩니다.`;
  // 색인 중에도 검색어가 있으면 몇 초마다 결과를 새로 고쳐 새로 색인된 내용을 보여 준다.
  if (queryEl.value.trim() && Date.now() - lastProgressSearch > 5000) {
    lastProgressSearch = Date.now();
    runSearch();
  }
});

window.findInside.onIndexDone(showIndexDone);

(async () => {
  const state = await window.findInside.getState();
  roots = state.roots;
  excludedPaths = state.excludedPaths || [];
  renderRoots();
  renderExcludes();
  if (state.entryCount) {
    const contentCount = Number(state.content?.done || 0);
    statusEl.textContent = state.indexing
      ? "파일 내용 색인을 준비하고 있습니다…"
      : contentCount
        ? `${state.entryCount.toLocaleString()}개 항목 · 본문 ${contentCount.toLocaleString()}개 색인됨`
        : `${state.entryCount.toLocaleString()}개 항목 색인됨 · 본문 색인을 시작합니다…`;
  }
  setFilterPanelOpen(loadFilterPanelOpen());
  renderResults([]);
})();
