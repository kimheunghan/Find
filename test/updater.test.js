"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const updater = require("../src/updater");

const SHA = "a".repeat(64);
const good = { version: "1.0.7", url: "https://findinside.pages.dev/download/Find_Setup_v1.0.7.exe", sha256: SHA, notes: "바뀐 점" };

test("판 번호는 숫자로 비교한다", () => {
  assert.ok(updater.compareVersions("1.0.10", "1.0.9") > 0);
  assert.ok(updater.compareVersions("1.0.6", "1.0.7") < 0);
  assert.equal(updater.compareVersions("1.0.6", "1.0.6"), 0);
  assert.equal(updater.compareVersions("1.1", "1.1.0"), 0);
});

test("설치 파일은 정해 둔 우리 주소에서만 받는다", () => {
  assert.ok(updater.isAllowedUrl("https://findinside.pages.dev/download/Find_Setup_v1.0.7.exe"));
  assert.ok(updater.isAllowedUrl("https://findinside.netlify.app/download/Find_Setup_v1.0.7.exe"));
  assert.ok(!updater.isAllowedUrl("http://findinside.pages.dev/download/Find_Setup_v1.0.7.exe"));
  assert.ok(!updater.isAllowedUrl("https://github.com/kimheunghan/findinside-download/releases/download/v1.0.7/Find_Setup.exe"));
  assert.ok(!updater.isAllowedUrl("https://findinside.pages.dev.evil.com/download/x.exe"));
  assert.ok(!updater.isAllowedUrl("https://findinside.pages.dev/download/../evil.exe"));
  assert.ok(!updater.isAllowedUrl("https://findinside.pages.dev/other/x.exe"));
  assert.ok(!updater.isAllowedUrl(null));
});

test("정보 파일이 이상하면 업데이트하지 않는다", () => {
  assert.deepEqual(updater.parseInfo(good), good);
  assert.equal(updater.parseInfo({ ...good, sha256: SHA.toUpperCase() }).sha256, SHA);
  assert.equal(updater.parseInfo(null), null);
  assert.equal(updater.parseInfo({ ...good, version: "새 판" }), null);
  assert.equal(updater.parseInfo({ ...good, sha256: "1234" }), null);
  assert.equal(updater.parseInfo({ ...good, url: "https://example.com/download/x.exe" }), null);
});

test("시험용 정보 파일 주소를 주면 그 곳에서 받는 것도 허락한다", () => {
  const { infoUrl, allowed } = updater.sources({ FINDINSIDE_UPDATE_INFO: "http://127.0.0.1:8765/latest.json" });
  assert.equal(infoUrl, "http://127.0.0.1:8765/latest.json");
  assert.ok(updater.isAllowedUrl("http://127.0.0.1:8765/Find_Setup_v1.0.7.exe", allowed));
  assert.equal(updater.sources({}).infoUrl, updater.INFO_URL);
});

test("인터넷이 안 되거나 답이 이상하면 조용히 null", async () => {
  const offline = async () => { throw new TypeError("fetch failed"); };
  assert.equal(await updater.fetchInfo({ fetch: offline, infoUrl: updater.INFO_URL }), null);
  const notFound = async () => new Response("없음", { status: 404 });
  assert.equal(await updater.fetchInfo({ fetch: notFound, infoUrl: updater.INFO_URL }), null);
  const broken = async () => new Response("{깨짐", { status: 200 });
  assert.equal(await updater.fetchInfo({ fetch: broken, infoUrl: updater.INFO_URL }), null);
  const ok = async () => Response.json(good);
  assert.deepEqual(await updater.fetchInfo({ fetch: ok, infoUrl: updater.INFO_URL }), good);
});

test("받은 설치 파일의 확인값이 다르면 지우고 깔지 않는다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "findinside-update-"));
  try {
    const body = Buffer.from("설치 파일 내용");
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    const serve = async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    const seen = [];
    const file = await updater.download({ fetch: serve, info: { ...good, sha256 }, dir, onProgress: (r) => seen.push(r) });
    assert.equal(file, path.join(dir, "Find_Setup_v1.0.7.exe"));
    assert.deepEqual(fs.readFileSync(file), body);
    assert.equal(seen.at(-1), 1);

    const wrong = await updater.download({ fetch: serve, info: { ...good, version: "1.0.8", sha256: SHA }, dir });
    assert.equal(wrong, null);
    assert.ok(!fs.existsSync(path.join(dir, "Find_Setup_v1.0.8.exe")));

    const failing = async () => { throw new TypeError("fetch failed"); };
    assert.equal(await updater.download({ fetch: failing, info: { ...good, version: "1.0.9" }, dir }), null);
    assert.ok(!fs.existsSync(path.join(dir, "Find_Setup_v1.0.9.exe")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store판·개발 중 실행은 업데이트하지 않고, 설치 파일판·개인용은 알아본다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "findinside-kind-"));
  try {
    const exePath = path.join(dir, "FindInside.exe");
    assert.equal(updater.installKind({ isPackaged: false, exePath }), null);
    assert.equal(updater.installKind({ isPackaged: true, windowsStore: true, exePath }), null);
    assert.equal(updater.installKind({ isPackaged: true, exePath }), null);
    fs.writeFileSync(path.join(dir, "Uninstall FindInside.exe"), "");
    assert.equal(updater.installKind({ isPackaged: true, exePath }), "installer");
    fs.writeFileSync(path.join(dir, updater.PERSONAL_MARK), "{}");
    assert.equal(updater.installKind({ isPackaged: true, exePath }), "personal");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("하루에 한 번: 이 PC 날짜", () => {
  assert.equal(updater.localDay(new Date(2026, 10, 27, 23, 59)), "2026-11-27");
  assert.equal(updater.localDay(new Date(2026, 0, 5)), "2026-01-05");
});
