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
const filterBarEl = document.querySelector(".filterBar");
const filterChipsEl = document.querySelector("#filterChips");
const clearFiltersEl = document.querySelector("#clearFilters");
const scopeOptionsEl = document.querySelector("#scopeOptions");
const extensionSelectEl = document.querySelector("#extensionSelect");
const extensionInputEl = document.querySelector("#extensionInput");
const extensionTagsEl = document.querySelector("#extensionTags");
let roots = [];
let excludedPaths = [];
let timer;
let searchSequence = 0;
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

// 일치한 곳의 앞뒤 단어까지 붙여 문서에서 찾기 쉬운 문구를 만든다. 예: "…매핑 기술 " + "사양" + "서 · 질의…" → "기술 사양서"
function findPhrase(snippet) {
  const before = snippet.before.replace(/…/g, "").match(/(\S+\s?)$/u)?.[1] || "";
  const after = snippet.after.replace(/…/g, "").match(/^(\S*)/u)?.[1] || "";
  return `${before}${snippet.match}${after}`.trim();
}

function renderHits(list, hits, item) {
  list.hidden = !hits.length;
  for (const hit of hits) {
    const line = document.createElement("li");
    const phrase = findPhrase(hit.snippet);
    line.title = `눌러서 문서 열기 — "${phrase}"을(를) 복사해 둡니다. 문서에서 Ctrl+F 후 Ctrl+V로 찾으세요.`;
    line.addEventListener("click", async () => {
      if (item.kind === "mail") {
        await openMailItem(item);
        return;
      }
      await window.findInside.openAt(item.path, phrase);
      hintEl.classList.remove("warn");
      hintEl.textContent = `"${phrase}" 복사됨 — 문서에서 Ctrl+F 후 Ctrl+V로 찾으세요 (${hit.location})`;
    });
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

// 제목·경로도 본문과 같은 규칙(highlight.js)으로 검색어를 강조한다. textContent 기반이라 파일명에 HTML이 있어도 안전하다.
function renderHighlighted(element, value, terms) {
  const text = FindHighlight.displayText(value);
  const nodes = [];
  let cursor = 0;
  for (const [start, end] of FindHighlight.findRanges(text, terms)) {
    if (start > cursor) nodes.push(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    nodes.push(mark);
    cursor = end;
  }
  if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));
  element.replaceChildren(...nodes);
}

function renderResults(items, total = items.length) {
  resultsEl.replaceChildren();
  countEl.textContent = total.toLocaleString();
  if (total > items.length) {
    const more = document.createElement("div");
    more.className = "moreNotice";
    more.textContent = `관련도 높은 ${items.length.toLocaleString()}개만 표시합니다. 검색어를 더 넣거나 상세 조건으로 범위를 좁혀 보세요.`;
    resultsEl.append(more);
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = queryEl.value ? "일치하는 파일, 폴더 또는 내용이 없습니다." : "검색어를 입력하세요.";
    resultsEl.append(empty);
    return;
  }

  const terms = FindHighlight.queryTerms(queryEl.value);
  for (const item of items) {
    const row = template.content.firstElementChild.cloneNode(true);
    const isMail = item.kind === "mail";
    row.querySelector(".icon").textContent = isMail ? "✉" : item.kind === "folder" ? "▰" : "▤";
    renderHighlighted(row.querySelector(".name"), item.name, terms);
    renderHighlighted(row.querySelector(".path"), isMail ? mailSummary(item) : item.path, terms);
    row.querySelector(".type").textContent = [
      item.matchedIn?.includes("content") ? "내용 일치" : "",
      isMail ? "메일" : item.kind === "folder" ? "폴더" : item.extension || "파일"
    ].filter(Boolean).join(" · ");
    renderHits(row.querySelector(".hits"), item.hits || [], item);
    if (isMail) {
      row.querySelector(".open").addEventListener("click", () => openMailItem(item));
      row.querySelector(".show").hidden = true;
    } else {
      row.querySelector(".open").addEventListener("click", () => window.findInside.openItem(item.path));
      row.querySelector(".show").addEventListener("click", () => window.findInside.showInFolder(item.path));
    }
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
  return filters.scopes.length > 0 || filters.extensions.length > 0;
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

function scopeControl(scope) {
  const selected = filters.scopes.some((item) => samePath(item, scope));
  if (!selected) return optionButton(scope, false, () => toggleScope(scope));

  const item = document.createElement("span");
  item.className = "scopeOption selected";
  item.title = scope;
  const label = document.createElement("span");
  label.textContent = scope;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.title = `${scope} 검색 범위에서 제거`;
  remove.setAttribute("aria-label", remove.title);
  remove.textContent = "×";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleScope(scope);
  });
  item.append(label, remove);
  return item;
}

function renderFilters() {
  scopeOptionsEl.replaceChildren(...scopeCandidates().map(scopeControl));

  // 확장자는 여러 개를 태그로 보여 주고, 태그마다 ×로 뺄 수 있다.
  extensionSelectEl.value = "";
  const tags = filters.extensions.map((extension) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    const label = document.createElement("span");
    label.textContent = extension.toUpperCase();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `${extension.toUpperCase()} 빼기`;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExtension(extension);
    });
    tag.append(label, remove);
    return tag;
  });
  extensionTagsEl.replaceChildren(...tags, extensionInputEl);

  const chips = filters.scopes.map((scope) => chip(`범위: ${scope}`, () => toggleScope(scope)));
  for (const extension of filters.extensions) {
    chips.push(chip(`형식: ${extension.toUpperCase()}`, () => toggleExtension(extension)));
  }
  filterChipsEl.replaceChildren(...chips);
  clearFiltersEl.hidden = !hasFilters();
  filterToggleEl.classList.toggle("active", hasFilters());
}

