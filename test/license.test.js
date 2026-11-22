"use strict";

// 라이선스: 체험 기간, 시계 되돌리기, 우리 라이선스 서버에 등록·확인·해제(가짜 서버), 오프라인 유예
const test = require("node:test");
const assert = require("node:assert/strict");
const license = require("../src/license");

const DAY = license.DAY;
const SERVER = "https://license.example.test";
const config = { trialDays: 14, offlineGraceDays: 30, revalidateDays: 7, licenseServer: SERVER };
const opts = (server, extra = {}) => ({ fetchImpl: server.fetchImpl, config, ...extra });

// 서버를 흉내 낸다. 보낸 요청을 calls에 남긴다.
function fakeServer(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const action = url.split("/").pop();
    const body = JSON.parse(options.body);
    calls.push({ url, action, body, headers: options.headers });
    const [status, reply] = handler(action, body);
    return { ok: status >= 200 && status < 300, status, json: async () => reply };
  };
  return { fetchImpl, calls };
}

// 키 하나에 PC 2대까지, 실제 서버처럼 자리를 기억하는 가짜 서버
function realisticServer({ keys = {}, limit = 2 } = {}) {
  let next = 1;
  return fakeServer((action, body) => {
    const entry = keys[body.key];
    if (!body.key) return [400, { detail: "라이선스 키를 넣어 주십시오." }];
    if (!entry) return [404, { detail: "없는 라이선스 키입니다." }];
    if (entry.product !== "findinside") return [400, { detail: "다른 프로그램의 라이선스 키입니다." }];
    if (entry.refunded) return [403, { detail: "환불된 라이선스 키입니다." }];
    if (action === "activate") {
      if (entry.instances.length >= limit) return [409, { detail: "이 키로 PC 2대가 이미 등록되어 있습니다." }];
      const instance = `inst-${next++}`;
      entry.instances.push(instance);
      return [200, { activated: true, instance, product: "findinside" }];
    }
    if (action === "deactivate") {
      if (!entry.instances.includes(body.instance)) return [404, { detail: "등록되지 않은 PC입니다." }];
      entry.instances = entry.instances.filter((id) => id !== body.instance);
      return [200, { deactivated: true }];
    }
    if (action === "validate") {
      return entry.instances.includes(body.instance) ? [200, { valid: true }] : [200, { valid: false, detail: "이 PC의 등록이 해제되었습니다." }];
    }
    return [404, { detail: "Not Found" }];
  });
}

const NEW_KEY = "FIND-AAAA-BBBB-CCCC-DDDD";
const OLD_KEY = "1A2B3C4D-1111-2222-3333-444455556666";

test("체험: 14일 동안 쓰고, 끝나면 막힌다. 시계를 되돌려도 늘어나지 않는다", () => {
  const start = Date.UTC(2026, 8, 1);
  let state = license.newState(start);
  assert.deepEqual(license.status(state, start, config), { kind: "trial", allowed: true, daysLeft: 14 });
  assert.equal(license.status(state, start + 13 * DAY, config).daysLeft, 1);
  assert.equal(license.status(state, start + 14 * DAY, config).kind, "expired");
  state = license.touch(state, start + 20 * DAY);
  assert.equal(license.status(state, start + 1 * DAY, config).kind, "expired", "시계를 되돌려도 마지막으로 본 시각 기준");
});

test("서버 주소: 환경 변수가 있으면 그쪽, 없으면 설정값 (끝의 / 는 뺀다)", () => {
  const saved = process.env.FINDINSIDE_LICENSE_SERVER;
  try {
    delete process.env.FINDINSIDE_LICENSE_SERVER;
    assert.equal(license.serverUrl({ licenseServer: "https://jocbo.pages.dev/" }), "https://jocbo.pages.dev");
    process.env.FINDINSIDE_LICENSE_SERVER = "https://preview.jocbo.pages.dev";
    assert.equal(license.serverUrl({ licenseServer: "https://jocbo.pages.dev" }), "https://preview.jocbo.pages.dev");
  } finally {
    if (saved === undefined) delete process.env.FINDINSIDE_LICENSE_SERVER;
    else process.env.FINDINSIDE_LICENSE_SERVER = saved;
  }
});

