import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { horizontalInsets } = createRequire(import.meta.url)(
  "../archive/native-online/utils/online-safe-area.js",
);

test("native landscape cutouts and portrait-info rotation fit the measured page", () => {
  const portrait = {
    screenWidth: 390,
    screenHeight: 844,
    safeArea: { left: 0, right: 390, top: 47, bottom: 810 },
  };
  assert.deepEqual(horizontalInsets(portrait, 390), { left: 0, right: 0 });
  assert.deepEqual(horizontalInsets(portrait, 844), { left: 47, right: 47 });
  assert.deepEqual(
    horizontalInsets(
      {
        screenWidth: 844,
        screenHeight: 390,
        safeArea: { left: 47, right: 810, top: 0, bottom: 369 },
      },
      844,
    ),
    { left: 47, right: 34 },
  );
  assert.deepEqual(
    horizontalInsets(
      {
        screenWidth: 740,
        screenHeight: 360,
        safeArea: { left: 0, right: 740 },
      },
      740,
    ),
    { left: 0, right: 0 },
  );
  assert.deepEqual(horizontalInsets(null, 844), { left: 0, right: 0 });
  assert.deepEqual(horizontalInsets(portrait, NaN), { left: 0, right: 0 });
});

test("native page discards stale safe-area measurements after a resize or hide", () => {
  const previousPage = globalThis.Page,
    previousWx = globalThis.wx;
  let definition, measured;
  try {
    globalThis.Page = (page) => {
      definition = page;
    };
    globalThis.wx = {
      getWindowInfo: () => ({
        screenWidth: 390,
        screenHeight: 844,
        safeArea: { left: 0, right: 390, top: 47, bottom: 810 },
      }),
      createSelectorQuery: () => ({
        in(page) {
          assert.equal(page, instance);
          return this;
        },
        select(selector) {
          assert.equal(selector, ".online");
          return this;
        },
        boundingClientRect(callback) {
          measured = callback;
          return this;
        },
        exec() {},
      }),
    };
    createRequire(import.meta.url)("../archive/native-online/pages/online/index.js");
    const instance = {
      ...definition,
      active: true,
      data: {},
      setData(update) {
        Object.assign(this.data, update);
      },
      touchCancel() {},
      cancelOpening() {},
    };
    instance.updateSafeArea();
    instance.onResize({ size: { windowWidth: 844, windowHeight: 346 } });
    assert.deepEqual(instance.data.safeInsets, { left: 47, right: 47 });
    measured({ width: 390 });
    assert.deepEqual(instance.data.safeInsets, { left: 47, right: 47 });
    instance.onResize({ size: { windowWidth: 390, windowHeight: 671 } });
    assert.deepEqual(instance.data.safeInsets, { left: 0, right: 0 });
    instance.updateSafeArea();
    instance.active = false;
    measured({ width: 844 });
    assert.deepEqual(instance.data.safeInsets, { left: 0, right: 0 });
  } finally {
    globalThis.Page = previousPage;
    globalThis.wx = previousWx;
  }
});
