// 사용: node cdp.js eval "<js>"  |  node cdp.js shot out.png [x y w h]
const [cmd, a1, ...rest] = process.argv.slice(2);
(async () => {
  const list = await (await fetch("http://127.0.0.1:9333/json")).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  if (cmd === "eval") {
    const r = await send("Runtime.evaluate", { expression: a1, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result.result?.value ?? r.result));
  } else if (cmd === "shot") {
    const params = { format: "png", captureBeyondViewport: true };
    if (rest.length === 4) params.clip = { x: +rest[0], y: +rest[1], width: +rest[2], height: +rest[3], scale: 1.5 };
    const r = await send("Page.captureScreenshot", params);
    require("fs").writeFileSync(a1, Buffer.from(r.result.data, "base64"));
    console.log("saved", a1);
  } else if (cmd === "size") {
    const r = await send("Browser.getWindowForTarget"); console.log(JSON.stringify(r));
  }
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
if (process.argv[2] === "bounds") (async () => {
  const v = await (await fetch("http://127.0.0.1:9333/json/version")).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { p.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const t = (await send("Target.getTargets")).result.targetInfos.find((x) => x.type === "page");
  const w = await send("Browser.getWindowForTarget", { targetId: t.targetId });
  await send("Browser.setWindowBounds", { windowId: w.result.windowId, bounds: { left: 0, top: 0, width: +process.argv[3], height: +process.argv[4], windowState: "normal" } });
  console.log("bounds set"); ws.close();
})();
