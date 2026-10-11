import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
const require = createRequire(import.meta.url);
const { tile, callArt } = require("../miniprogram/utils/online");
const hash = (x) => createHash("sha256").update(x).digest("hex");
const root = new URL("../miniprogram/", import.meta.url);
const assetPath = new URL("assets/", root);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", assetPath)));
test("原生牌面资源覆盖全部牌种及赤五，PNG与授权源绑定且无需图片网络请求", () => {
  const values = [
    ...["m", "p", "s"].flatMap((s) =>
      Array.from({ length: 10 }, (_, n) => s + n),
    ),
    ...Array.from({ length: 7 }, (_, n) => "z" + (n + 1)),
  ];
  for (const value of values) {
    const src = tile(value + "_").src;
    assert.match(src, /^\/assets\/tiles\/[A-Za-z0-9-]+\.png$/);
    const record = manifest.files.find((f) => "/assets/" + f.target === src);
    assert.ok(record, value);
    const data = readFileSync(new URL(record.target, assetPath));
    assert.equal(hash(data), record.sha256);
    assert.equal(
      hash(readFileSync(new URL("../" + record.source, import.meta.url))),
      record.sourceSha256,
    );
    const png = PNG.sync.read(data);
    assert.equal(png.width, 150);
    assert.equal(png.height, 200);
    if (value === "z5")
      assert.equal(
        png.data.some((v, i) => i % 4 === 3 && v > 0),
        false,
      );
    // The licensed white dragon has a blank face; the native tile body supplies ivory.
    else assert.ok(png.data.some((v, i) => i % 4 === 3 && v > 0));
  }
  assert.equal(tile("unknown").src, "/assets/tiles/Blank.png");
  for (const suit of ["m", "p", "s"])
    assert.notEqual(
      hash(readFileSync(new URL("." + tile(suit + "0").src, root))),
      hash(readFileSync(new URL("." + tile(suit + "5").src, root))),
    );
  assert.equal(
    manifest.files.filter((f) => f.target.startsWith("tiles/")).length,
    39,
  );
});
test("声明与和牌标题使用本地书法PNG，透明边缘与字体来源保留，包体在自定预算内", () => {
  const glyphs = ["立直", "自摸", "荣和", "吃", "碰", "杠", "拔北"];
  const identities = new Set();
  for (const label of glyphs) {
    const src = callArt(label),
      record = manifest.files.find((f) => "/assets/" + f.target === src);
    assert.ok(record, label);
    const data = readFileSync(new URL(record.target, assetPath)),
      png = PNG.sync.read(data);
    assert.equal(hash(data), record.sha256);
    identities.add(record.sha256);
    assert.equal(
      hash(readFileSync(new URL("../" + record.source, import.meta.url))),
      record.sourceSha256,
    );
    assert.equal(png.width, 480);
    assert.equal(png.height, 240);
    assert.equal(png.data[3], 0);
    assert.ok(png.data.some((v, i) => i % 4 === 3 && v > 0));
  }
  const { presentation } = require("../miniprogram/utils/online-settlement");
  const result = presentation(
    {
      settlement: {
        kind: "win",
        name: "和了",
        winnerSeat: 1,
        winMethod: "ron",
        han: 1,
        fu: 30,
        yaku: [],
        delta: [-1000, 1000, 0, 0],
        hand: "",
        uraIndicators: [],
      },
      settlementFlow: {
        id: "intro",
        stage: "detail",
        detailIndex: 0,
        detailCount: 1,
        oldScores: [25000, 25000, 25000, 25000],
        newScores: [24000, 26000, 25000, 25000],
        delta: [-1000, 1000, 0, 0],
        winDeclarations: [{ seat: 1, winMethod: "ron" }],
      },
    },
    [{ seat: 1, name: "合成玩家", score: 25000, edge: "right" }],
    0,
  );
  assert.equal(result.titleArt, callArt("荣和"));
  assert.equal(result.declarations[0].art, callArt("荣和"));
  assert.equal(identities.size, 7);
  assert.equal(callArt("点数结算"), "");
  const license = readFileSync(
    new URL("licenses/Ma-Shan-Zheng-OFL.txt", assetPath),
    "utf8",
  );
  assert.match(license, /SIL OPEN FONT LICENSE/);
  assert.match(
    readFileSync(
      new URL(
        "licenses/FluffyStuff-riichi-mahjong-tiles-LICENSE.md",
        assetPath,
      ),
      "utf8",
    ),
    /CC0|public domain/i,
  );
  const size = (p) =>
    readdirSync(p, { withFileTypes: true }).reduce((sum, f) => {
      const child = new URL(f.name + (f.isDirectory() ? "/" : ""), p);
      return sum + (f.isDirectory() ? size(child) : statSync(child).size);
    }, 0);
  assert.ok(
    size(root) < 1.5 * 1024 * 1024,
    "Own 1.5MiB native source/asset budget",
  );
});
