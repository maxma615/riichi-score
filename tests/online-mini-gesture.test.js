import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../miniprogram/pages/online/index.js", import.meta.url),
);
const { dropOnTable, touchPoint } = require("../../utils/online-gesture");
const table = { left: 10, top: 20, right: 610, bottom: 420 };
const blocked = { left: 240, top: 200, right: 300, bottom: 245 };
function page({ delayed = false, missing = false, throws = false, flushFrames = true, windowInfo = null } = {}) {
  let p;
  const replies = [];
  const calls = [],
    sent = [];
  const query = {
    in(owner) {
      assert.equal(owner, p);
      return this;
    },
    select(selector) {
      calls.push(selector);
      return this;
    },
    selectAll(selector) {
      calls.push(selector);
      return this;
    },
    boundingClientRect() {
      return this;
    },
    exec(cb) {
      replies.push(cb);
      if (!delayed) cb(missing ? [] : [table, [blocked]]);
    },
  };
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
    {
      Page: (v) => {
        p = v;
      },
      require: (s) => (s === "../../utils/api" ? {} : require(s)),
      wx: {
        getWindowInfo: () => windowInfo,
        createSelectorQuery() {
          if (throws) throw Error("measurement unavailable");
          return query;
        },
      },
      clearTimeout() {},
      clearInterval() {},
    },
  );
  p.data = {
    ...p.data,
    room: { id: "room", members: [], variant: "yonma", mySeat: 0 },
    game: { decisionId: "d" },
    hand: [
      { id: 0, physicalKey: "tile-one", choiceId: "cut", decisionId: "d" },
    ],
  };
  p.active = true;
  p.setData = (v, done) => { Object.assign(p.data, v); done?.(); };
  // Geometry invariants inspect a completed visual frame; batching is tested separately.
  if (flushFrames) {
    const touchMove = p.touchMove;
    p.touchMove = event => { touchMove.call(p, event); p.dragFrames?.flush(); };
  }
  p.send = async (v) => {
    sent.push(v);
  };
  return {
    p,
    sent,
    calls,
    measured: (rect = table) => replies.at(-1)([rect, [blocked]]),
    measureAt: (index, rect = table) => replies[index]([rect, [blocked]]),
  };
}
const event = (x, y, identifier = 7) => ({
  clientX: x,
  clientY: y,
  identifier,
});
const start = (p) =>
  p.touchStart({
    currentTarget: { dataset: { index: 0 } },
    touches: [event(200, 380)],
  });
const end = (p, x = 200, y = 180, identifier = 7) =>
  p.touchEnd({ changedTouches: [event(x, y, identifier)] });

test("原生松手命中桌内，桌边／桌外／控件区域不出牌", async () => {
  for (const [x, y, expected] of [
    [200, 180, 1],
    [0, 180, 0],
    [615, 180, 0],
    [15, 180, 0],
    [200, 24, 0],
    [260, 220, 0],
    [200, 350, 0],
  ]) {
    const { p, sent, calls } = page();
    start(p);
    await end(p, x, y);
    assert.equal(sent.length, expected, `${x},${y}`);
    if (expected) {
      assert.deepEqual(calls, [".table", ".drag-exclusion"]);
      assert.equal(sent[0].choiceId, "cut");
      assert.equal(sent[0].decisionId, "d");
    }
  }
  assert.equal(touchPoint({ clientY: 100 }), null);
  assert.equal(touchPoint({ clientX: Infinity, clientY: 100 }), null);
  assert.equal(
    dropOnTable({ x: 200, y: 180 }, { table, excluded: null }),
    false,
  );
});

test("松手后异步测量期间取消／换桌／换决策／换牌／切后台不会提交旧选择", async () => {
  for (const change of [
    (p) => p.touchCancel(),
    (p) => p.onResize(),
    (p) => p.onPageScroll(),
    (p) => p.onHide(),
    (p) => {
      p.data.room.id = "other";
    },
    (p) => {
      p.data.game.decisionId = "next";
    },
    (p) => {
      p.data.busy = true;
    },
    (p) => {
      p.data.openingHolding = true;
    },
    (p) => {
      p.data.hand[0].choiceId = "other";
    },
    (p) => {
      p.data.hand[0].physicalKey = "other";
    },
    (p) => start(p),
  ]) {
    const { p, sent, measured } = page({ delayed: true });
    start(p);
    const pending = end(p);
    change(p);
    measured();
    await pending;
    assert.equal(sent.length, 0);
  }
});

