import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { patchView } = require("../miniprogram/utils/online-view-patch");

test("原生收支滚动只传四个点数叶子，不重发新建的相同役种与手牌数组", () => {
  const host = {
    data: {
      settlement: {
        stage: "scores",
        hand: [{ key: "m1", src: "/tiles/m1.png" }],
        yaku: [{ name: "立直", visible: true }],
        changes: [
          { seat: 0, before: 25000, after: 25000 },
          { seat: 1, before: 25000, after: 25000 },
          { seat: 2, before: 25000, after: 25000 },
          { seat: 3, before: 25000, after: 25000 },
        ],
      },
    },
    setData(patch) {
      assert.deepEqual(patch, {
        "settlement.changes[0].after": 28000,
        "settlement.changes[1].after": 24000,
        "settlement.changes[2].after": 24000,
        "settlement.changes[3].after": 24000,
      });
    },
  };
  const next = structuredClone(host.data);
  next.settlement.changes[0].after = 28000;
  next.settlement.changes[1].after = 24000;
  next.settlement.changes[2].after = 24000;
  next.settlement.changes[3].after = 24000;
  const patch = patchView(host, next);
  assert.equal(Object.keys(patch).length, 4);
  assert.equal(host.data.settlement, next.settlement);
  assert.ok(Buffer.byteLength(JSON.stringify(patch)) < Buffer.byteLength(JSON.stringify(next)));
});

test("相同内容的轮询不跨数据桥，仍立即调用完成回调并更新逻辑引用", () => {
  const host = {
    data: { selected: -1, settlement: null, seats: [{ seat: 0, score: 25000 }] },
    setData() {
      assert.fail("unchanged views must not cross the native data bridge");
    },
  };
  const next = structuredClone(host.data);
  let completed = 0;
  assert.deepEqual(patchView(host, next, () => {
    completed++;
    assert.equal(host.data.seats, next.seats);
  }), {});
  assert.equal(completed, 1);
});

test("切换结算阶段替换长度变化的役数组并清掉旧ack及嵌套可选字段", () => {
  let received;
  const host = {
    data: {
      settlement: {
        stage: "detail",
        yaku: [{ name: "立直" }, { name: "一发" }],
        winner: { seat: 0, label: "上一位赢家" },
      },
      settlementAck: { id: "ack-old", type: "ack" },
      selected: -1,
    },
    setData(patch) { received = patch; },
  };
  const next = {
    settlement: { stage: "scores", yaku: [], winner: { seat: 0 } },
    settlementAck: null,
  };
  assert.deepEqual(patchView(host, next), {
    "settlement.stage": "scores",
    "settlement.yaku": [],
    "settlement.winner": { seat: 0 },
    settlementAck: null,
  });
  assert.equal(received["settlement.winner"], next.settlement.winner);
  assert.deepEqual(host.data.settlement.yaku, []);
  assert.equal("label" in host.data.settlement.winner, false);
  assert.equal(host.data.settlementAck, null);
  assert.equal(host.data.selected, -1);
});

test("异步渲染回调之前逻辑状态已原子更新，下一次比较不重复发送旧变化", () => {
  const callbacks = [];
  const received = [];
  const host = {
    data: { game: { decisionId: "old" }, actions: [], busy: true },
    setData(patch, done) {
      received.push(patch);
      assert.equal(this.data.game.decisionId, "new");
      assert.equal(this.data.busy, false);
      assert.equal(this.data.actions[0].id, "current-ack");
      callbacks.push(done);
    },
  };
  const next = { game: { decisionId: "new" }, actions: [{ id: "current-ack" }], busy: false };
  let completed = 0;
  patchView(host, next, () => {
    completed++;
    assert.equal(host.data.game.decisionId, "new");
  });
  assert.equal(completed, 0);
  assert.equal(host.data.game, next.game);
  assert.equal(callbacks.length, 1);
  assert.deepEqual(patchView(host, structuredClone(next)), {});
  assert.equal(received.length, 1);
  callbacks[0]();
  assert.equal(completed, 1);
});

test("初次出现及清空的null容器整体更新，相同键数的不同键仍整体替换", () => {
  const host = {
    data: { settlement: null, announcement: { text: "碰" }, safeInsets: { left: 10 } },
    setData() {},
  };
  const first = patchView(host, {
    settlement: { stage: "detail", yaku: [] },
    announcement: null,
    safeInsets: { right: 10 },
  });
  assert.deepEqual(first, {
    settlement: { stage: "detail", yaku: [] },
    announcement: null,
    safeInsets: { right: 10 },
  });
  assert.deepEqual(patchView(host, { settlement: null }), { settlement: null });
});

test("数组与对象类型改变时整体替换，新增的嵌套字段不遗失", () => {
  const host = { data: { reveals: [], seat: { name: "牌友" } }, setData() {} };
  assert.deepEqual(patchView(host, {
    reveals: { 0: { animate: true } },
    seat: { name: "牌友", connected: true },
  }), {
    reveals: { 0: { animate: true } },
    seat: { name: "牌友", connected: true },
  });
});
