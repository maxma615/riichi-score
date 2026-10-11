import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../miniprogram/pages/online/index.js', import.meta.url));
const { dropOnTable, touchPoint } = require('../../utils/online-gesture');
const table = { left: 10, top: 20, right: 610, bottom: 420 };
const blocked = { left: 240, top: 200, right: 300, bottom: 245 };
function page({ delayed = false, missing = false, throws = false } = {}) {
  let p, reply;
  const calls = [], sent = [];
  const query = {
    in(owner) { assert.equal(owner, p); return this; },
    select(selector) { calls.push(selector); return this; },
    selectAll(selector) { calls.push(selector); return this; },
    boundingClientRect() { return this; },
    exec(cb) { reply = cb; if (!delayed) cb(missing ? [] : [table, [blocked]]); },
  };
  vm.runInNewContext(readFileSync('miniprogram/pages/online/index.js', 'utf8'), {
    Page: v => { p = v; }, require: s => s === '../../utils/api' ? {} : require(s),
    wx: { createSelectorQuery() { if (throws) throw Error('measurement unavailable'); return query; } },
    clearTimeout() {}, clearInterval() {},
  });
  p.data = { ...p.data, room: { id: 'room', members: [], variant: 'yonma', mySeat: 0 },
    game: { decisionId: 'd' },
    hand: [{ id: 0, physicalKey: 'tile-one', choiceId: 'cut', decisionId: 'd' }],
  };
  p.active = true;
  p.setData = v => Object.assign(p.data, v);
  p.send = async v => { sent.push(v); };
  return { p, sent, calls, measured: () => reply([table, [blocked]]) };
}
const event = (x, y, identifier = 7) => ({ clientX: x, clientY: y, identifier });
const start = p => p.touchStart({ currentTarget: { dataset: { index: 0 } }, touches: [event(200, 380)] });
const end = (p, x = 200, y = 180, identifier = 7) => p.touchEnd({ changedTouches: [event(x, y, identifier)] });

test('原生松手命中桌内，桌边／桌外／控件区域不出牌', async () => {
  for (const [x, y, expected] of [[200, 180, 1], [0, 180, 0], [615, 180, 0], [15, 180, 0], [200, 24, 0], [260, 220, 0], [200, 350, 0]]) {
    const { p, sent, calls } = page(); start(p); await end(p, x, y);
    assert.equal(sent.length, expected, `${x},${y}`);
    if (expected) {
      assert.deepEqual(calls, ['.table', '.drag-exclusion']);
      assert.equal(sent[0].choiceId, 'cut');
      assert.equal(sent[0].decisionId, 'd');
    }
  }
  assert.equal(touchPoint({ clientY: 100 }), null);
  assert.equal(touchPoint({ clientX: Infinity, clientY: 100 }), null);
  assert.equal(dropOnTable({ x: 200, y: 180 }, { table, excluded: null }), false);
});

test('松手后异步测量期间取消／换桌／换决策／换牌／切后台不会提交旧选择', async () => {
  for (const change of [p => p.touchCancel(), p => p.onResize(), p => p.onPageScroll(),
    p => p.onHide(), p => { p.data.room.id = 'other'; },
    p => { p.data.game.decisionId = 'next'; }, p => { p.data.busy = true; },
    p => { p.data.openingHolding = true; }, p => { p.data.hand[0].choiceId = 'other'; },
    p => { p.data.hand[0].physicalKey = 'other'; }, p => start(p)]) {
    const { p, sent, measured } = page({ delayed: true });
    start(p); const pending = end(p); change(p); measured(); await pending;
    assert.equal(sent.length, 0);
  }
});

test('新手指、多指或缺少测量结果不提交；拖动产生的tap不能选牌／双击出牌', async () => {
  for (const opts of [{ missing: true }, { throws: true }]) {
    const { p, sent } = page(opts); start(p); await end(p); assert.equal(sent.length, 0);
  }
  const { p, sent } = page();
  start(p); await end(p, 200, 180, 8); assert.equal(sent.length, 0);
  start(p); p.touchMove({ touches: [event(200, 180), event(201, 180, 8)] });
  await end(p); assert.equal(sent.length, 0);
  start(p); p.touchMove({ touches: [event(200, 180, 8)] });
  await end(p); assert.equal(sent.length, 0);
  p.data.selected = 0;
  start(p); p.touchMove({ touches: [event(0, 180)] });
  await end(p, 0, 180);
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(sent.length, 0);
  // A deliberate new touch can still select then confirm, independently of the failed drag.
  start(p); p.touchEnd({ changedTouches: [event(200, 380)] });
  p.data.selected = -1;
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(p.data.selected, 0);
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(sent.length, 1);
});

test('WXML阻止手牌拖动带动页面滚动，实测排除按钮与浮层', () => {
  const wxml = readFileSync('miniprogram/pages/online/index.wxml', 'utf8');
  assert.match(wxml, /catchtouchmove="touchMove"/);
  assert.match(wxml, /class="result-overlay drag-exclusion"/);
  assert.match(wxml, /class="hand drag-exclusion"/);
  assert.match(wxml, /class="drag-exclusion"\s+data-id="{{item.id}}"/);
});