test("新手指、多指或缺少测量结果不提交；拖动产生的tap不能选牌／双击出牌", async () => {
  for (const opts of [{ missing: true }, { throws: true }]) {
    const { p, sent } = page(opts);
    start(p);
    await end(p);
    assert.equal(sent.length, 0);
  }
  const { p, sent } = page();
  start(p);
  await end(p, 200, 180, 8);
  assert.equal(sent.length, 0);
  start(p);
  p.touchMove({ touches: [event(200, 180), event(201, 180, 8)] });
  await end(p);
  assert.equal(sent.length, 0);
  start(p);
  p.touchMove({ touches: [event(200, 180, 8)] });
  await end(p);
  assert.equal(sent.length, 0);
  p.data.selected = 0;
  start(p);
  p.touchMove({ touches: [event(0, 180)] });
  await end(p, 0, 180);
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(sent.length, 0);
  // A deliberate new touch can still select then confirm, independently of the failed drag.
  start(p);
  p.touchEnd({ changedTouches: [event(200, 380)] });
  p.data.selected = -1;
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(p.data.selected, 0);
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(sent.length, 1);
});

test("WXML阻止手牌拖动带动页面滚动，实测排除按钮与浮层", () => {
  const wxml = readFileSync("miniprogram/pages/online/index.wxml", "utf8");
  assert.match(wxml, /catchtouchmove="touchMove"/);
  assert.match(wxml, /class="result-overlay drag-exclusion"/);
  assert.match(wxml, /class="hand drag-exclusion {{draggingId>=0\?/);
  assert.match(wxml, /class="drag-exclusion"\s+data-id="{{item.id}}"/);
});

test("拖动预览跟随手指且只测量一次提示几何，选中牌的抬升位置不跳变", async () => {
  const { p, sent, calls, measureAt } = page({ delayed: true });
  p.data.selected = 0;
  start(p);
  const move = (x, y) => p.touchMove({ touches: [event(x, y)] });
  move(205, 375);
  assert.equal(p.data.draggingId, -1);
  assert.equal(calls.length, 0);
  move(220, 180);
  assert.equal(p.data.draggingId, 0);
  assert.equal(p.data.dragStyle, "transform:translate(20px,-212px);");
  assert.equal(p.data.dropTarget, false);
  measureAt(0);
  await Promise.resolve();
  p.dragFrames?.flush();
  assert.equal(p.data.dropTarget, true);
  move(260, 220);
  assert.equal(p.data.dropTarget, false);
  move(0, 180);
  assert.equal(p.data.dropTarget, false);
  move(200, 180);
  assert.equal(p.data.dropTarget, true);
  assert.deepEqual(calls, [".table", ".drag-exclusion"]);
  let updates = 0;
  const setData = p.setData;
  p.setData = (v, done) => {
    updates++;
    setData(v, done);
  };
  move(200, 180);
  assert.equal(updates, 0);
  p.touchCancel();
  assert.equal(p.data.draggingId, -1);
  assert.equal(p.data.dragStyle, "");
  assert.equal(p.data.dropTarget, false);
  assert.equal(p.data.selected, 0);
  assert.equal(sent.length, 0);
});

test("桌面提示是预览，松手重新测量；旧预览回调不让取消的牌再浮起", async () => {
  const { p, sent, calls, measureAt } = page({ delayed: true });
  start(p);
  p.touchMove({ touches: [event(200, 180)] });
  measureAt(0);
  await Promise.resolve();
  p.dragFrames?.flush();
  assert.equal(p.data.dropTarget, true);
  const pending = end(p);
  assert.equal(p.data.draggingId, -1);
  assert.equal(p.data.dropTarget, false);
  assert.equal(calls.length, 4);
  measureAt(1, { ...table, left: 300 });
  await pending;
  assert.equal(sent.length, 0);
  const next = page({ delayed: true });
  start(next.p);
  next.p.touchMove({ touches: [event(200, 180)] });
  const released = end(next.p);
  next.measureAt(0);
  await Promise.resolve();
  p.dragFrames?.flush();
  assert.equal(next.p.data.draggingId, -1);
  assert.equal(next.p.data.dropTarget, false);
  next.measureAt(1);
  await released;
  assert.equal(next.sent.length, 1);
});

test("旋转、滚动和后台清除移动牌和桌面提示；旧预览结果不会恢复", async () => {
  for (const cancel of [
    (p) => p.onResize(),
    (p) => p.onPageScroll(),
    (p) => p.onHide(),
  ]) {
    const { p, sent, measureAt } = page({ delayed: true });
    start(p);
    p.touchMove({ touches: [event(200, 180)] });
    assert.equal(p.data.draggingId, 0);
    cancel(p);
    measureAt(0);
    await Promise.resolve();
  p.dragFrames?.flush();
    assert.equal(p.data.draggingId, -1);
    assert.equal(p.data.dragStyle, "");
    assert.equal(p.data.dropTarget, false);
    await end(p);
    assert.equal(sent.length, 0);
  }
});

test("真实三维落点优先于矩形回退，保留手牌与控件排除区域", async () => {
  const geometry = { table, excluded: [blocked] };
  assert.equal(dropOnTable({ x: 200, y: 180 }, geometry, false), false);
  assert.equal(dropOnTable({ x: 200, y: 180 }, geometry, null), true);
  assert.equal(dropOnTable({ x: 260, y: 220 }, geometry, true), false);
  assert.equal(dropOnTable({ x: 200, y: 180 }, geometry, true), true);
  // The camera's projected surface owns the boundary, including points outside
  // the old flat-table inset. Native controls are always excluded separately.
  assert.equal(dropOnTable({ x: 15, y: 180 }, geometry, true), true);
  for (const [projected, expected] of [[false, 0], [true, 1], [null, 1]]) {
    const { p, sent } = page();
    p.table3d = { dropOnTable: () => projected };
    start(p);
    await end(p);
    assert.equal(sent.length, expected);
  }
});

test("原生三维桌面提示仅在命中改变时绘制，取消拖牌立即清除", async () => {
  const { p } = page(), highlights = [];
  p.table3d = { dropOnTable: () => true, setDropTarget: value => highlights.push(value) };
  start(p);
  p.touchMove({ touches: [event(200, 180)] });
  await Promise.resolve();
  p.dragFrames?.flush();
  p.touchMove({ touches: [event(205, 180)] });
  assert.deepEqual(highlights, [true]);
  p.touchMove({ touches: [event(260, 220)] });
  assert.deepEqual(highlights, [true, false]);
  p.touchMove({ touches: [event(200, 180)] });
  p.touchCancel();
  assert.deepEqual(highlights, [true, false, true, false]);
});


test("实际Page拖动突发只更新活动实体牌，并等待原生帧回调", async () => {
 const {p}=page({flushFrames:false});
 const updates=[];p.setData=(v,done)=>{updates.push(v);Object.assign(p.data,v);done?.();};
 start(p);
 for(let i=0;i<120;i++)p.touchMove({touches:[event(200+i,180)]});
 assert.equal(updates.length,0);
 p.dragFrames.flush();
 assert.equal(updates.length,1);
 assert.equal(p.data.hand[0].dragStyle,'transform:translate(119px,-200px);');
 assert.ok(Object.keys(updates[0]).some(key=>key==='hand[0]'));
 assert.ok(!Object.hasOwn(updates[0],'hand'));
 p.touchCancel();
 assert.equal(p.data.hand[0].dragging,false);
});

test("滚动与安全区改变重新测量三维视口，不沿用旧拖牌投影", () => {
  const { p } = page({ windowInfo: { screenWidth: 844, screenHeight: 390,
    safeArea: { left: 47, right: 797, top: 0, bottom: 390 } } });
  let invalidated = 0, synced = 0;
  p.table3d = { resize: () => invalidated++ };
  p.syncTable3D = () => synced++;
  p.onPageScroll();
  assert.equal(invalidated, 1);
  p.updateSafeArea({ windowWidth: 844 });
  assert.equal(invalidated, 2);
  assert.equal(p.data.safeInsets.left, 47);
  p.updateSafeArea({ windowWidth: 844 });
  assert.equal(invalidated, 2, '相同安全区不重复测量');
  assert.equal(synced, 1);
});
