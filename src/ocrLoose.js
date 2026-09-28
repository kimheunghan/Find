"use strict";

// OCR이 자주 헷갈리는 한글 모음을 같은 글자로 바꾼다: ㅐ·ㅔ·ㅓ → ㅓ, ㅒ·ㅖ·ㅕ → ㅕ
// (예: 화면의 "전경애"를 OCR이 "전경에", "전경어"로 읽어도 같은 글자열 "전경어"가 된다).
// 이미지 OCR 결과에만 쓴다. 글자 수가 그대로라 찾은 위치를 원문 강조에 그대로 쓸 수 있다.
const BASE = 0xac00;
const MEDIAL = 21 * 28;
const FINAL = 28;
// 중성 번호: ㅐ=1, ㅒ=3, ㅓ=4, ㅔ=5, ㅕ=6, ㅖ=7
const VOWEL_CLASS = { 1: 4, 5: 4, 3: 6, 7: 6 };

function looseText(text) {
  let out = "";
  for (const char of String(text ?? "")) {
    const code = char.codePointAt(0);
    if (code >= BASE && code <= 0xd7a3) {
      const offset = code - BASE;
      const initial = Math.floor(offset / MEDIAL);
      const medial = Math.floor((offset % MEDIAL) / FINAL);
      const final = offset % FINAL;
      const mapped = VOWEL_CLASS[medial] ?? medial;
      out += String.fromCharCode(BASE + initial * MEDIAL + mapped * FINAL + final);
    } else {
      out += char;
    }
  }
  return out;
}

module.exports = { looseText };
