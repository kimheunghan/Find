"use strict";

// 한자를 한글 음으로 읽는다. 족보·옛 문서처럼 이름이 한자로 적힌 자료를 한글로 찾기 위해서다
// (예: 全京愛 → 전경애. OCR이 작은 한글 "전경애"를 "진경에"로 틀려도 옆의 한자로 찾을 수 있다).
// 음 데이터: Unicode Unihan 데이터베이스 kHangul (https://www.unicode.org/terms_of_use.html)
const table = require("./data/hanja-hangul.json");

const HAN = /\p{Script=Han}/u;

// 한자를 한글 음으로 바꾼 글자열들을 돌려준다. 음이 둘 이상인 한자(金 → 금/김)는 첫째 음과 둘째 음으로 두 가지를 만든다.
// 바꾼 글자열은 원문과 글자 수(UTF-16 길이)가 같아서, 음으로 찾은 위치를 원문 강조에 그대로 쓸 수 있다.
function hangulReadings(text) {
  const value = String(text ?? "");
  if (!HAN.test(value)) return [];
  const chars = [...value];
  const pick = (index) => chars.map((char) => {
    const readings = char.length === 1 ? table[char] : null;
    if (!readings) return char;
    const list = [...readings];
    return list[Math.min(index, list.length - 1)];
  }).join("");
  const first = pick(0);
  const second = pick(1);
  return first === second ? [first] : [first, second];
}

module.exports = { hangulReadings };