function describeSearch(query) {
  const parts = [];
  parts.push(filters.scopes.length ? filters.scopes.join(", ") : "전체 검색 위치");
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
  // 검색이 겹치면 늦게 도착한 이전 검색 결과가 새 결과를 덮어쓰지 않게 마지막 요청만 그린다.
  const sequence = ++searchSequence;
  let result = { items: [], total: 0 };
  let failed = null;
  if (query) {
    try {
      result = await window.findInside.search(query, { ...filters, source });
    } catch (error) {
      failed = error;
    }
  }
  if (sequence !== searchSequence) return;
  const { items, total } = result;
  // 검색이 실패하면 이전 화면을 그대로 두지 않고 이유를 알린다.
  if (failed) {
    renderResults([]);
    resultsEl.querySelector(".empty").textContent = `검색 중 오류가 났습니다. 잠시 뒤 다시 시도하세요. (${String(failed.message || failed).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")})`;
    resultsEl.dataset.query = query;
    return;
  }
  renderResults(items, total);
  renderSourceCounts(query ? result : null);
  resultsEl.dataset.query = query;
}

// ---- 검색 분류 탭 (전체 · PC 파일 · 메일) ----
let source = "all";

function renderSourceCounts(result) {
  const counts = { all: result?.total, pc: result?.pcTotal, mail: result?.mailTotal };
  document.querySelectorAll(".sourceTabs [data-count]").forEach((span) => {
    const value = counts[span.dataset.count];
    // 다른 탭을 고른 동안은 그 분류 개수를 모르므로 비워 둔다
    span.textContent = value === undefined || (source !== "all" && span.dataset.count !== source && span.dataset.count !== "all") ? "" : `(${value.toLocaleString()})`;
  });
}

document.querySelectorAll(".sourceTabs [data-source]").forEach((tab) => {
  tab.addEventListener("click", () => {
    source = tab.dataset.source;
    document.querySelectorAll(".sourceTabs [data-source]").forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    applySourceView();
    runSearch();
  });
});

// 메일 탭: PC용 상세 조건(범위·확장자) 대신 메일 계정 연결·상태를 보여 준다
function applySourceView() {
  const isMail = source === "mail";
  document.querySelector(".filterBar").hidden = isMail;
  if (isMail) filterPanelEl.hidden = true;
  else setFilterPanelOpen(loadFilterPanelOpen());
  document.querySelector("#mailPanel").hidden = !isMail;
  if (isMail) renderMailPanel();
}

