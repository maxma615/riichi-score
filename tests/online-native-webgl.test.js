import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  pointInPolygon,
  nativePieceNode,
  nativeQuality,
} = require("../archive/native-online/utils/online-table3d.js");
test("native geometric drop uses camera polygons, not rectangle approximations", () => {
  const felt = [
    { x: 40, y: 20 },
    { x: 160, y: 20 },
    { x: 200, y: 160 },
    { x: 0, y: 160 },
  ];
  assert.equal(pointInPolygon({ x: 100, y: 100 }, felt), true);
  assert.equal(pointInPolygon({ x: 5, y: 25 }, felt), false);
});
test("native physical pieces map to existing stable flight targets", () => {
  assert.equal(
    nativePieceNode({ kind: "river", seat: 2, index: 7 }),
    "river-2-7",
  );
  assert.equal(
    nativePieceNode({ kind: "nuki", seat: 1, index: 2 }),
    "north-1-2",
  );
  assert.equal(nativePieceNode({ kind: "concealed", seat: 1, index: 2 }), null);
});
test("native quality caps framebuffer area and device pixel ratio", () => {
  assert.deepEqual(nativeQuality(844, 390, 3), { dpr: 1.25, shadowSize: 512 });
  assert.ok(nativeQuality(2600, 1400, 3).dpr <= 1);
});
test("scoped Three adapter cannot pollute application Object.prototype", () => {
  const { scopedThree } = require("../archive/native-online/utils/online-table3d.js");
  assert.equal(typeof scopedThree, "function");
  const canvas = {},
    baseline = Object.getOwnPropertyNames(Object.prototype);
  try {
    const result = scopedThree(canvas, () => {
      Object.defineProperty(Object.prototype, "addEventListener", {
        value: function () {
          return this;
        },
        configurable: true,
        writable: true,
      });
      return { marker: true };
    });
    assert.equal(result.marker, true);
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), baseline);
    assert.equal(canvas.addEventListener(), canvas);
  } finally {
    if (!baseline.includes("addEventListener"))
      delete Object.prototype.addEventListener;
  }
});

test("scoped native events survive without modifying another canvas prototype", () => {
  const { scopedThree } = require("../archive/native-online/utils/online-table3d.js");
  class Canvas {
    addEventListener() {
      return "native";
    }
  }
  const c = new Canvas(),
    before = Object.getOwnPropertyDescriptor(
      Canvas.prototype,
      "addEventListener",
    );
  scopedThree(c, () => {
    Canvas.prototype.addEventListener = () => "adapter";
    return {};
  });
  assert.equal(c.addEventListener(), "native");
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Canvas.prototype, "addEventListener"),
    before,
  );
});

test("missing native canvas suspends rendering and stale selector cannot reactivate it", async () => {
  const { NativeTable3D } = require("../archive/native-online/utils/online-table3d.js");
  const callbacks = [],
    h = {
      active: true,
      data: { room: { game: {} }, table3dReady: true },
      setData(v) {
        Object.assign(this.data, v);
      },
    };
  const q = {
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
    exec(cb) {
      callbacks.push(cb);
    },
  };
  const c = new NativeTable3D(h, { createSelectorQuery: () => q });
  let suspended = 0;
  c.scene = {
    suspend() {
      suspended++;
    },
  };
  const pending = c.sync();
  callbacks.shift()([null, null]);
  assert.equal(await pending, false);
  assert.equal(suspended, 1);
  assert.equal(h.data.table3dReady, false);
  assert.equal(c.rect, null);
  const late = c.sync();
  c.suspend();
  callbacks.shift()([{ node: {} }, { width: 100, height: 100 }]);
  assert.equal(await late, false);
  assert.equal(h.data.table3dReady, false);
});
