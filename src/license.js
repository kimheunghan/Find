"use strict";

// 라이선스: 처음 실행한 날부터 체험 기간(product.json trialDays) 동안 모든 기능을 쓰고,
// 그 뒤에는 Lemon Squeezy에서 산 라이선스 키로 이 PC를 활성화해야 검색·색인·메일 가져오기를 할 수 있다.
// - 키 확인은 Lemon Squeezy License API(api.lemonsqueezy.com/v1/licenses)로 한다. API 키가 필요 없는 공개 API다.
// - 서버에 보내는 것은 라이선스 키와 이 설치를 구분하는 임의의 이름뿐이다 (PC 이름·사용자 이름은 보내지 않음).
// - 인터넷이 없어도 쓸 수 있게 마지막 확인 후 offlineGraceDays까지는 그대로 쓴다.
// 이 파일은 상태 계산과 API 호출만 한다. 저장(암호화)은 main.js가 한다.
const crypto = require("node:crypto");
const product = require("./product.json");

const DAY = 86_400_000;
const API = "https://api.lemonsqueezy.com/v1/licenses";

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
    const base = { customer: state.license.customerName || state.license.customerEmail || "", keyHint: hint(state.license.key), variant: state.license.variantName || "" };
    if (offlineDays > config.offlineGraceDays) return { kind: "offline", allowed: false, ...base, offlineDays };
    return { kind: "licensed", allowed: true, ...base, needsCheck: offlineDays >= config.revalidateDays };
  }
  const used = Math.floor((clock - (state.firstRun || clock)) / DAY);
  const daysLeft = Math.max(0, config.trialDays - used);
  return daysLeft > 0 ? { kind: "trial", allowed: true, daysLeft } : { kind: "expired", allowed: false, daysLeft: 0 };
}

const hint = (key) => (key ? `…${String(key).slice(-4)}` : "");

async function call(action, params, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${API}/${action}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    const offline = new Error("라이선스 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.");
    offline.offline = true;
    offline.cause = error;
    throw offline;
  }
  let body = {};
  try {
    body = await response.json();
  } catch {
    // 본문이 JSON이 아니면 아래에서 상태 코드로 판단한다
  }
  return { ok: response.ok, status: response.status, body };
}

// Lemon Squeezy 오류 문구를 한국어 안내로
function friendly(error) {
  const text = String(error || "");
  if (/not found/i.test(text)) return "라이선스 키를 찾을 수 없습니다. 구매 메일에 있는 키를 그대로 붙여 넣으세요.";
  if (/activation limit/i.test(text)) return "이 키로 활성화할 수 있는 PC 수를 모두 썼습니다. 다른 PC의 FindInside에서 '이 PC에서 해제'를 누른 뒤 다시 시도하세요.";
  if (/expired/i.test(text)) return "기간이 끝난 라이선스 키입니다.";
  if (/disabled/i.test(text)) return "사용이 중지된 라이선스 키입니다. 판매자에게 문의하세요.";
  return text || "라이선스 키를 확인하지 못했습니다.";
}

// 산 제품의 키인지 확인한다 (같은 Lemon Squeezy의 다른 가게·다른 제품 키를 막음). 설정하지 않았으면 건너뛴다.
// productId는 번호 하나 또는 여러 개: 테스트 모드 상품과 실제 판매(Live) 상품은 번호가 달라 둘 다 받는다.
function checkProduct(meta, config) {
  const { storeId, productId } = config.lemonSqueezy || {};
  if (storeId && Number(meta?.store_id) !== Number(storeId)) return false;
  const productIds = [productId].flat().filter(Boolean).map(Number);
  if (productIds.length && !productIds.includes(Number(meta?.product_id))) return false;
  return true;
}

async function activate(state, key, { fetchImpl, now = Date.now(), config = product } = {}) {
  const licenseKey = String(key || "").trim();
  if (!licenseKey) throw new Error("라이선스 키를 입력하세요.");
  const { body } = await call("activate", { license_key: licenseKey, instance_name: `FindInside ${state.installId.slice(0, 8)}` }, fetchImpl);
  if (!body.activated || !body.instance?.id) throw new Error(friendly(body.error));
  if (!checkProduct(body.meta, config)) {
    // 다른 제품의 키로 자리를 차지하지 않게 바로 해제한다
    await call("deactivate", { license_key: licenseKey, instance_id: body.instance.id }, fetchImpl).catch(() => {});
    throw new Error("FindInside 라이선스 키가 아닙니다.");
  }
  return {
    ...state,
    license: {
      key: licenseKey,
      instanceId: body.instance.id,
      activatedAt: now,
      validatedAt: now,
      customerName: body.meta?.customer_name || "",
      customerEmail: body.meta?.customer_email || "",
      variantName: body.meta?.variant_name || ""
    }
  };
}

// 주기적으로 키가 아직 유효한지 확인한다. 연결이 안 되면 상태를 그대로 둔다 (offlineGraceDays까지는 계속 사용).
// 서버가 무효라고 답하면(환불·중지·해제) 라이선스를 지운다.
async function validate(state, { fetchImpl, now = Date.now() } = {}) {
  if (!state.license?.instanceId) return { state, changed: false };
  let result;
  try {
    result = await call("validate", { license_key: state.license.key, instance_id: state.license.instanceId }, fetchImpl);
  } catch (error) {
    if (error.offline) return { state, changed: false, offline: true };
    throw error;
  }
  const { body, status: httpStatus } = result;
  if (body.valid) return { state: { ...state, license: { ...state.license, validatedAt: now } }, changed: true };
  if (httpStatus >= 500 || httpStatus === 429) return { state, changed: false, offline: true };
  const { license, ...rest } = state;
  return { state: { ...rest, revoked: { at: now, reason: friendly(body.error || body.license_key?.status) } }, changed: true, revoked: true };
}

async function deactivate(state, { fetchImpl } = {}) {
  if (!state.license?.instanceId) return state;
  const { body } = await call("deactivate", { license_key: state.license.key, instance_id: state.license.instanceId }, fetchImpl);
  if (!body.deactivated && !/not found/i.test(String(body.error || ""))) throw new Error(friendly(body.error));
  const { license, ...rest } = state;
  return rest;
}

module.exports = { newState, touch, status, activate, validate, deactivate, friendly, DAY };