function renderMailPanel() {
  const panel = document.querySelector("#mailPanel");
  const button = (text, className, onClick) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
  };
  if (!mailAccounts.length) {
    const title = document.createElement("h3");
    title.textContent = "메일 계정을 연결하세요";
    const help = document.createElement("p");
    help.textContent = "연결한 계정의 메일 제목·보낸 사람·본문·첨부파일 내용까지 검색합니다. 메일은 이 PC에서만 색인하고 외부로 보내지 않습니다.";
    const actions = document.createElement("div");
    actions.className = "mailConnect";
    actions.append(
      button("IMAP으로 연결 (권장)", "primary", () => openMailDialog(null, "imap")),
      button("POP3로 연결", "secondary", () => openMailDialog(null, "pop3"))
    );
    panel.replaceChildren(title, help, actions);
    return;
  }
  const title = document.createElement("h3");
  title.textContent = `연결된 메일 계정 ${mailAccounts.length}개`;
  const cards = mailAccounts.map((account) => {
    const card = document.createElement("div");
    card.className = "mailAccountCard";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = account.name || account.email || account.user;
    const detail = document.createElement("small");
    detail.textContent = `  ${(account.protocol || "imap").toUpperCase()} · ${account.host} · ${account.lastSync ? `마지막 가져오기 ${account.lastSync.slice(0, 16).replace("T", " ")}` : "아직 가져오지 않음"}`;
    info.append(name, detail);
    if (account.lastError) {
      const warn = document.createElement("p");
      warn.className = "mailWarn";
      warn.textContent = `⚠ ${account.lastError}`;
      info.append(warn);
    }
    const actions = document.createElement("div");
    actions.className = "mailCardActions";
    actions.append(
      button("설정", "secondary", () => openMailDialog(account)),
      button("삭제", "secondary", async () => {
        if (!confirm(`"${account.name || account.email || account.user}" 계정을 삭제할까요? 이 계정에서 가져온 메일 색인도 지웁니다.`)) return;
        await window.findInside.removeMail(account.id);
        await loadMailAccounts();
        if (queryEl.value.trim()) runSearch();
      })
    );
    card.append(info, actions);
    return card;
  });
  const actions = document.createElement("div");
  actions.className = "mailConnect";
  actions.append(
    button("지금 새 메일 가져오기", "primary", () => document.querySelector("#syncMail").click()),
    button("+ 계정 추가", "secondary", () => openMailDialog(null, "imap"))
  );
  const status = document.createElement("p");
  status.textContent = mailStatusEl.textContent;
  panel.replaceChildren(title, ...cards, actions, status);
}

// ---- 메일 ----
function mailSummary(item) {
  const date = item.date ? item.date.slice(0, 10) : "";
  const account = mailAccounts.find((account) => account.id === item.account);
  return [item.sender, date, [account?.name || account?.email, item.folder].filter(Boolean).join(" · ")].filter(Boolean).join("  |  ");
}

async function openMailItem(item) {
  hintEl.classList.remove("warn");
  hintEl.textContent = "메일 서버에서 메일을 받아 여는 중…";
  try {
    await window.findInside.openMail(item.path);
    hintEl.textContent = `메일을 열었습니다: ${item.name}`;
  } catch (error) {
    hintEl.classList.add("warn");
    hintEl.textContent = `메일을 열지 못했습니다: ${String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`;
  }
}

let mailAccounts = [];
const mailAccountsEl = document.querySelector("#mailAccounts");
const mailStatusEl = document.querySelector("#mailStatus");
const mailDialog = document.querySelector("#mailDialog");
const mailForm = document.querySelector("#mailForm");
const mailTestResult = document.querySelector("#mailTestResult");
let editingAccount = null;

function renderMailAccounts() {
  mailAccountsEl.replaceChildren(...mailAccounts.map((account) => {
    const item = document.createElement("div");
    item.className = "root";
    const label = document.createElement("span");
    label.textContent = account.name || account.email || account.user;
    label.title = [`${account.user} @ ${account.host}:${account.port}`, account.lastSync ? `마지막 가져오기: ${account.lastSync.slice(0, 16).replace("T", " ")}` : "", account.lastError ? `오류: ${account.lastError}` : ""].filter(Boolean).join("\n");
    if (account.lastError) label.textContent += " ⚠";
    label.style.cursor = "pointer";
    label.addEventListener("click", () => openMailDialog(account));
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.title = "계정 삭제 (이 계정에서 가져온 메일 색인도 지웁니다)";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      if (!confirm(`"${label.textContent}" 계정을 삭제할까요? 이 계정에서 가져온 메일 색인도 지웁니다.`)) return;
      await window.findInside.removeMail(account.id);
      await loadMailAccounts();
      if (queryEl.value.trim()) runSearch();
    });
    item.append(label, remove);
    return item;
  }));
  document.querySelector("#syncMail").hidden = !mailAccounts.length;
  if (source === "mail") renderMailPanel();
}