test("새 키 등록: 키·임의의 이름·제품만 JSON으로 보내고, 성공하면 정품", async () => {
  const server = realisticServer({ keys: { [NEW_KEY]: { product: "findinside", instances: [] } } });
  const start = Date.UTC(2026, 8, 1);
  const state = await license.activate(license.newState(start), `  ${NEW_KEY}  `, opts(server, { now: start + 20 * DAY }));
  const sent = server.calls[0];
  assert.equal(sent.url, `${SERVER}/api/license/activate`);
  assert.deepEqual(Object.keys(sent.body).sort(), ["key", "name", "product"]);
  assert.equal(sent.body.key, NEW_KEY);
  assert.equal(sent.body.product, "findinside");
  assert.match(sent.body.name, /^FindInside [0-9a-f]{8}$/, "PC 이름이 아니라 임의의 이름");
  assert.equal(sent.headers["Content-Type"], "application/json");
  assert.match(sent.headers["User-Agent"], /^findinside-desktop\/\d+\.\d+\.\d+$/);
  assert.equal(state.license.instanceId, "inst-1");
  const current = license.status(state, start + 20 * DAY, config);
  assert.equal(current.kind, "licensed");
  assert.equal(current.allowed, true);
  assert.equal(current.keyHint, "…DDDD");
});

test("PC 3대째는 서버 안내(409)를 그대로 보여 주고, 한 대를 해제하면 다시 등록된다", async () => {
  const server = realisticServer({ keys: { [NEW_KEY]: { product: "findinside", instances: [] } } });
  const first = await license.activate(license.newState(), NEW_KEY, opts(server));
  await license.activate(license.newState(), NEW_KEY, opts(server));
  await assert.rejects(license.activate(license.newState(), NEW_KEY, opts(server)), (error) => error.message === "이 키로 PC 2대가 이미 등록되어 있습니다." && error.status === 409);

  const released = await license.deactivate(first, opts(server));
  assert.equal(released.license, undefined);
  assert.deepEqual(server.calls.at(-1).body, { key: NEW_KEY, instance: "inst-1" });
  const third = await license.activate(license.newState(), NEW_KEY, opts(server));
  assert.equal(third.license.instanceId, "inst-3");
});

test("엉뚱한 키는 거절: 없는 키(404)·다른 프로그램의 키(400)·환불된 키(403)·빈 키", async () => {
  const server = realisticServer({ keys: { "JOCBO-1111": { product: "jocbo", instances: [] }, "FIND-REFUND": { product: "findinside", refunded: true, instances: [] } } });
  await assert.rejects(license.activate(license.newState(), "NOPE", opts(server)), /없는 라이선스 키입니다/);
  await assert.rejects(license.activate(license.newState(), "JOCBO-1111", opts(server)), /다른 프로그램의 라이선스 키입니다/);
  await assert.rejects(license.activate(license.newState(), "FIND-REFUND", opts(server)), /환불된 라이선스 키입니다/);
  const before = server.calls.length;
  await assert.rejects(license.activate(license.newState(), "   ", opts(server)), /라이선스 키를 입력해 주십시오/);
  assert.equal(server.calls.length, before, "빈 키는 서버에 묻지 않는다");
});

test("서버가 다른 제품으로 등록했다고 답하면 거절하고 그 자리를 바로 해제한다", async () => {
  const server = fakeServer((action) => action === "activate" ? [200, { activated: true, instance: "inst-9", product: "jocbo" }] : [200, { deactivated: true }]);
  await assert.rejects(license.activate(license.newState(), "OTHER", opts(server)), /FindInside 라이선스 키가 아닙니다/);
  assert.deepEqual(server.calls.map((call) => call.action), ["activate", "deactivate"]);
  assert.deepEqual(server.calls[1].body, { key: "OTHER", instance: "inst-9" });
});

test("인터넷이 끊기면 정해진 안내를 보여 주고 상태는 그대로", async () => {
  const fetchImpl = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(license.activate(license.newState(), "K", { fetchImpl, config }), (error) => error.message === "라이선스 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주십시오." && error.offline);
  const state = { ...license.newState(), license: { key: NEW_KEY, instanceId: "inst-1", activatedAt: 0, validatedAt: 0 } };
  await assert.rejects(license.deactivate(state, { fetchImpl, config }), /인터넷 연결을 확인해 주십시오/);
});

test("서버 오류(500)에 detail이 없으면 잠시 뒤 다시 하라고 안내한다", async () => {
  const server = fakeServer(() => [500, {}]);
  await assert.rejects(license.activate(license.newState(), NEW_KEY, opts(server)), /잠시 뒤 다시 시도해 주십시오/);
});

