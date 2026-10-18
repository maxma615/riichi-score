import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
const local = new URL("../.local/", import.meta.url);
mkdirSync(local, { recursive: true });
const out = mkdtempSync(path.join(fileURLToPath(local), "native-performance-"));
await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/online/client/native-table3d.js", import.meta.url),
    ),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(out, "native.cjs"),
  logLevel: "silent",
});
const { NativeTable3D } = createRequire(import.meta.url)(
  path.join(out, "native.cjs"),
);
process.on("exit", () => rmSync(out, { recursive: true, force: true }));
function setup() {
  const host = {
    active: true,
    data: { room: { mySeat: 0, game: { players: [] } }, seats: [], game: {} },
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  let queries = 0,
    renders = 0,
    suspends = 0;
  const node = {},
    rect = { left: 0, top: 0, width: 844, height: 390 };
  const query = {
    in() {
      return this;
    },
    select() {
      return this;
    },
    fields() {
      return this;
    },
    boundingClientRect() {
      return this;
    },
    exec(callback) {
      callback([{ node }, rect]);
    },
  };
  const controller = new NativeTable3D(host, {
    createSelectorQuery() {
      queries++;
      return query;
    },
  });
  controller.canvas = node;
  controller.rect = rect;
  controller.scene = {
    resume() {},
    resize() {},
    setPieces() {},
    setDropTarget() {},
    project: ([x, y]) => ({ x, y }),
    renderNow() {
      renders++;
      return true;
    },
    suspend() {
      suspends++;
    },
  };
  return {
    host,
    controller,
    queries: () => queries,
    renders: () => renders,
    suspends: () => suspends,
  };
}
test("native controller reuses mounted canvas layout until resize or suspend invalidates it", async () => {
  const s = setup();
  assert.equal(await s.controller.sync(), true);
  assert.equal(await s.controller.sync(), true);
  assert.equal(
    s.queries(),
    0,
    "unchanged native node and layout need no selector bridge calls",
  );
  await s.controller.resize();
  assert.equal(s.queries(), 1);
  s.controller.suspend();
  await s.controller.sync();
  assert.equal(s.queries(), 2);
});
test("opaque settlement and ranking suspend native GPU work, then resume from a fresh layout", async () => {
  const s = setup();
  s.host.data.table3dReady = true;
  s.host.data.settlement = { visible: true };
  assert.equal(await s.controller.sync(), false);
  assert.equal(s.suspends(), 1);
  assert.equal(s.queries(), 0);
  assert.equal(s.renders(), 0);
  assert.equal(s.host.data.table3dReady, true, 'result panel must not reveal flat measurement proxies');
  s.host.data.settlement.visible = false;
  assert.equal(await s.controller.sync(), true);
  assert.equal(s.queries(), 1);
  s.host.data.game.ranking = [];
  assert.equal(await s.controller.sync(), false);
  assert.equal(s.suspends(), 2);
  assert.equal(s.queries(), 1);
  assert.equal(s.renders(), 1);
});

test("Android adapts once after three consistently slow warmed presentation copies", () => {
  const s = setup();
  s.controller.platform = "android";
  const sizes = [];
  Object.assign(s.controller.scene, {
    width: 844,
    height: 390,
    dpr: 1.25,
    stats: {},
    resize(w, h, dpr) {
      this.dpr = dpr;
      sizes.push([w, h, dpr]);
    },
  });
  s.controller.presented(80);
  s.controller.presented(90);
  s.controller.presented(10);
  s.controller.presented(12);
  assert.equal(
    sizes.length,
    0,
    "warmup frames and fewer than three slow copies cannot downgrade",
  );
  s.controller.presented(15);
  assert.deepEqual(sizes, [[844, 390, 1]]);
  assert.equal(s.controller.metrics.effectiveDpr, 1);
  assert.equal(s.controller.metrics.qualityReason, "slow-android-canvas-copy");
  for (let i = 0; i < 6; i++) s.controller.presented(20);
  assert.equal(
    sizes.length,
    1,
    "adaptive cap cannot oscillate or resize repeatedly",
  );
});
test("fast Android, iOS and an already smaller framebuffer preserve their existing quality", () => {
  for (const [platform, dpr] of [
    ["android", 1.25],
    ["ios", 1.25],
    ["android", 0.8],
  ]) {
    const s = setup();
    s.controller.platform = platform;
    let resized = 0;
    Object.assign(s.controller.scene, {
      dpr,
      resize() {
        resized++;
      },
    });
    for (const ms of [80, 90, 15, 6, 14, 8, 20, 5, 20])
      s.controller.presented(ms);
    assert.equal(resized, 0, platform + ":" + dpr);
  }
});