async function loadMailAccounts() {
  mailAccounts = await window.findInside.mailAccounts();
  renderMailAccounts();
}

function formAccount() {
  const data = new FormData(mailForm);
  return {
    id: editingAccount?.id,
    protocol: data.get("protocol"),
    preset: data.get("preset") || "",
    name: data.get("name").trim() || data.get("email").trim(),
    email: data.get("email").trim(),
    host: data.get("host").trim(),
    port: Number(data.get("port")),
    security: data.get("security"),
    user: data.get("user").trim() || data.get("email").trim(),
    allowSelfSigned: data.get("allowSelfSigned") === "on"
  };
}

// 메일 서비스별 서버 정보. 고르면 서버·포트·보안 방식을 채운다 (사용자가 바꿀 수 있음).
// 서비스마다 IMAP/POP3 사용 설정을 켜고 "앱 비밀번호"를 따로 만들어야 하는 경우가 많다.
const MAIL_PRESETS = {
  mailplug: { imap: ["imap.mailplug.co.kr", 993, "ssl"], note: "비밀번호는 메일플러그의 앱 비밀번호를 넣으세요." },
  naver: { imap: ["imap.naver.com", 993, "ssl"], pop3: ["pop.naver.com", 995, "ssl"], note: "네이버 메일 설정에서 IMAP 사용을 켜 주세요." },
  daum: { imap: ["imap.daum.net", 993, "ssl"], pop3: ["pop.daum.net", 995, "ssl"], note: "다음 메일 설정에서 IMAP 사용을 켜 주세요." },
  gmail: { imap: ["imap.gmail.com", 993, "ssl"], pop3: ["pop.gmail.com", 995, "ssl"], note: "비밀번호는 Google 앱 비밀번호(16자리)를 넣으세요." },
  outlook: { imap: ["outlook.office365.com", 993, "ssl"], pop3: ["outlook.office365.com", 995, "ssl"], note: "비밀번호는 앱 비밀번호가 필요할 수 있습니다." }
};

function applyPreset() {
  const preset = MAIL_PRESETS[mailForm.elements.preset.value];
  const note = document.querySelector("#mailPresetNote");
  note.textContent = preset?.note || "서버 정보는 메일 서비스의 IMAP/POP3 설정 안내를 보고 고급 설정에 넣으세요.";
  // 직접 입력이거나 서비스에 그 연결 방식 정보가 없으면 고급 설정을 펼친다
  document.querySelector("#mailAdvanced").open = !preset || !preset[mailForm.elements.protocol.value];
  if (!preset) return;
  const settings = preset[mailForm.elements.protocol.value];
  if (!settings) {
    mailForm.elements.host.value = "";
    return;
  }
  const [host, port, security] = settings;
  mailForm.elements.host.value = host;
  mailForm.elements.security.value = security;
  mailForm.elements.port.value = String(port);
  document.querySelector("#mailNoTls").hidden = true;
}

function renderConnectionSummary() {
  let summary = document.querySelector("#mailConnectionSummary");
  if (!summary) {
    summary = document.createElement("p");
    summary.id = "mailConnectionSummary";
    summary.className = "filterHelp";
    document.querySelector("#mailPresetNote").after(summary);
  }
  const { protocol, host, port, security } = mailForm.elements;
  const securityText = { ssl: "SSL", starttls: "STARTTLS", none: "암호화 안 함" }[security.value];
  summary.textContent = host.value ? `연결: ${protocol.value.toUpperCase()} ${host.value} · 포트 ${port.value} · ${securityText} (고급 설정에서 바꿀 수 있음)` : "";
}

