"use strict";

// 라이선스: 처음 실행한 날부터 체험 기간(product.json trialDays) 동안 모든 기능을 쓰고,
// 그 뒤에는 산 라이선스 키로 이 PC를 등록해야 검색·색인·메일 가져오기를 할 수 있다.
// - 키 등록·해제·확인은 우리 라이선스 서버(우리의 족보와 같이 쓰는 서버, 기본 jocbo.pages.dev)에 묻는다.
//   Lemon Squeezy 시절에 산 키(XXXXXXXX-XXXX-…)도 서버가 Lemon Squeezy에 확인한 뒤 이어받으므로 앱은 우리 서버에만 묻는다.
//   새로 파는 키는 FIND-XXXX-XXXX-XXXX-XXXX 모양이고, 키 하나로 PC 2대까지 등록한다.
// - 서버 주소는 환경 변수 FINDINSIDE_LICENSE_SERVER로 바꿀 수 있다 (시험: https://preview.jocbo.pages.dev).
// - 서버에 보내는 것은 라이선스 키와 이 설치를 구분하는 임의의 이름뿐이다 (PC 이름·사용자 이름은 보내지 않음).
// - 인터넷이 없어도 쓸 수 있게 마지막 확인 후 offlineGraceDays까지는 그대로 쓴다.
// 이 파일은 상태 계산과 서버 호출만 한다. 저장(암호화)은 main.js가 한다.
const crypto = require("node:crypto");
const product = require("./product.json");
const { version } = require("../package.json");

const DAY = 86_400_000;
const PRODUCT = "findinside";
const OFFLINE_MESSAGE = "라이선스 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주십시오.";
// Cloudflare가 기본 User-Agent를 막는 경우가 있어 직접 넣는다
const USER_AGENT = `findinside-desktop/${version}`;

function serverUrl(config = product) {
  return String(process.env.FINDINSIDE_LICENSE_SERVER || config.licenseServer || "https://jocbo.pages.dev").replace(/\/+$/, "");
}

function newState(now = Date.now()) {
  return { firstRun: now, lastSeen: now, installId: crypto.randomUUID() };
}

// 시계를 뒤로 돌려 체험 기간을 늘리지 못하게, 지금까지 본 가장 늦은 시각을 기준으로 삼는다
function touch(state, now = Date.now()) {
  return { ...state, lastSeen: Math.max(state.lastSeen || 0, now) };
}

// 화면과 기능 제한에 쓰는 상태
// kind: licensed(정품) · trial(체험 중) · expired(체험 끝) · offline(오래 확인 못 함)
function status(state, now = Date.now(), config = product) {
  const clock = Math.max(now, state.lastSeen || 0);
  if (state.license?.instanceId) {
    const checkedAt = state.license.validatedAt || state.license.activatedAt || 0;
    const offlineDays = Math.floor((clock - checkedAt) / DAY);
    // customerName 등은 Lemon Squeezy 시절에 등록한 PC에만 저장되어 있다
    const base = { customer: state.license.customerName || state.license.customerEmail || "", keyHint: hint(state.license.key), variant: state.license.variantName || "" };
    if (offlineDays > config.offlineGraceDays) return { kind: "offline", allowed: false, ...base, offlineDays };
    return { kind: "licensed", allowed: true, ...base, needsCheck: offlineDays >= config.revalidateDays };
  }
  const used = Math.floor((clock - (state.firstRun || clock)) / DAY);
  const daysLeft = Math.max(0, config.trialDays - used);
  return daysLeft > 0 ? { kind: "trial", allowed: true, daysLeft } : { kind: "expired", allowed: false, daysLeft: 0 };
}

const hint = (key) => (key ? `…${String(key).slice(-4)}` : "");

