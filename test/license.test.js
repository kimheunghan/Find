"use strict";

// 라이선스: 체험 기간, 시계 되돌리기, Lemon Squeezy 활성화·확인·해제(가짜 서버), 오프라인 유예
const test = require("node:test");
const assert = require("node:assert/strict");
const license = require("../src/license");

const DAY = license.DAY;
const config = { trialDays: 14, offlineGraceDays: 30, revalidateDays: 7, lemonSqueezy: { storeId: 11, productId: 22 } };
const meta = { store_id: 11, product_id: 22, customer_name: "홍길동", customer_email: "hong@example.com", variant_name: "개인용" };

// Lemon Squeezy License API를 흉내 낸다. 보낸 요청을 calls에 남긴다.
function fakeServer(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const action = url.split("/").pop();
    const params = Object.fromEntries(new URLSearchParams(options.body));
    calls.push({ action, params });
    const [status, body] = handler(action, params);
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

test("체험: 14일 동안 쓰고, 끝나면 막힌다. 시계를 되돌려도 늘어나지 않는다", () => {
  const start = Date.UTC(2026, 8, 1);
  let state = license.newState(start);
  assert.deepEqual(license.status(state, start, config), { kind: "trial", allowed: true, daysLeft: 14 });
  assert.equal(license.status(state, start + 13 * DAY, config).daysLeft, 1);
  assert.equal(license.status(state, start + 14 * DAY, config).kind, "expired");
  state = license.touch(state, start + 20 * DAY);
  assert.equal(license.status(state, start + 1 * DAY, config).kind, "expired", "시계를 되돌려도 마지막으로 본 시각 기준");
});

test("활성화: 키와 설치 구분 이름만 보내고, 성공하면 정품", async () => {
  const server = fakeServer((action) => [200, { activated: true, instance: { id: "inst-1" }, meta }]);
  const start = Date.UTC(2026, 8, 1);
  const state = await license.activate(license.newState(start), "  ABCD-1234  ", { fetchImpl: server.fetchImpl, now: start + 20 * DAY, config });
  assert.equal(server.calls[0].action, "activate");
  assert.deepEqual(Object.keys(server.calls[0].params).sort(), ["instance_name", "license_key"]);
  assert.equal(server.calls[0].params.license_key, "ABCD-1234");
  assert.match(server.calls[0].params.instance_name, /^FindInside [0-9a-f]{8}$/);
  const current = license.status(state, start + 20 * DAY, config);
  assert.equal(current.kind, "licensed");
  assert.equal(current.allowed, true);
  assert.equal(current.keyHint, "…1234");
});

test("활성화: 없는 키, 활성화 수 초과는 한국어로 안내", async () => {
  const notFound = fakeServer(() => [404, { activated: false, error: "license_key not found." }]);
  await assert.rejects(license.activate(license.newState(), "X", { fetchImpl: notFound.fetchImpl, config }), /찾을 수 없습니다/);
  const limit = fakeServer(() => [400, { activated: false, error: "This license key has reached the activation limit." }]);
  await assert.rejects(license.activate(license.newState(), "X", { fetchImpl: limit.fetchImpl, config }), /PC 수를 모두/);
});

test("활성화: 다른 제품의 키는 거절하고 바로 해제한다", async () => {
  const server = fakeServer((action) => action === "activate"
    ? [200, { activated: true, instance: { id: "inst-9" }, meta: { ...meta, product_id: 999 } }]
    : [200, { deactivated: true }]);
  await assert.rejects(license.activate(license.newState(), "OTHER", { fetchImpl: server.fetchImpl, config }), /FindInside 라이선스 키가 아닙니다/);
  assert.deepEqual(server.calls.map((call) => call.action), ["activate", "deactivate"]);
  assert.equal(server.calls[1].params.instance_id, "inst-9");
});

test("인터넷 연결이 없으면 활성화 실패를 알리고 상태는 그대로", async () => {
  const fetchImpl = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(license.activate(license.newState(), "K", { fetchImpl, config }), /인터넷 연결/);
});

test("확인: 유효하면 확인 시각 갱신, 환불·중지면 라이선스 삭제, 연결 안 되면 유예 기간까지 사용", async () => {
  const start = Date.UTC(2026, 8, 1);
  const ok = fakeServer(() => [200, { activated: true, valid: true, instance: { id: "inst-1" }, meta }]);
  let state = await license.activate(license.newState(start), "KEY1", { fetchImpl: ok.fetchImpl, now: start, config });

  assert.equal(license.status(state, start + 8 * DAY, config).needsCheck, true);
  const refreshed = await license.validate(state, { fetchImpl: ok.fetchImpl, now: start + 8 * DAY });
  assert.equal(refreshed.state.license.validatedAt, start + 8 * DAY);
  assert.equal(ok.calls.at(-1).params.instance_id, "inst-1");

  const offline = await license.validate(state, { fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(offline.offline, true);
  assert.equal(license.status(state, start + 30 * DAY, config).kind, "licensed", "30일까지는 오프라인이어도 사용");
  assert.equal(license.status(state, start + 31 * DAY, config).kind, "offline");
  assert.equal(license.status(state, start + 31 * DAY, config).allowed, false);

  const revoked = await license.validate(state, { fetchImpl: fakeServer(() => [200, { valid: false, error: null, license_key: { status: "disabled" } }]).fetchImpl, now: start + 9 * DAY });
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.state.license, undefined);
  assert.equal(license.status(revoked.state, start + 9 * DAY, config).kind, "trial", "체험 기간이 남았으면 체험으로 돌아감");
  state = revoked.state;
  assert.equal(license.status(state, start + 15 * DAY, config).kind, "expired");
});

test("해제: 서버에 해제를 알리고 이 PC의 라이선스를 지운다", async () => {
  const server = fakeServer((action) => action === "activate" ? [200, { activated: true, instance: { id: "inst-1" }, meta }] : [200, { deactivated: true }]);
  const state = await license.activate(license.newState(), "KEY1", { fetchImpl: server.fetchImpl, config });
  const after = await license.deactivate(state, { fetchImpl: server.fetchImpl });
  assert.equal(after.license, undefined);
  assert.equal(server.calls.at(-1).action, "deactivate");
});