mailForm.elements.preset.addEventListener("change", applyPreset);
mailForm.addEventListener("input", renderConnectionSummary);
mailForm.addEventListener("change", renderConnectionSummary);

// 아이디는 보통 메일 주소 전체라서, 이메일을 넣으면 아이디 칸을 채운다
let lastEmail = "";
mailForm.elements.email.addEventListener("input", () => {
  const user = mailForm.elements.user;
  if (!user.value || user.value === lastEmail) user.value = mailForm.elements.email.value.trim();
  lastEmail = mailForm.elements.email.value.trim();
});

function applyProtocol() {
  const pop = mailForm.elements.protocol.value === "pop3";
  document.querySelector("#mailHostLabel").textContent = pop ? "POP3 서버" : "IMAP 서버";
  mailForm.elements.host.placeholder = pop ? "예: pop.company.com" : "예: imap.company.com";
}

function defaultPort() {
  const pop = mailForm.elements.protocol.value === "pop3";
  const security = mailForm.elements.security.value;
  if (pop) return security === "ssl" ? "995" : "110";
  return security === "ssl" ? "993" : "143";
}

function openMailDialog(account = null, protocol = "imap") {
  editingAccount = account;
  mailForm.reset();
  mailForm.elements.protocol.value = account?.protocol || protocol;
  for (const [key, value] of Object.entries(account || {})) {
    const field = mailForm.elements[key];
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  }
  mailForm.elements.password.placeholder = account ? "바꾸지 않으려면 비워 두세요" : "";
  if (!account) mailForm.elements.port.value = defaultPort();
  lastEmail = account?.email || "";
  applyProtocol();
  if (account) {
    document.querySelector("#mailPresetNote").textContent = "";
    document.querySelector("#mailAdvanced").open = !account.preset;
  } else {
    applyPreset(); // 새 계정은 첫 번째 서비스(메일플러그) 값으로 채워 둔다
  }
  renderConnectionSummary();
  mailTestResult.textContent = "";
  document.querySelector("#mailNoTls").hidden = mailForm.elements.security.value !== "none";
  mailDialog.showModal();
}

// 보안 방식을 바꾸면 흔히 쓰는 포트를 채워 준다 (직접 바꿀 수 있음)
mailForm.elements.security.addEventListener("change", () => {
  const port = mailForm.elements.port;
  if (["993", "143", "995", "110", ""].includes(port.value)) port.value = defaultPort();
  document.querySelector("#mailNoTls").hidden = mailForm.elements.security.value !== "none";
});
mailForm.elements.protocol.addEventListener("change", () => {
  const port = mailForm.elements.port;
  if (["993", "143", "995", "110", ""].includes(port.value)) port.value = defaultPort();
  applyProtocol();
  applyPreset();
});

document.querySelector("#addMailAccount").addEventListener("click", () => openMailDialog());
document.querySelector("#mailCancel").addEventListener("click", () => mailDialog.close());

document.querySelector("#mailTest").addEventListener("click", async () => {
  mailTestResult.textContent = "연결하는 중…";
  try {
    const result = await window.findInside.testMail(formAccount(), mailForm.elements.password.value);
    mailTestResult.textContent = `✔ 연결 성공 — 폴더 ${result.folders}개, 받은편지함 메일 ${result.inboxMessages.toLocaleString()}통`;
  } catch (error) {
    mailTestResult.textContent = `✖ 연결 실패: ${String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`;
  }
});

mailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const account = formAccount();
  const password = mailForm.elements.password.value;
  if (!account.id && !password) {
    mailTestResult.textContent = "비밀번호를 입력하세요.";
    return;
  }
  if (account.security === "none" && !confirm("암호화하지 않고 연결합니다. 비밀번호와 메일이 그대로 전송됩니다. 계속할까요?")) return;
  await window.findInside.saveMail(account, password);
  mailDialog.close();
  await loadMailAccounts();
  mailStatusEl.textContent = "메일을 가져오는 중…";
});

document.querySelector("#syncMail").addEventListener("click", () => {
  mailStatusEl.textContent = "새 메일을 가져오는 중…";
  window.findInside.syncMail();
});

