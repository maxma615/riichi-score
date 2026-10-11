// Real WXML/model with a browser CSS adapter; this is not a WeChat device test.
import { JSDOM } from "jsdom";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";
const require = createRequire(import.meta.url);
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://example.test",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle,
});
const simulate = require("miniprogram-simulate");
const { snapshot } = require("../miniprogram/utils/online");
const { presentation } = require("../miniprogram/utils/online-settlement");
const output = ".local/browser/native-layout";
mkdirSync(output, { recursive: true });
const compiled = path.resolve(output, `fixtures-${process.pid}.mjs`);
await build({
  entryPoints: ["tests/online-interaction-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: compiled,
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
const { scenario } = await import(pathToFileURL(compiled));
const template = readFileSync("miniprogram/pages/online/index.wxml", "utf8");
const css =
  readFileSync("miniprogram/app.wxss", "utf8") +
  "\n" +
  readFileSync("miniprogram/pages/online/index.wxss", "utf8");
const normalized = (width) =>
  css
    .replace(
      /(-?\d+(?:\.\d+)?)rpx/g,
      (_, n) => `${(Number(n) * width) / 750}px`,
    )
    .replace(
      /(?<![.#\w-])(page|view|text|image|button|input|picker)(?![\w-])/g,
      (_, tag) => (tag === "page" ? "body" : "wx-" + tag),
    );
function html(room) {
  const data = {
    variant: "yonma",
    mode: "east",
    code: "",
    ...snapshot({ room }),
    selected: -1,
    busy: false,
  };
  data.settlement = presentation(data.game, data.seats);
  const id = simulate.load({ template, data }),
    component = simulate.render(id);
  component.attach(document.body);
  // Built-in image src is not exposed by this simulator. Only own faces are
  // painted from the known model, to aid visual review; geometry uses real CSS.
  component.dom.querySelectorAll(".hand .tile wx-image").forEach((image, i) => {
    const img = document.createElement("img");
    img.style = "width:100%;height:100%;display:block";
    img.src =
      "data:image/png;base64," +
      readFileSync("miniprogram" + data.hand[i].src).toString("base64");
    image.append(img);
  });
  const result = component.dom.outerHTML;
  component.detach();
  return result;
}
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const name of ["riichi", "nuki-double"])
    for (const [width, height] of [
      [568, 260],
      [640, 280],
      [740, 310],
      [844, 340],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      await page.route("**/*", (r) => r.abort());
      await page.setContent(
        "<style>html,body{margin:0;padding:0}wx-view{display:block}wx-text{display:inline}wx-image{display:inline-block}wx-button{display:block;box-sizing:border-box;text-align:center;border:none}" +
          normalized(width) +
          "</style>" +
          html(scenario(name, false).view()),
      );
      await page
        .locator("img")
        .evaluateAll((images) => Promise.all(images.map((i) => i.decode())));
      const boxes = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return (
            r && {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            }
          );
        };
        return {
          table: box(".table"),
          hand: box(".hand"),
          header: box(".row"),
          hostButton: box(".row wx-button"),
          actions: box(".actions"),
          labels: [...document.querySelectorAll(".player-label")].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
            };
          }),
          racks: [...document.querySelectorAll(".opponent")].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
            };
          }),
          tiles: [...document.querySelectorAll(".hand .tile")].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
            };
          }),
          scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      assert.equal(boxes.tiles.length, 14, name);
      assert.ok(
        boxes.table.bottom <= height + 1,
        JSON.stringify({ name, width, height, ...boxes }),
      );
      assert.ok(
        boxes.scrollHeight <= height + 1 && boxes.scrollWidth <= width + 1,
        "No page overflow: " + JSON.stringify({ width, height, ...boxes }),
      );
      assert.ok(boxes.header.height <= 36.5);
      assert.ok(boxes.hostButton.height <= 36.5);
      for (const t of boxes.tiles) {
        assert.ok(
          t.left >= boxes.table.left + 5 && t.right <= boxes.table.right - 5,
        );
        assert.ok(
          t.top >= boxes.table.top && t.bottom + 5 <= boxes.table.bottom,
        );
      }
      assert.ok(
        boxes.actions.top >= boxes.table.top &&
          boxes.actions.bottom <= boxes.hand.top - 2,
      );
      const overlap = (a, b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      for (const label of boxes.labels) {
        for (const rack of boxes.racks)
          assert.ok(
            !overlap(label, rack),
            JSON.stringify({ name, width, height, label, rack }),
          );
        assert.ok(
          !overlap(label, boxes.actions),
          JSON.stringify({
            name,
            width,
            height,
            label,
            actions: boxes.actions,
          }),
        );
      }
      await page.screenshot({
        path: path.join(output, `${name}-${width}x${height}.png`),
      });
      results.push({ name, width, height, passed: true, boxes });
      await page.close();
    }
  for (const name of ["entry", "lobby"])
    for (const [width, height] of [
      [568, 260],
      [640, 280],
      [740, 310],
      [844, 340],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route("**/*", (r) => r.abort());
      const room =
        name === "entry"
          ? null
          : {
              ...scenario("riichi", false).view(),
              status: "lobby",
              game: null,
            };
      await page.setContent(
        "<style>html,body{margin:0;padding:0}wx-view{display:block}wx-text{display:inline}wx-image{display:inline-block}wx-button,wx-input{display:block;box-sizing:border-box;text-align:center;border:none}" +
          normalized(width) +
          "</style>" +
          html(room),
      );
      const boxes = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        controls: [...document.querySelectorAll("wx-button,wx-input")].map(
          (el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              height: r.height,
            };
          },
        ),
      }));
      assert.ok(
        boxes.scrollHeight <= height + 1 && boxes.scrollWidth <= width + 1,
        JSON.stringify({ name, width, height, ...boxes }),
      );
      assert.ok(boxes.controls.length >= 4);
      for (const r of boxes.controls)
        assert.ok(
          r.left >= 0 &&
            r.right <= width + 1 &&
            r.top >= 0 &&
            r.bottom <= height + 1,
          JSON.stringify({ name, width, height, r }),
        );
      await page.screenshot({
        path: path.join(output, `${name}-${width}x${height}.png`),
      });
      results.push({ name, width, height, passed: true, boxes });
      await page.close();
    }
} finally {
  await browser.close();
  rmSync(compiled, { force: true });
}
writeFileSync(
  path.join(output, "results.json"),
  JSON.stringify(
    {
      scope:
        "WXML model + browser geometry adapter; no WeChat runtime/device/orientation-lock proof",
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    results.map(({ name, width, height, passed }) => ({
      name,
      width,
      height,
      passed,
    })),
  ),
);
