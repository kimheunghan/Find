"use strict";

// 오탈자 검색: 검색어와 한 글자(한글은 자모 하나)만 다른 말도 찾는다.
// 한글: "견젹서" → "견적서" (초성·중성·종성 중 하나가 다름, 받침이 빠지거나 더해진 것 포함)
// 영문: "reprot" → "report" (한 글자 바뀜·빠짐·더함, 이웃한 두 글자 자리 바뀜)
// 정확히 일치하는 결과가 적을 때만 쓴다 (결과가 많을 때 섞으면 엉뚱한 결과가 늘어난다).

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
const HANGUL_SYLLABLE = /^[가-힣]$/;
const LATIN_WORD = /^[a-z]+$/;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

const isSyllable = (char) => HANGUL_SYLLABLE.test(char);

// 한글 음절 하나를 초성·중성·종성 번호로 나눈다
function splitSyllable(char) {
  const code = char.codePointAt(0) - SYLLABLE_START;
  return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28];
}

function joinSyllable(initial, medial, final) {
  return String.fromCodePoint(SYLLABLE_START + initial * 588 + medial * 28 + final);
}

// 자모 하나만 다른 음절 (65개)
function syllableVariants(char) {
  const [initial, medial, final] = splitSyllable(char);
  const variants = [];
  for (let i = 0; i < 19; i += 1) if (i !== initial) variants.push(joinSyllable(i, medial, final));
  for (let v = 0; v < 21; v += 1) if (v !== medial) variants.push(joinSyllable(initial, v, final));
  for (let t = 0; t < 28; t += 1) if (t !== final) variants.push(joinSyllable(initial, medial, t));
  return variants;
}

// 영문 단어와 한 번 고쳐서 같아지는 단어들
function wordVariants(word) {
  const variants = new Set();
  for (let i = 0; i < word.length; i += 1) {
    variants.add(word.slice(0, i) + word.slice(i + 1));
    if (i < word.length - 1) variants.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    for (const letter of LETTERS) variants.add(word.slice(0, i) + letter + word.slice(i + 1));
  }
  for (let i = 0; i <= word.length; i += 1) {
    for (const letter of LETTERS) variants.add(word.slice(0, i) + letter + word.slice(i));
  }
  variants.delete(word);
  return [...variants];
}

// 글자열을 자모 단위로 편다 (한글이 아닌 글자는 그대로). 자모 하나 차이를 글자 하나 차이로 보려는 것.
function toJamo(text) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code >= SYLLABLE_START && code <= SYLLABLE_END) {
      const [initial, medial, final] = splitSyllable(char);
      out += String.fromCharCode(0x1100 + initial, 0x1161 + medial);
      if (final) out += String.fromCharCode(0x11a7 + final);
    } else {
      out += char;
    }
  }
  return out;
}

// 이 검색어로 오탈자 검색을 할 만한지: 한글 3음절 이상 또는 영문 4글자 이상
// (2음절은 자모 하나만 바꿔도 다른 낱말이 너무 많다. 예: "보고" → "정보 모음"의 "보모")
function canFuzz(token) {
  const syllables = [...token].filter(isSyllable).length;
  return syllables >= 3 || /[a-z]{4,}/.test(token);
}

// 파일 이름용: 검색어 하나를 오탈자까지 맞춰 볼 준비를 한다
function prepareFuzzy(token) {
  if (!canFuzz(token)) return null;
  const chars = [...new Set([...token].filter(isSyllable))];
  const bigrams = [];
  if (!chars.length) for (let i = 0; i < token.length - 1; i += 1) bigrams.push(token.slice(i, i + 2));
  return { jamo: toJamo(token), chars, needChars: Math.max(1, chars.length - 1), bigrams };
}

// text 안에 검색어와 한 글자(자모)까지만 다른 부분이 있는지.
// 먼저 글자가 겹치는지 싸게 걸러 내고, 남은 것만 자모 단위로 맞춰 본다.
function fuzzyContains(text, fuzzy) {
  if (fuzzy.chars.length) {
    let shared = 0;
    for (const char of fuzzy.chars) if (text.includes(char)) shared += 1;
    if (shared < fuzzy.needChars) return false;
  } else if (!fuzzy.bigrams.some((bigram) => text.includes(bigram))) {
    return false;
  }
  return withinOneEdit(toJamo(text), fuzzy.jamo);
}

// pattern이 text의 어느 부분과 고치기 1번(바꿈·빠짐·더함·이웃 자리 바꿈) 안으로 같은지
function withinOneEdit(text, pattern) {
  const m = pattern.length;
  let before = null;
  let previous = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= text.length; i += 1) {
    const current = [0];
    for (let j = 1; j <= m; j += 1) {
      const cost = text[i - 1] === pattern[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (before && j > 1 && text[i - 1] === pattern[j - 2] && text[i - 2] === pattern[j - 1]) value = Math.min(value, before[j - 2] + 1);
      current.push(value);
    }
    if (current[m] <= 1) return true;
    before = previous;
    previous = current;
  }
  return false;
}

module.exports = { syllableVariants, wordVariants, toJamo, canFuzz, prepareFuzzy, fuzzyContains, withinOneEdit, isSyllable, LATIN_WORD };
