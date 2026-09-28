"use strict";

// ADR-0002: 한국어·한자·가나는 2글자 단위(bigram), 영문 등 나머지 글자와 숫자는 각각 단어 단위로 토큰을 만든다.
// 영문과 숫자는 서로 나눈다. OCR이 "WEB01IP10.0.3.21"처럼 붙여 읽어도 "10.0.3.21", "web01"로 찾을 수 있다.
// 버전 2: 영문·숫자 분리, 영문 뒤에 붙은 한글("web서버")을 한글 묶음으로 분리
// 버전 3: 한 글자 검색용 글자 색인(chunk_chars) 추가
// 버전 4: 한자를 한글 음으로도 색인 (全京愛 → 전경애, 金 → 금·김)
const TOKENIZER_VERSION = 4;
const { hangulReadings } = require("./hanja");
const CJK = "\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const RUN_PATTERN = new RegExp(`[${CJK}]+|(?:(?![${CJK}])\\p{L})+|\\p{N}+`, "gu");
const CJK_PATTERN = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

function textRuns(text) {
  return normalizeText(text).match(RUN_PATTERN) || [];
}

function runTokens(run) {
  if (!CJK_PATTERN.test(run) || run.length === 1) return [run];
  const tokens = [];
  for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
  return tokens;
}

// 한자가 있으면 한글 음으로 바꾼 글자열의 토큰도 뒤에 덧붙인다 (원문 토큰 사이 순서는 그대로라 구문 검색이 깨지지 않는다).
function toTokens(text) {
  const tokens = textRuns(text).flatMap(runTokens);
  for (const reading of hangulReadings(text)) tokens.push(...textRuns(reading).flatMap(runTokens));
  return tokens;
}

// 한 글자 검색("치")용: 조각에 들어 있는 한글·한자·가나 글자를 중복 없이 모은다.
function toChars(text) {
  const runs = [text, ...hangulReadings(text)].flatMap((value) => textRuns(value));
  return [...new Set(runs.filter((run) => CJK_PATTERN.test(run)).flatMap((run) => [...run]))];
}

// 검색어가 한글·한자·가나 한 글자뿐인지 (글자 색인으로 찾는다).
function singleChar(term) {
  const runs = textRuns(term);
  return runs.length === 1 && CJK_PATTERN.test(runs[0]) && [...runs[0]].length === 1 ? runs[0] : null;
}

// 한 글자 한국어처럼 bigram 색인으로 찾을 수 없는 검색어인지 확인한다.
function needsScan(term) {
  return textRuns(term).some((run) => CJK_PATTERN.test(run) && run.length === 1);
}

// 검색어 하나를 FTS5 구문 검색식으로 바꾼다. 토큰에는 문자·숫자만 있으므로 따옴표 이스케이프가 필요 없다.
function toMatchPhrase(term) {
  const runs = textRuns(term);
  if (!runs.length) return null;
  const phrases = [runs.flatMap(runTokens).join(" ")];
  // "설치 정보"로 검색하면 "설치정보"도 찾는다 (한글 묶음끼리 이어 붙인 형태).
  const joined = [];
  for (const run of runs) {
    const last = joined[joined.length - 1];
    if (last !== undefined && CJK_PATTERN.test(last) && CJK_PATTERN.test(run)) joined[joined.length - 1] = last + run;
    else joined.push(run);
  }
  if (joined.length !== runs.length) phrases.push(joined.flatMap(runTokens).join(" "));
  // 영문으로 끝나면 앞부분 일치("web" → "webserver")도 찾는다. 숫자는 IP·번호를 정확히 찾도록 앞부분 일치를 쓰지 않는다.
  const prefix = /^\p{L}/u.test(runs[runs.length - 1]) && !CJK_PATTERN.test(runs[runs.length - 1]) ? "*" : "";
  return phrases.map((phrase) => `"${phrase}"${prefix}`).join(" OR ");
}

module.exports = { TOKENIZER_VERSION, normalizeText, textRuns, toTokens, toChars, singleChar, needsScan, toMatchPhrase };