window.findInside.onMailProgress(async (progress) => {
  const account = mailAccounts.find((item) => item.id === progress.account);
  const label = account?.name || account?.email || "메일";
  if (progress.finished) {
    mailStatusEl.textContent = progress.error ? `${label}: 가져오기 실패 — ${progress.error}` : `${label}: 새 메일 ${progress.fetched.toLocaleString()}통 가져옴`;
    await loadMailAccounts();
  } else if (progress.total) {
    mailStatusEl.textContent = `${label} ${progress.folder}: ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`;
  } else if (progress.started) {
    mailStatusEl.textContent = `${label}: 메일 서버에 연결하는 중…`;
  }
  if (source === "mail") renderMailPanel();
});

loadMailAccounts();

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
  const path = event.composedPath();
  if (
    !filterPanelEl.hidden
    && !path.includes(filterPanelEl)
    && !path.includes(filterBarEl)
  ) setFilterPanelOpen(false);
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

// 목록에서 고르면 기존 확장자에 더한다 (바꾸지 않는다).
extensionSelectEl.addEventListener("change", () => {
  if (!extensionSelectEl.value) return;
  setExtensions([...filters.extensions, extensionSelectEl.value]);
  onFiltersChanged();
});

// 직접 입력: Enter·쉼표·띄어쓰기로 추가, 빈 칸에서 Backspace를 누르면 마지막 확장자를 뺀다.
function addTypedExtensions() {
  const typed = extensionInputEl.value.split(/[\s,;]+/).filter(Boolean);
  extensionInputEl.value = "";
  if (!typed.length) return;
  setExtensions([...filters.extensions, ...typed]);
  onFiltersChanged();
  extensionInputEl.focus();
}

extensionInputEl.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" || event.key === "," || event.key === " ") {
    event.preventDefault();
    addTypedExtensions();
  } else if (event.key === "Backspace" && !extensionInputEl.value && filters.extensions.length) {
    toggleExtension(filters.extensions[filters.extensions.length - 1]);
    extensionInputEl.focus();
  }
});
extensionInputEl.addEventListener("blur", () => { if (extensionInputEl.value.trim()) addTypedExtensions(); });
extensionTagsEl.addEventListener("click", () => extensionInputEl.focus());

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

let ocrStatus = "";

window.findInside.onIndexProgress((progress) => {
  if (progress.phase === "ocr" || progress.phase === "ocr-precise") {
    const label = progress.phase === "ocr" ? "이미지 OCR" : "이미지 OCR 정밀 판독";
    ocrStatus = progress.finished
      ? (progress.error ? `${label} 중단: ${progress.error}` : `${label} 완료`)
      : `${label} 중… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`;
    const lines = statusEl.textContent.split("\n").filter((line) => !line.startsWith("이미지 OCR"));
    statusEl.textContent = [...lines, ocrStatus].join("\n");
    return;
  }
  if (progress.phase !== "content") {
    statusEl.textContent = `${progress.scanned.toLocaleString()}개 항목 확인 중…`;
    return;
  }
  contentIndexing = true;
  statusEl.textContent = `${ocrStatus ? `${ocrStatus}\n` : ""}파일 내용 색인 중… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}
끝난 파일부터 검색 결과에 반영됩니다.`;
  // 색인 중에도 검색어가 있으면 몇 초마다 결과를 새로 고쳐 새로 색인된 내용을 보여 준다.
  if (queryEl.value.trim() && Date.now() - lastProgressSearch > 5000) {
    lastProgressSearch = Date.now();
    runSearch();
  }
});

window.findInside.onIndexDone(showIndexDone);
// 폴더 감시로 새 파일·바뀐 파일의 내용 색인이 끝나면 지금 검색어로 결과를 새로 고친다.
let lastChangedSearch = 0;
window.findInside.onIndexChanged(() => {
  // 새 파일이 자주 반영되면 결과가 계속 다시 그려져 클릭이 막힌다. 10초에 한 번 이하, 입력 중이 아닐 때만.
  if (!queryEl.value.trim() || document.activeElement === queryEl || Date.now() - lastChangedSearch < 10_000) return;
  lastChangedSearch = Date.now();
  runSearch();
});

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
  } else {
    statusEl.textContent = "색인할 폴더를 선택하세요.";
  }
  setFilterPanelOpen(loadFilterPanelOpen());
  renderResults([]);
})();
