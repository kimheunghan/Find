"use strict";

const rootsEl = document.querySelector("#roots");
const statusEl = document.querySelector("#indexStatus");
const queryEl = document.querySelector("#query");
const resultsEl = document.querySelector("#results");
const countEl = document.querySelector("#resultCount");
const hintEl = document.querySelector("#hint");
const template = document.querySelector("#resultTemplate");
let roots = [];
let timer;

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

function renderRoots() {
  rootsEl.replaceChildren();
  for (const root of roots) {
    const item = document.createElement("div");
    item.className = "root";
    item.title = root;
    item.textContent = root;
    rootsEl.append(item);
  }
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
  renderRoots();
  if (state.entryCount) {
    statusEl.textContent = `${state.entryCount.toLocaleString()}개 항목 색인됨`;
  }
  renderResults([]);
})();
