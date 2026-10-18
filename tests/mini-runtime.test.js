import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { Store } from "../src/store.js";
import path from "node:path";
function page(name, api, wx = {}) {
  let p;
  const file = path.resolve("miniprogram/pages/" + name + "/index.js"),
    req = createRequire(file);
  vm.runInNewContext(readFileSync(file, "utf8"), {
    Page: (x) => (p = x),
    require: (s) => (s === "../../utils/api" ? api : req(s)),
    wx,
    console,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = function (values) {
    for (const [key, v] of Object.entries(values)) {
      const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
      let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = v;
    }
  };
  return p;
}
test("小程序共享算点内核与算符回填", async () => {
  const { points } = await import("../src/scoring.js");
  const require = createRequire(import.meta.url),
    mini = require("../miniprogram/utils/scoring.js");
  for (const players of [3, 4])
    for (const dealer of [false, true])
      for (const method of ["ron", "tsumo"])
        for (const han of [1, 3, 5, 6, 8, 11, 13]) {
          const q = { fu: 30, han, players, dealer, method };
          assert.deepEqual(mini.points(q), points(q));
        }
  const storage = new Map(),
    wx = {
      setStorageSync: (k, v) => storage.set(k, v),
      getStorageSync: (k) => storage.get(k),
      removeStorageSync: (k) => storage.delete(k),
      switchTab: () => {},
    };
  const fu = page("fu", {}, wx);
  fu.onLoad();
  fu.choose({
    currentTarget: { dataset: { key: "special", value: "chiitoitsu" } },
  });
  assert.equal(fu.data.result.fu, 25);
  fu.use();
  const quick = page("quick", {}, wx);
  quick.onLoad();
  quick.onShow();
  assert.equal(quick.data.quick.fu, 25);
  assert.equal(quick.data.result.ron, 1600);
});
test("小程序记分失败重试同nonce、双响独立符番与实际去重", async () => {
  mkdirSync(".local/test-data", { recursive: true });
  const dir = mkdtempSync(".local/test-data/mini-runtime-"),
    s = new Store(path.join(dir, "db"));
  try {
    const a = s.wechatSession("app", "a");
    let r = s.create(a, { players: 3 });
    r = s.join(s.wechatSession("app", "b"), r.code, 1);
    r = s.join(s.wechatSession("app", "c"), r.code, 2);
    let posted = 0,
      nonces = [],
      failAfterCommit = true;
    const api = {
      nonce: () => "mini-runtime-nonce",
      error: () => {},
      api: async (p, m, input) => {
        if (m !== "POST") return s.get(r.id, a);
        posted++;
        nonces.push(input.nonce);
        const out = s.command(a, r.id, input);
        if (failAfterCommit) {
          failAfterCommit = false;
          throw Error("network lost");
        }
        return out;
      },
    };
    let returned = false;
    const p = page("record", api, { navigateBack: () => (returned = true) });
    p.id = r.id;
    await p.load();
    p.choose({ currentTarget: { dataset: { key: "method", value: "ron" } } });
    p.choose({ currentTarget: { dataset: { key: "loser", value: 0 } } });
    p.selectWinner({ currentTarget: { dataset: { seat: 1 } } });
    p.selectWinner({ currentTarget: { dataset: { seat: 2 } } });
    assert.deepEqual(Array.from(p.data.winners), [1, 2]);
    p.selectWinner({ currentTarget: { dataset: { seat: 0 } } });
    assert.deepEqual(Array.from(p.data.winners), [1, 2]);
    p.stepHan({ currentTarget: { dataset: { seat: 1, step: -1 } } });
    p.stepHan({ currentTarget: { dataset: { seat: 1, step: -1 } } });
    p.stepHan({ currentTarget: { dataset: { seat: 2, step: -1 } } });
    await p.save();
    assert.equal(s.raw(r.id).history.length, 1);
    assert.equal(returned, false);
    await p.save();
    assert.equal(returned, true);
    assert.equal(s.raw(r.id).history.length, 1);
    assert.deepEqual(nonces, ["mini-runtime-nonce", "mini-runtime-nonce"]);
    assert.deepEqual(s.raw(r.id).scores, [32000, 36000, 37000]);
    assert.equal(posted, 2);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("扫码scene解析与每个原生页面可加载", () => {
  const require = createRequire(import.meta.url),
    { parseInvite } = require("../miniprogram/utils/invite.js"),
    code = "a".repeat(32);
  for (const input of [
    code,
    "pages/room/index?scene=" + code,
    "https://score.test/riichi/?join=" + code,
    encodeURIComponent(code),
  ])
    assert.equal(parseInvite(input), code);
  assert.equal(parseInvite("garbage"), "");
  for (const name of ["quick", "fu", "room", "record", "me", "profile", "yaku"])
    assert.ok(page(name, {}).data);
  const config = JSON.parse(readFileSync("miniprogram/app.json"));
  assert.equal(config.pages.length, 7);
});

test("小程序交叉格点击、禁用组合、限界档位与算符回填清除役满", () => {
  const wx = {
    getStorageSync: () => ({ fu: 40, method: "ron" }),
    removeStorageSync: () => {},
  };
  const p = page("quick", {}, wx);
  p.onLoad();
  const tap = (fu, han, yakuman = 0) =>
    p.selectCell({ currentTarget: { dataset: { fu, han, yakuman } } });
  tap(40, 3);
  assert.equal(p.data.result.ron, 5200);
  assert.equal(p.data.rows.find((r) => r.fu === 40).cells[2].selected, true);
  tap(20, 1);
  assert.equal(p.data.quick.fu, 40);
  tap(30, 6);
  assert.equal(p.data.result.ron, 12000);
  assert.equal(p.data.limits[1].selected, true);
  tap(30, 13, 2);
  assert.equal(p.data.result.ron, 64000);
  p.onShow();
  assert.equal(p.data.quick.yakuman, 0);
  assert.equal(p.data.quick.fu, 40);
  p.choose({ currentTarget: { dataset: { key: "dealer", value: true } } });
  p.choose({ currentTarget: { dataset: { key: "method", value: "tsumo" } } });
  tap(40, 3);
  assert.equal(p.data.result.child, 2600);
  assert.equal(p.data.result.payment, "每家支付 2,600 点");
});

test("小程序从20符自摸切到荣和时回到合法30符", () => {
  const p = page("quick", {});
  p.onLoad();
  p.choose({ currentTarget: { dataset: { key: "method", value: "tsumo" } } });
  p.selectCell({ currentTarget: { dataset: { fu: 20, han: 2, yakuman: 0 } } });
  assert.equal(p.data.quick.fu, 20);
  p.choose({ currentTarget: { dataset: { key: "method", value: "ron" } } });
  assert.equal(p.data.quick.fu, 30);
  assert.equal(p.data.result.ron, 2000);
});

test("小程序本场加减边界和记分支付明细", async () => {
  const quick = page("quick", {});
  quick.onLoad();
  const step = (n) => quick.honba({ currentTarget: { dataset: { step: n } } });
  step(-1);
  assert.equal(quick.data.quick.honba, 0);
  step(1);
  assert.equal(quick.data.result.ron, 1300);
  quick.data.quick.honba = 100;
  step(1);
  assert.equal(quick.data.quick.honba, 100);
  const r = {
    id: "test",
    isOwner: true,
    version: 0,
    rules: { players: 4, start: 25000, kiriage: false, kazoe: true },
    scores: [25000, 25000, 25000, 25000],
    members: [0, 1, 2, 3].map((i) => ({ name: "玩家" + i })),
    dealer: 0,
    hand: 0,
    honba: 2,
    pot: 0,
    history: [],
  };
  const record = page("record", { api: async () => r });
  record.id = "test";
  await record.load();
  assert.equal(record.data.status.honba, 2);
  assert.equal(record.data.status.repeats, 0);
  assert.equal(record.data.details.rows[1].base, 2000);
  assert.equal(record.data.details.rows[1].bonus, 200);
  assert.equal(record.data.details.rows[1].total, 2200);
  assert.equal(record.data.details.next.honba, 3);
});

test("小程序记分番数加减、符数点选、下限与弱网nonce更新", async () => {
  const r = {
    id: "test",
    isOwner: true,
    version: 0,
    rules: { players: 4, start: 25000, kiriage: false, kazoe: true },
    scores: [25000, 25000, 25000, 25000],
    members: [0, 1, 2, 3].map((i) => ({ name: "玩家" + i })),
    dealer: 0,
    hand: 0,
    honba: 1,
    pot: 0,
    history: [],
  };
  const p = page("record", { api: async () => r });
  p.id = "test";
  await p.load();
  const step = (n) =>
    p.stepHan({ currentTarget: { dataset: { seat: 0, step: n } } });
  const fu = (index) =>
    p.chooseFu({ currentTarget: { dataset: { seat: 0, index } } });
  step(1);
  fu(3);
  assert.equal(p.data.winForms[0].han, 4);
  assert.equal(p.event().winners[0].fu, 40);
  assert.equal(p.data.details.rows[1].total, 4100);
  step(-1);
  step(-1);
  fu(0);
  assert.equal(p.event().winners[0].fu, 20);
  p.nonce = "old";
  step(-1);
  assert.equal(p.data.winForms[0].han, 1);
  assert.equal(p.event().winners[0].fu, 30);
  assert.equal(p.nonce, null);
  step(-1);
  assert.equal(p.data.winForms[0].han, 1);
  fu(0);
  assert.equal(p.event().winners[0].fu, 30);
  p.data.winForms[0].han = 100;
  step(1);
  assert.equal(p.data.winForms[0].han, 100);
});

test("荣和点选、切换放铳者与单人自摸保留独立符番", async () => {
  const r = {
    id: "test",
    version: 1,
    isOwner: true,
    rules: { players: 4, start: 25000, kiriage: false, kazoe: true },
    scores: [25000, 25000, 25000, 25000],
    members: [0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "玩家" + i })),
    dealer: 0,
    hand: 0,
    honba: 0,
    pot: 0,
    history: [],
  };
  const p = page("record", { api: async () => r });
  p.id = r.id;
  await p.load();
  p.choose({ currentTarget: { dataset: { key: "method", value: "ron" } } });
  p.choose({ currentTarget: { dataset: { key: "loser", value: 0 } } });
  p.selectWinner({ currentTarget: { dataset: { seat: 1 } } });
  p.stepHan({ currentTarget: { dataset: { seat: 1, step: 1 } } });
  p.selectWinner({ currentTarget: { dataset: { seat: 2 } } });
  p.selectWinner({ currentTarget: { dataset: { seat: 3 } } });
  assert.equal(p.data.winners.length, 2);
  p.selectWinner({ currentTarget: { dataset: { seat: 1 } } });
  p.selectWinner({ currentTarget: { dataset: { seat: 1 } } });
  assert.equal(p.data.winForms[1].han, 4);
  p.choose({ currentTarget: { dataset: { key: "loser", value: 1 } } });
  assert.deepEqual(Array.from(p.data.winners), [2]);
  p.choose({ currentTarget: { dataset: { key: "method", value: "tsumo" } } });
  p.selectWinner({ currentTarget: { dataset: { seat: 3 } } });
  assert.deepEqual(Array.from(p.data.winners), [3]);
  assert.ok(p.data.preview);
});
