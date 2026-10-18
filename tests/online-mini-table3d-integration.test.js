import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../miniprogram/pages/online/index.js", import.meta.url));
const flush = () => new Promise(setImmediate);
function harness() {
  let page;
  const pending = [], log = [];
  class NativeTable3D {
    sync() { log.push("sync"); return new Promise(resolve => pending.push(resolve)); }
    suspend() { log.push("suspend"); }
    dispose() { log.push("dispose"); }
    resize() { log.push("resize"); }
  }
  vm.runInNewContext(readFileSync("miniprogram/pages/online/index.js", "utf8"), {
    Page: p => { page = p; },
    require: name => name === "../../utils/online-table3d" ? { NativeTable3D }
      : name === "../../utils/api" ? {} : require(name),
    wx: {}, setTimeout, clearTimeout, clearInterval,
  });
  page.data = structuredClone(page.data);
  page.active = true;
  page.setData = (value, done) => { Object.assign(page.data, value); done?.(); };
  page.flights = {
    prepare: (_before, after) => after.id,
    start: plan => log.push(`start:${plan}`),
    capture: () => log.push("capture"),
    cancel: () => log.push("cancel"),
  };
  const room = id => ({ id, variant: "yonma", status: "lobby", mySeat: 0, members: [] });
  return { page, pending, log, room };
}

test("原生快照绘制完成后先同步三维模型，再启动和采集飞牌", async () => {
  const h = harness();
  h.page.accept({ room: h.room("first") }, true);
  assert.deepEqual(h.log, ["sync"]);
  h.pending.shift()(true);
  await flush();
  assert.deepEqual(h.log, ["sync", "start:first", "capture"]);
});

test("异步三维同步后已换桌或已后台的回调不能启动旧飞牌", async () => {
  const h = harness();
  h.page.accept({ room: h.room("old") }, true);
  h.page.accept({ room: h.room("new") }, true);
  h.pending.shift()(true);
  await flush();
  assert.equal(h.log.some(v => v === "start:old"), false);
  h.pending.shift()(true);
  await flush();
  assert.equal(h.log.includes("start:new"), true);
  h.page.accept({ room: h.room("background") }, true);
  h.page.onHide();
  h.pending.shift()(true);
  await flush();
  assert.equal(h.log.includes("start:background"), false);
  assert.equal(h.log.includes("suspend"), true);
  h.page.onUnload();
  assert.equal(h.log.includes("dispose"), true);
  assert.equal(h.page.table3d, null);
});

test("WXML保持真实WebGL画布与测量代理，三维就绪时只隐藏旧牌体", () => {
  const wxml = readFileSync("miniprogram/pages/online/index.wxml", "utf8");
  const css = readFileSync("miniprogram/pages/online/index.wxss", "utf8");
  assert.match(wxml, /<canvas[^>]*id="table-webgl"[^>]*type="2d"/);
  assert.match(wxml, /class="table[^\n]*table3dReady/);
  assert.match(css, /\.table\.is-webgl \.north-slot \{ opacity: 0; \}/);
  assert.match(wxml, /拔北 {{player.nuki}}/);
  assert.match(wxml, /id="{{item.nodeId}}"/);
});
