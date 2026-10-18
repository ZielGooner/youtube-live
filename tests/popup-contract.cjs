"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function popup(overrides = {}) {
  const elements = new Map();
  const calls = { get: 0, set: 0, query: 0, message: [] };
  let interval, changed;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      checked: true, disabled: false, hidden: true, textContent: "",
      classList: { toggle(_name, active) { this.active = active; } },
      addEventListener(type, handler) { this[type] = handler; }
    });
    return elements.get(id);
  };
  const api = {
    async get() { calls.get++; return overrides.get ? overrides.get() : { enabled: true }; },
    async set(value) { calls.set++; return overrides.set?.(value); },
    async query() { calls.query++; return overrides.query ? overrides.query() : [{ id: 7 }]; },
    async sendMessage(id, request, options) {
      calls.message.push({ id, request, options });
      return overrides.message ? overrides.message(id) : { active: true, reason: "normal" };
    }
  };
  vm.runInNewContext(source, {
    document: { getElementById: element },
    chrome: {
      storage: { local: api, onChanged: { addListener(handler) { changed = handler; } } },
      tabs: { query: api.query, sendMessage: api.sendMessage }
    },
    setInterval(handler, delay) { assert.equal(delay, 1200); interval = handler; }
  });
  return {
    calls,
    toggle: element("enabled"), title: element("status-title"), error: element("error"),
    tick: () => interval(),
    emit(value, area = "local") { changed({ enabled: { newValue: value } }, area); },
    emitOther() { changed({ other: { newValue: false } }, "local"); },
    change(value) { element("enabled").checked = value; return element("enabled").change(); }
  };
}

test("polls page status without rereading unchanged settings", async () => {
  let reason = "normal";
  const p = popup({ message: () => ({ active: true, reason }) });
  await flush();
  assert.equal(p.title.textContent, "기본 모드 개선 적용 중");
  reason = "portrait-theater";
  for (let i = 0; i < 3; i++) { p.tick(); await flush(); }
  assert.equal(p.title.textContent, "세로 영화관 배치 적용 중");
  assert.equal(p.calls.get, 1);
  assert.equal(p.calls.query, 4);
  assert.equal(p.calls.message.length, 4);
});

test("disabled settings skip page API calls and external changes enable polling", async () => {
  const p = popup({ get: () => ({ enabled: false }) });
  await flush();
  p.tick(); await flush();
  assert.equal(p.toggle.checked, false);
  assert.equal(p.title.textContent, "기능 꺼짐");
  assert.equal(p.calls.get, 1);
  assert.equal(p.calls.query, 0);
  p.emit(true); await flush();
  assert.equal(p.toggle.checked, true);
  assert.equal(p.calls.query, 1);
});

test("new disabled state discards an older pending page response", async () => {
  const response = deferred();
  const p = popup({ message: () => response.promise });
  await flush();
  p.emit(false);
  response.resolve({ active: true, reason: "normal" });
  await flush();
  assert.equal(p.toggle.checked, false);
  assert.equal(p.title.textContent, "기능 꺼짐");
});

test("disabling during tab lookup avoids sending an outdated status request", async () => {
  const query = deferred();
  const p = popup({ query: () => query.promise });
  await flush();
  p.emit(false);
  query.resolve([{ id: 7 }]);
  await flush();
  assert.equal(p.calls.message.length, 0);
  assert.equal(p.title.textContent, "기능 꺼짐");
});

test("storage event wins over an outdated initial settings read", async () => {
  const settings = deferred();
  const p = popup({ get: () => settings.promise });
  p.emit(false);
  settings.resolve({ enabled: true });
  await flush();
  assert.equal(p.toggle.checked, false);
  assert.equal(p.title.textContent, "기능 꺼짐");
  assert.equal(p.calls.query, 0);
});

for (const timing of ["before", "after", "missing"]) {
  test(`saving refreshes once when storage event is ${timing} set resolution`, async () => {
    const saving = deferred();
    const p = popup({ get: () => ({ enabled: false }), set: () => saving.promise });
    await flush();
    const change = p.change(true);
    assert.equal(p.toggle.disabled, true);
    p.tick();
    assert.equal(p.calls.query, 0);
    if (timing === "before") p.emit(true);
    saving.resolve();
    await change; await flush();
    if (timing === "after") { p.emit(true); await flush(); }
    assert.equal(p.calls.query, 1);
    assert.equal(p.calls.message.length, 1);
    assert.equal(p.calls.get, 1);
    assert.equal(p.toggle.disabled, false);
    assert.equal(p.toggle.checked, true);
  });
}

test("save failure restores previous state and reports error", async () => {
  const p = popup({ set: () => Promise.reject(new Error("storage unavailable")) });
  await flush();
  await p.change(false); await flush();
  assert.equal(p.toggle.checked, true);
  assert.equal(p.toggle.disabled, false);
  assert.equal(p.error.hidden, false);
  assert.match(p.error.textContent, /저장하지 못했어요/);
  assert.equal(p.title.textContent, "기본 모드 개선 적용 중");
});

for (const succeeds of [false, true]) {
  test(`new external setting survives an older write ${succeeds ? "completion" : "failure"}`, async () => {
    const saving = deferred();
    const p = popup({ get: () => ({ enabled: false }), set: () => saving.promise });
    await flush();
    const change = p.change(true);
    p.emit(true);
    p.emit(false);
    if (succeeds) saving.resolve();
    else saving.reject(new Error("storage unavailable"));
    await change; await flush();
    assert.equal(p.toggle.checked, false);
    assert.equal(p.title.textContent, "기능 꺼짐");
  });
}

test("failed initial settings read retries on the next poll", async () => {
  let attempts = 0;
  const p = popup({ get: () => {
    if (!attempts++) throw new Error("storage unavailable");
    return { enabled: true };
  } });
  await flush();
  assert.equal(p.title.textContent, "현재 탭에 연결되지 않았어요");
  p.tick(); await flush();
  assert.equal(p.calls.get, 2);
  assert.equal(p.title.textContent, "기본 모드 개선 적용 중");
});

test("each poll resolves the active tab and recovers from a closed tab", async () => {
  let id = 7;
  const p = popup({ query: () => Number.isInteger(id) ? [{ id }] : [] });
  await flush();
  id = null;
  p.tick(); await flush();
  assert.equal(p.title.textContent, "현재 탭에 연결되지 않았어요");
  id = 12;
  p.tick(); await flush();
  assert.deepEqual(p.calls.message.map(call => call.id), [7, 12]);
  assert.equal(p.title.textContent, "기본 모드 개선 적용 중");
});

test("unrelated storage events and duplicate enabled values do not refresh", async () => {
  const p = popup(); await flush();
  p.emit(false, "sync"); p.emitOther(); p.emit(true); await flush();
  assert.equal(p.calls.query, 1);
  assert.equal(p.toggle.checked, true);
});

test("toggle while initial read is pending does not accept its stale result", async () => {
  const settings = deferred();
  const p = popup({ get: () => settings.promise });
  await p.change(false);
  settings.resolve({ enabled: true });
  await flush();
  assert.equal(p.toggle.checked, false);
  assert.equal(p.title.textContent, "기능 꺼짐");
  assert.equal(p.calls.query, 0);
});