test("Lemon Squeezy 시절 키: 새로 등록도 되고, 예전에 등록해 둔 PC는 다시 등록하지 않고 저장된 자리로 확인·해제한다", async () => {
  // 서버가 Lemon Squeezy에 확인한 뒤 이어받는 키 (앱 쪽에서는 새 키와 똑같이 다룬다)
  const server = realisticServer({ keys: { [OLD_KEY]: { product: "findinside", instances: ["ls-instance-uuid"] } } });
  const fresh = await license.activate(license.newState(), OLD_KEY, opts(server));
  assert.equal(fresh.license.key, OLD_KEY);

  // 1.0.5 이하에서 Lemon Squeezy에 직접 등록해 저장된 상태 (고객 이름 등이 같이 남아 있다)
  const start = Date.UTC(2026, 8, 1);
  const saved = { ...license.newState(start), license: { key: OLD_KEY, instanceId: "ls-instance-uuid", activatedAt: start, validatedAt: start, customerName: "홍길동", variantName: "개인용" } };
  assert.equal(license.status(saved, start + 1 * DAY, config).kind, "licensed", "다시 등록하라고 하지 않는다");
  assert.equal(license.status(saved, start + 1 * DAY, config).customer, "홍길동");

  const checked = await license.validate(saved, opts(server, { now: start + 8 * DAY }));
  assert.equal(checked.state.license.validatedAt, start + 8 * DAY);
  assert.deepEqual(server.calls.at(-1).body, { key: OLD_KEY, instance: "ls-instance-uuid", product: "findinside" });

  const released = await license.deactivate(saved, opts(server));
  assert.equal(released.license, undefined);
  assert.deepEqual(server.calls.at(-1).body, { key: OLD_KEY, instance: "ls-instance-uuid" });
});

test("확인: 유효하면 확인 시각 갱신, valid:false면 라이선스 삭제(서버 안내 저장), 연결 안 되면 유예 기간까지 사용", async () => {
  const start = Date.UTC(2026, 8, 1);
  const server = realisticServer({ keys: { [NEW_KEY]: { product: "findinside", instances: [] } } });
  let state = await license.activate(license.newState(start), NEW_KEY, opts(server, { now: start }));

  assert.equal(license.status(state, start + 8 * DAY, config).needsCheck, true);
  const refreshed = await license.validate(state, opts(server, { now: start + 8 * DAY }));
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.state.license.validatedAt, start + 8 * DAY);
  assert.equal(server.calls.at(-1).url, `${SERVER}/api/license/validate`);

  const offline = await license.validate(state, { fetchImpl: async () => { throw new TypeError("fetch failed"); }, config });
  assert.equal(offline.offline, true);
  assert.equal(offline.changed, false);
  assert.equal(license.status(state, start + 30 * DAY, config).kind, "licensed", "30일까지는 오프라인이어도 사용");
  assert.equal(license.status(state, start + 31 * DAY, config).kind, "offline");
  assert.equal(license.status(state, start + 31 * DAY, config).allowed, false);

  const refunded = await license.validate(state, { fetchImpl: fakeServer(() => [403, { valid: false, detail: "환불된 라이선스 키입니다." }]).fetchImpl, config, now: start + 9 * DAY });
  assert.equal(refunded.revoked, true);
  assert.equal(refunded.state.license, undefined);
  assert.equal(refunded.state.revoked.reason, "환불된 라이선스 키입니다.");
  assert.equal(license.status(refunded.state, start + 9 * DAY, config).kind, "trial", "체험 기간이 남았으면 체험으로 돌아감");
  state = refunded.state;
  assert.equal(license.status(state, start + 15 * DAY, config).kind, "expired");
});

test("확인: 다른 PC에서 해제된 자리는 valid:false로 지워진다", async () => {
  const server = realisticServer({ keys: { [NEW_KEY]: { product: "findinside", instances: [] } } });
  const state = await license.activate(license.newState(), NEW_KEY, opts(server));
  await license.deactivate(state, opts(server));
  const result = await license.validate(state, opts(server));
  assert.equal(result.revoked, true);
  assert.equal(result.state.revoked.reason, "이 PC의 등록이 해제되었습니다.");
});

test("확인: 서버가 분명히 답하지 않으면(확인 기능이 아직 없는 서버의 404, 500, 429) 지우지 않고 끊긴 것으로 본다", async () => {
  const state = { ...license.newState(), license: { key: NEW_KEY, instanceId: "inst-1", activatedAt: 0, validatedAt: 0 } };
  for (const [status, body] of [[404, { detail: "Not Found" }], [500, {}], [429, { valid: false }], [200, {}]]) {
    const result = await license.validate(state, opts(fakeServer(() => [status, body])));
    assert.equal(result.changed, false, `상태 ${status}`);
    assert.equal(result.offline, true, `상태 ${status}`);
    assert.equal(result.state.license.instanceId, "inst-1");
  }
});

test("해제: 서버에 이미 없는 자리(404)면 이 PC에서만 지우고, 그 밖의 실패는 서버 안내를 보여 준다", async () => {
  const state = { ...license.newState(), license: { key: NEW_KEY, instanceId: "gone", activatedAt: 0, validatedAt: 0 } };
  const gone = await license.deactivate(state, opts(fakeServer(() => [404, { detail: "등록되지 않은 PC입니다." }])));
  assert.equal(gone.license, undefined);
  await assert.rejects(license.deactivate(state, opts(fakeServer(() => [403, { detail: "환불된 라이선스 키입니다." }]))), /환불된 라이선스 키입니다/);
});
