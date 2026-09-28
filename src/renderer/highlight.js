"use strict";

// 검색어 강조 규칙. 화면(제목·경로)과 본문 미리보기(contentIndex)가 같은 규칙을 쓴다.
// 검색(tokens.js)과 같은 방식으로 검색어를 글자 묶음(한글·한자·가나 / 영문·숫자)으로 나누고,
// 묶음 사이에는 띄어쓰기·특수문자가 있어도 없어도 일치로 본다. 예: "서버01"은 "서버-01", "서버 01"과도 일치.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FindHighlight = factory();
})(typeof self !== "undefined" ? self : this, () => {
  // tokens.js와 같은 규칙: 한글·한자·가나 / 그 밖의 글자 / 숫자 묶음으로 나눈다.
  const CJK = "\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
  const RUN_PATTERN = new RegExp(`[${CJK}]+|(?:(?![${CJK}])\\p{L})+|\\p{N}+`, "gu");
  const GAP = "[^\\p{L}\\p{N}]*";

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 화면에 보여 줄 글자. 분리된 한글 자모(맥에서 만든 파일명 등)를 합치고 호환 문자를 정리한다.
  function displayText(value) {
    return String(value ?? "").normalize("NFKC");
  }

  // 띄어쓰기 없이 문장부호가 섞인 검색어(IP, 번호, "IP,계정")는 글자 그대로 일치해야 한다.
  function isStrictTerm(term) {
    const normalized = displayText(term).trim();
    return !/\s/.test(normalized) && /[\p{L}\p{N}]/u.test(normalized) && /[^\p{L}\p{N}]/u.test(normalized);
  }

  function termRegex(term) {
    const normalized = displayText(term).trim();
    if (!normalized) return null;
    if (isStrictTerm(normalized)) return new RegExp(escapeRegExp(normalized), "giu");
    const runs = normalized.match(RUN_PATTERN);
    const source = runs ? runs.map(escapeRegExp).join(GAP) : escapeRegExp(normalized);
    return new RegExp(source, "giu");
  }

  // text 안에서 검색어들이 일치하는 구간 [시작, 끝]을 겹치지 않게, 긴 일치를 우선해 돌려준다.
  // Node(색인·본문 미리보기)에서는 한자를 한글 음으로도 맞춰 본다 (全京愛 ↔ 전경애). 음으로 바꾼 글자열은
  // 원문과 길이가 같아 찾은 위치를 그대로 한자 강조에 쓴다. 화면(브라우저)에서는 제목·경로만 강조하므로 쓰지 않는다.
  let hangulReadings = () => [];
  if (typeof module === "object" && module.exports && typeof require === "function") {
    try {
      hangulReadings = require("../hanja").hangulReadings;
    } catch {
      // 한자음 데이터가 없으면 원문만 맞춰 본다
    }
  }

  function findRanges(text, terms) {
    const ranges = [];
    const variants = [text, ...hangulReadings(text)];
    for (const term of terms) {
      const pattern = termRegex(term);
      if (!pattern) continue;
      for (const variant of variants) {
        for (const match of variant.matchAll(pattern)) {
          if (match[0].length) ranges.push([match.index, match.index + match[0].length]);
        }
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
    const accepted = [];
    for (const range of ranges) {
      if (!accepted.length || range[0] >= accepted[accepted.length - 1][1]) accepted.push(range);
    }
    return accepted;
  }

  // 검색창 입력을 강조용 검색어로 나눈다. 따옴표 안은 하나의 검색어다.
  function queryTerms(query) {
    const terms = [];
    const pattern = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = pattern.exec(String(query ?? ""))) !== null) {
      const term = (match[1] || match[2]).trim();
      if (term) terms.push(term);
    }
    return terms;
  }

  return { displayText, isStrictTerm, termRegex, findRanges, queryTerms };
});
