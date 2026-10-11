import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { YAKU, searchYaku } from "../src/yaku.js";
const mini = createRequire(import.meta.url)("../miniprogram/utils/yaku.js");
test("查番目录门清副露与役满、两端同源检索", () => {
  assert.equal(new Set(YAKU.map((y) => y.name)).size, YAKU.length);
  assert.deepEqual(JSON.parse(JSON.stringify(mini.YAKU)), YAKU);
  for (const [name, closed, open] of [
    ["立直", 1, null],
    ["七对子", 2, null],
    ["三色同顺", 2, 1],
    ["混一色", 3, 2],
    ["清一色", 6, 5],
    ["大四喜", "双倍役满", "双倍役满"],
  ]) {
    const y = YAKU.find((y) => y.name === name);
    assert.equal(y.closed, closed);
    assert.equal(y.open, open);
  }
  assert.equal(searchYaku("  三色  ").length, 2);
  assert.ok(searchYaku("字牌", "役满").some((y) => y.name === "字一色"));
  assert.deepEqual(mini.searchYaku("三色", "2番"), searchYaku("三色", "2番"));
  assert.equal(searchYaku("不存在的役种").length, 0);
});
