import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { YAKU, searchYaku, mahjongTerm } from "../src/yaku.js";
import { readFileSync } from "node:fs";
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
test("联机役名与流局标题使用同源中文，未知名称原样保留", () => {
  for (const [raw, expected] of [
    ["一気通貫", "一气通贯"],
    ["門前清自摸和", "门前清自摸和"],
    ["対々和", "对对和"],
    ["七対子", "七对子"],
    ["一盃口", "一杯口"],
    ["純全帯幺九", "纯全带幺九"],
    ["翻牌 發", "役牌 发"],
    ["場風 東", "场风 东"],
    ["自風 南", "自风 南"],
    ["ドラ", "宝牌"],
    ["裏ドラ", "里宝牌"],
    ["赤ドラ", "赤宝牌"],
    ["抜きドラ", "拔北宝牌"],
    ["国士無双十三面", "国士无双十三面听牌"],
    ["四暗刻単騎", "四暗刻单骑"],
    ["四開槓", "四杠散了"],
    ["九種九牌", "九种九牌"],
    ["流し満貫", "流满贯"],
    ["未来役种", "未来役种"],
    ["constructor", "constructor"],
  ]) {
    assert.equal(mahjongTerm(raw), expected);
    assert.equal(mini.mahjongTerm(raw), expected);
  }
  // Audit the pinned primary implementation, including all ordinary/limit/bonus names.
  const core = readFileSync(
    new URL(
      "../node_modules/@kobalab/majiang-core/lib/hule.js",
      import.meta.url,
    ),
    "utf8",
  );
  for (const [, raw] of core.matchAll(/name\s*:\s*'([^']+)'/g)) {
    if (raw.endsWith(" ")) continue; // Wind names are concatenated by the engine.
    const label = mahjongTerm(raw);
    assert.equal(mini.mahjongTerm(raw), label);
    assert.doesNotMatch(label, /[\u3040-\u30ff気貫対盃無槓緑単蓮燈帯發門嶺撈]/);
  }
  for (const prefix of ["場風", "自風"])
    for (const wind of ["東", "南", "西", "北"])
      assert.doesNotMatch(mahjongTerm(prefix + " " + wind), /[場風東]/);
});
