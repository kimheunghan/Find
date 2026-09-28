"use strict";

// ADR-0002: 한국어·한자·가나는 2글자 단위(bigram), 영문·숫자는 단어 단위로 토큰을 만든다.
const TOKENIZER_VERSION = 1;
const RUN_PATTERN = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{N}]+/gu;
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

function toTokens(text) {
  return textRuns(text).flatMap(runTokens);
}

// 한 글자 한국어처럼 bigram 색인으로 찾을 수 없는 검색어인지 확인한다.
function needsScan(term) {
  return textRuns(term).some((run) => CJK_PATTERN.test(run) && run.length === 1);
}

// 검색어 하나를 FTS5 구문 검색식으로 바꾼다. 토큰에는 문자·숫자만 있으므로 따옴표 이스케이프가 필요 없다.
function toMatchPhrase(term) {
  const tokens = toTokens(term);
  return tokens.length ? `"${tokens.join(" ")}"` : null;
}

module.exports = { TOKENIZER_VERSION, normalizeText, toTokens, needsScan, toMatchPhrase };