// 서버에 JSON으로 묻는다. 연결이 안 되면 offline 표시가 붙은 오류를 던진다.
async function call(action, payload, { fetchImpl = fetch, config = product } = {}) {
  let response;
  try {
    response = await fetchImpl(`${serverUrl(config)}/api/license/${action}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    const offline = new Error(OFFLINE_MESSAGE);
    offline.offline = true;
    offline.cause = error;
    throw offline;
  }
  let body = {};
  try {
    body = (await response.json()) || {};
  } catch {
    // 본문이 JSON이 아니면 아래에서 상태 코드로 판단한다
  }
  return { ok: response.ok, status: response.status, body };
}

// 실패하면 서버가 보낸 한국어 안내(detail)를 그대로 보여 준다
function failure({ status: httpStatus, body }, fallback = "라이선스 키를 확인하지 못했습니다.") {
  const detail = typeof body?.detail === "string" ? body.detail : "";
  const error = new Error(detail || (httpStatus >= 500 ? "라이선스 서버에 문제가 있습니다. 잠시 뒤 다시 시도해 주십시오." : fallback));
  error.status = httpStatus;
  return error;
}

async function activate(state, key, { fetchImpl, now = Date.now(), config = product } = {}) {
  const licenseKey = String(key || "").trim();
  if (!licenseKey) throw new Error("라이선스 키를 입력해 주십시오.");
  const result = await call("activate", { key: licenseKey, name: `FindInside ${state.installId.slice(0, 8)}`, product: PRODUCT }, { fetchImpl, config });
  const { body } = result;
  if (!result.ok || !body.activated || !body.instance) throw failure(result);
  if (body.product !== PRODUCT) {
    // 다른 프로그램의 키로 자리를 차지하지 않게 바로 해제한다
    await call("deactivate", { key: licenseKey, instance: body.instance }, { fetchImpl, config }).catch(() => {});
    throw new Error("FindInside 라이선스 키가 아닙니다.");
  }
  return {
    ...state,
    license: { key: licenseKey, instanceId: String(body.instance), activatedAt: now, validatedAt: now }
  };
}

// 주기적으로 키가 아직 유효한지 확인한다. 연결이 안 되거나 서버가 분명히 답하지 않으면 상태를 그대로 둔다
// (offlineGraceDays까지는 계속 사용). 서버가 valid: false라고 답하면(환불·해제·다른 프로그램의 키) 라이선스를 지운다.
// 저장된 instanceId는 Lemon Squeezy 시절 값이어도 그대로 보낸다 — 서버가 알아서 처리한다.
async function validate(state, { fetchImpl, now = Date.now(), config = product } = {}) {
  if (!state.license?.instanceId) return { state, changed: false };
  let result;
  try {
    result = await call("validate", { key: state.license.key, instance: state.license.instanceId, product: PRODUCT }, { fetchImpl, config });
  } catch (error) {
    if (error.offline) return { state, changed: false, offline: true };
    throw error;
  }
  const { body, status: httpStatus } = result;
  if (body.valid === true) return { state: { ...state, license: { ...state.license, validatedAt: now } }, changed: true };
  // 서버 오류·요청 제한·답이 이상할 때(확인 기능이 아직 없는 서버 등)는 끊긴 것으로 본다
  if (body.valid !== false || httpStatus >= 500 || httpStatus === 429) return { state, changed: false, offline: true };
  const { license, ...rest } = state;
  const reason = typeof body.detail === "string" && body.detail ? body.detail : "라이선스가 더 이상 유효하지 않습니다.";
  return { state: { ...rest, revoked: { at: now, reason } }, changed: true, revoked: true };
}

async function deactivate(state, { fetchImpl, config = product } = {}) {
  if (!state.license?.instanceId) return state;
  const result = await call("deactivate", { key: state.license.key, instance: state.license.instanceId }, { fetchImpl, config });
  // 서버에 이미 없는 키·자리(404)면 이 PC에서만 지운다
  if (!(result.ok && result.body.deactivated) && result.status !== 404) throw failure(result, "등록을 해제하지 못했습니다.");
  const { license, ...rest } = state;
  return rest;
}

module.exports = { newState, touch, status, activate, validate, deactivate, serverUrl, DAY, OFFLINE_MESSAGE, USER_AGENT };
