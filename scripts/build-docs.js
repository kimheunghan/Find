"use strict";

// 이용약관·개인정보처리방침·오픈소스 고지·판매 페이지를 product.json 값으로 채워 만든다.
//   legal/*.html, web/*  →  src/legal/ (앱에 들어감), site/ (판매 페이지로 올릴 파일)
// 비어 있는 값(가격·문의 이메일·구매 링크 등)은 경고로 알린다. 판매 전에 product.json을 채울 것.
// 실행: node scripts/build-docs.js
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const product = JSON.parse(fs.readFileSync(path.join(root, "src", "product.json"), "utf8"));
const escape = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const missing = [];
const need = (value, label) => {
  if (!value) missing.push(label);
  return value;
};

const email = need(product.supportEmail, "supportEmail (문의 이메일)");
const checkout = need(product.lemonSqueezy.checkoutUrl, "lemonSqueezy.checkoutUrl (구매 링크)");
const download = need(product.downloadUrl, "downloadUrl (체험판 내려받기 링크)");
need(product.price, "price (가격)");
need(product.website, "website (판매 페이지 주소)");
need(product.lemonSqueezy.storeId, "lemonSqueezy.storeId (다른 가게 키 막기)");
need(product.lemonSqueezy.productId, "lemonSqueezy.productId (다른 제품 키 막기)");

const values = {
  OWNER: escape(product.owner),
  EFFECTIVE_DATE: escape(product.effectiveDate),
  TRIAL_DAYS: product.trialDays,
  REFUND_DAYS: product.refundDays,
  ACTIVATION_LIMIT: product.activationLimit,
  PRICE: escape(product.price || "가격 준비 중"),
  CONTACT: email ? `문의: <a href="mailto:${escape(email)}">${escape(email)}</a>` : "문의: 준비 중",
  BUY_BUTTON: checkout ? `<a class="button primary" href="${escape(checkout)}">구매하기</a>` : "",
  BUY_BUTTON_GHOST: checkout ? `<a class="button ghost" href="${escape(checkout)}">구매하기 ₩${escape(String(product.price || "").replace(/^₩/, ""))}</a>` : "",
  // 체험판은 Microsoft Store가 기본 (스토어가 서명해 Windows·백신 경고가 없다). 설치 파일 직접 받기는 보조 링크
  DOWNLOAD_BUTTON: product.storeUrl ? `<a class="button primary" href="${escape(product.storeUrl)}">Microsoft Store에서 무료 체험</a>` : download ? `<a class="button primary" href="${escape(download)}">무료 체험판 내려받기</a>` : "",
  STORE_LINK: product.storeUrl ? escape(product.storeUrl) : (download ? escape(download) : "#"),
  DOWNLOAD_LINK: download ? escape(download) : "#",
  CHECKOUT_LINK: checkout ? escape(checkout) : "#pricing"
};
const fill = (text) => text.replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
  if (!(key in values)) throw new Error(`알 수 없는 값: ${all}`);
  return values[key];
});

// 오픈소스 고지: 앱에 들어가는 라이브러리(개발 도구 제외)의 이름·버전·라이선스 전문
function notices() {
  const listed = execSync("npm ls --omit=dev --all --parseable", { cwd: root, encoding: "utf8" })
    .split(/\r?\n/).filter(Boolean).filter((dir) => path.resolve(dir) !== root);
  const seen = new Map();
  for (const dir of listed) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    const licenseFile = fs.readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), "utf8").trim() : `License: ${pkg.license || "(표기 없음)"}`;
    seen.set(id, { id, license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type || "", text, homepage: pkg.homepage || pkg.repository?.url || "" });
  }
  const sections = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)).map((item) =>
    `${"-".repeat(72)}\n${item.id}${item.license ? ` (${item.license})` : ""}\n${item.homepage}\n\n${item.text}\n`);
  return [
    "FindInside 오픈소스 라이선스 고지 (Third-party notices)",
    "",
    "FindInside는 아래 오픈소스 소프트웨어를 사용합니다. 각 소프트웨어의 저작권과 라이선스는 해당 저작자에게 있습니다.",
    "Electron과 Chromium의 라이선스는 설치 폴더의 LICENSE.electron.txt, LICENSES.chromium.html에 있습니다.",
    "",
    "-".repeat(72),
    "Unicode Character Database — Unihan (kHangul) 한자 한글 음 데이터 (src/data/hanja-hangul.json)",
    "https://www.unicode.org/license.txt",
    "",
    "UNICODE LICENSE V3. Copyright © 1991-2025 Unicode, Inc. Permission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated documentation (the \"Data Files\") or software and any associated documentation (the \"Software\") to deal in the Data Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation. THE DATA FILES AND SOFTWARE ARE PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND.",
    "",
    ...sections
  ].join("\n");
}

function write(target, text) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

const legalOut = path.join(root, "src", "legal");
const siteOut = path.join(root, "site");
for (const name of ["terms.html", "privacy.html"]) {
  const html = fill(fs.readFileSync(path.join(root, "legal", name), "utf8"));
  write(path.join(legalOut, name), html);
  write(path.join(siteOut, name), html);
}
for (const out of [legalOut, siteOut]) fs.copyFileSync(path.join(root, "legal", "legal.css"), path.join(out, "legal.css"));
write(path.join(siteOut, "index.html"), fill(fs.readFileSync(path.join(root, "web", "index.html"), "utf8")));
fs.copyFileSync(path.join(root, "web", "site.css"), path.join(siteOut, "site.css"));
fs.copyFileSync(path.join(root, "web", "icon.png"), path.join(siteOut, "icon.png"));
const noticeText = notices();
write(path.join(legalOut, "THIRD-PARTY-NOTICES.txt"), noticeText);
write(path.join(siteOut, "third-party-notices.txt"), noticeText);

console.log(`문서: src/legal (앱), site (판매 페이지) · 오픈소스 ${noticeText.split("-".repeat(72)).length - 2}개`);
if (missing.length) console.warn(`\n⚠ 판매 전에 src/product.json에 채울 값:\n  - ${missing.join("\n  - ")}\n`);
module.exports = { missing };
