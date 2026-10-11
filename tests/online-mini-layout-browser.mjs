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
  entryPoints: ["tests/online-mini-layout-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: compiled,
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
const { scenario, resultStates, tableStates } = await import(
  pathToFileURL(compiled)
);
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
function html(room, age, safeInsets = { left: 0, right: 0 }) {
  const data = {
    variant: "yonma",
    mode: "east",
    code: "",
    safeInsets,
    ...snapshot({ room }),
    selected: -1,
    busy: false,
  };
  data.settlement = presentation(data.game, data.seats, age);
  if (data.settlement)
    data.actions = data.actions.filter((c) => c.type !== "ack");
  data.settlementAck = data.game?.choices.find((c) => c.type === "ack") || null;
  const id = simulate.load({ template, data }),
    component = simulate.render(id);
  component.attach(document.body);
  // Built-in image src is not exposed. Paint known own/public faces only as a
  // visual aid; this does not verify native image binding. Geometry uses WXSS.
  const paint = (selector, tiles) =>
    component.dom.querySelectorAll(selector).forEach((image, i) => {
      const img = document.createElement("img");
      img.style = "width:100%;height:100%;display:block";
      img.src =
        "data:image/png;base64," +
        readFileSync("miniprogram" + tiles[i].src).toString("base64");
      image.append(img);
    });
  paint(".hand .tile wx-image", data.hand);
  for (const player of data.seats) {
    paint(`.river-${player.edge} .river-slot wx-image`, player.river);
    paint(
      `.exposed-${player.edge} .meld-tile:not(.back) wx-image`,
      player.melds.flat().filter((t) => !t.back),
    );
    paint(`.label-${player.edge} .north-slot wx-image`, player.north);
    for (const north of player.north) {
      const node = component.querySelector("#" + north.nodeId);
      assert.ok(
        node?.dom?.classList.contains("north-slot"),
        "North flight target exists in simulator template tree",
      );
      assert.ok(
        node.dom.closest(".label-" + player.edge),
        "North target remains with its owning seat",
      );
    }
  }
  const result = component.dom.outerHTML;
  component.detach();
  return result;
}
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const name of ["riichi", "nuki-double", "riichi-notch", "nuki-double-notch", "post-ankan", "post-ankan-notch"])
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
      const fixture = scenario(name.startsWith("post-ankan") ? "ankan" : name.replace("-notch", ""));
      if (name.startsWith("post-ankan")) {
        const game = fixture.view().game;
        const kan = game.choices.find((c) => c.type === "kan");
        assert.ok(kan);
        fixture.choose({ id: kan.id, decisionId: game.decisionId });
        assert.ok(fixture.view().game.choices.some((c) => c.type === "riichi"));
      }
      await page.setContent(
        "<style>html,body{margin:0;padding:0}wx-view{display:block}wx-text{display:inline}wx-image{display:inline-block}wx-button{display:block;box-sizing:border-box;text-align:center;border:none}" +
          normalized(width) +
          "</style>" +
          html(fixture.view(), undefined,
            name.endsWith("-notch") ? { left: 47, right: 47 } : undefined),
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
          actionButtons: [
            ...document.querySelectorAll(".actions wx-button"),
          ].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
            };
          }),
          ownMelds: [...document.querySelectorAll(".exposed-bottom .meld-tile")].map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }),
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
      assert.equal(boxes.tiles.length, name.startsWith("post-ankan") ? 11 : 14, name);
      if (name.endsWith("-notch")) {
        assert.ok(boxes.table.left >= 47, "table avoids left cutout");
        assert.ok(boxes.table.right <= width - 47, "table avoids right safe inset");
      }
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
      for (const meld of boxes.ownMelds) {
        assert.ok(!boxes.actionButtons.some((b) => overlap(meld, b)),
          "Own meld covered by action: " + JSON.stringify({ name, width, height, meld, buttons: boxes.actionButtons }));
        assert.ok(!boxes.tiles.some((t) => overlap(meld, t)),
          "Own meld covers hand: " + JSON.stringify({ name, width, height, meld, tiles: boxes.tiles }));
      }
      for (const label of boxes.labels) {
        assert.ok(
          !overlap(label, boxes.hand),
          "Player information must stay above own hand",
        );
        for (const rack of boxes.racks)
          assert.ok(
            !overlap(label, rack),
            JSON.stringify({ name, width, height, label, rack }),
          );
        assert.ok(
          boxes.actionButtons.every((button) => !overlap(label, button)),
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
  for (const { name: resultName, room } of resultStates())
    for (const cutout of (resultName.startsWith("result-ranking") ? [false, true] : [false]))
    for (const [width, height] of [
      [568, 260],
      [640, 280],
      [740, 310],
      [844, 340],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route("**/*", (r) => r.abort());
      const name = resultName + (cutout ? "-notch" : "");
      // Native scroll-y is adapted to browser overflow only for this geometry check.
      await page.setContent(
        "<style>html,body{margin:0;padding:0}wx-view{display:block}wx-text{display:inline}wx-image{display:inline-block}wx-button{display:block;box-sizing:border-box;text-align:center;border:none}.result-scroll{overflow-y:auto}.result-overlay *{animation:none!important;transition:none!important}" +
          normalized(width) +
          "</style>" +
          html(room, 10000, cutout ? { left: 47, right: 47 } : undefined),
      );
      const measure = () =>
        page.evaluate(() => {
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              height: r.height,
            };
          };
          const scroll = document.querySelector(".result-scroll");
          const rows = [
            ...scroll.querySelectorAll(".line,.balance,.draw-player"),
          ];
          return {
            panel: rect(document.querySelector(".result-panel")),
            scroll: rect(scroll),
            footer: rect(document.querySelector(".result-footer")),
            buttons: [
              ...document.querySelectorAll(".result-footer wx-button"),
            ].map(rect),
            contentHeight: scroll.scrollHeight,
            viewportHeight: scroll.clientHeight,
            scrollTop: scroll.scrollTop,
            firstYaku: scroll.querySelector(".result-yaku")
              ? rect(scroll.querySelector(".result-yaku")) : null,
            last: rect(rows.at(-1)),
            pageHeight: document.documentElement.scrollHeight,
            pageWidth: document.documentElement.scrollWidth,
          };
        });
      if (room.game?.ranking) {
        const rows = await page
          .locator(".result-scroll .line")
          .allTextContents();
        assert.equal(rows.length, room.game.ranking.length);
        room.game.ranking.forEach((rank, index) => {
          assert.ok(rows[index].includes(`${rank.rank}位`));
          assert.ok(
            rows[index].includes(
              room.members.find((m) => m.seat === rank.seat).displayName,
            ),
          );
          assert.ok(rows[index].includes(String(rank.score)));
        });
        const labels = (
          await page.locator(".ranking-footer wx-button").allTextContents()
        ).map((label) => label.trim());
        assert.deepEqual(
          labels,
          room.mySeat === 0 ? ["再来一场", "返回大厅"] : ["返回大厅"],
        );
        assert.equal(
          await page.locator(".result-footer:not(.ranking-footer)").count(),
          0,
        );
      }
      const before = await measure();
      if (cutout)
        assert.ok(
          before.panel.left >= 47 && before.panel.right <= width - 47,
        );
      assert.ok(
        before.panel.top >= 0 &&
          before.panel.bottom <= height + 1 &&
          before.panel.left >= 0 &&
          before.panel.right <= width + 1,
        JSON.stringify({ name, width, height, before }),
      );
      assert.ok(before.scroll.bottom <= before.footer.top + 1);
      if (height >= 340 && before.firstYaku)
        assert.ok(before.firstYaku.bottom <= before.scroll.bottom + 1,
          JSON.stringify({ name, width, height, before }));
      for (const b of before.buttons)
        assert.ok(b.height >= 44 && b.bottom <= height && b.top >= 0);
      assert.ok(
        before.pageHeight <= height + 1 && before.pageWidth <= width + 1,
      );
      await page.locator(".result-scroll").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const after = await measure();
      assert.deepEqual(
        after.footer,
        before.footer,
        "Footer must stay visible while result scrolls",
      );
      assert.ok(
        after.last.bottom <= after.scroll.bottom + 1,
        JSON.stringify({ name, width, height, after }),
      );
      if (before.contentHeight > before.viewportHeight + 1)
        assert.ok(
          after.scrollTop > 0,
          "Long result must be scrollable in adapter",
        );
      await page.screenshot({
        path: path.join(output, `${name}-${width}x${height}.png`),
      });
      results.push({ name, width, height, passed: true, before, after });
      await page.close();
    }
  for (const { name, room } of tableStates())
    for (const [width, height] of [
      [568, 260],
      [640, 280],
      [740, 310],
      [844, 340],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route("**/*", (r) => r.abort());
      await page.setContent(
        "<style>html,body{margin:0;padding:0}wx-view{display:block}wx-text{display:inline}wx-image{display:inline-block}wx-button{display:block;box-sizing:border-box;text-align:center;border:none}.table *{animation:none!important;transition:none!important}" +
          normalized(width) +
          "</style>" +
          html(room, 0),
      );
      const boxes = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return {
          table: box(document.querySelector(".table")),
          hand: box(document.querySelector(".hand")),
          center: box(document.querySelector(".table-center")),
          labels: [...document.querySelectorAll(".player-label")].map(box),
          rivers: [...document.querySelectorAll(".river-slot")].map(box),
          melds: [...document.querySelectorAll(".exposed .meld-tile")].map(box),
          north: [...document.querySelectorAll(".north-slot")].map((el) => ({
            ...box(el),
            ownerLabel: box(el.closest(".player-label")),
          })),
          overlay: !!document.querySelector(".result-overlay"),
        };
      });
      assert.equal(boxes.overlay, false);
      const expected = snapshot({ room }).seats;
      assert.equal(
        boxes.rivers.length,
        expected.reduce((count, p) => count + p.river.length, 0),
        "Keep every visible discard",
      );
      assert.equal(
        boxes.melds.length,
        expected.reduce((count, p) => count + p.melds.flat().length, 0),
        "Keep every exposed physical tile",
      );
      assert.equal(
        boxes.north.length,
        expected.reduce((count, p) => count + p.north.length, 0),
        "Keep every extracted North tile",
      );
      const overlap = (a, b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const issues = [];
      for (const [index, label] of boxes.labels.entries()) {
        if (overlap(label, boxes.hand))
          issues.push("player information covers hand");
        if (
          boxes.labels.slice(index + 1).some((other) => overlap(label, other))
        )
          issues.push("player information overlaps another seat");
      }
      for (const [type, cells] of [
        ["river", boxes.rivers],
        ["meld", boxes.melds],
        ["north", boxes.north],
      ])
        for (const cell of cells) {
          if (
            cell.left < boxes.table.left + 4 ||
            cell.right > boxes.table.right - 4 ||
            cell.top < boxes.table.top + 4 ||
            cell.bottom + 3 > boxes.table.bottom - 4
          )
            issues.push(type + " clipped");
          if (overlap(cell, boxes.hand)) issues.push(type + " covers hand");
          if (overlap(cell, boxes.center)) issues.push(type + " covers center");
          if (
            boxes.labels.some(
              (label) =>
                overlap(cell, label) &&
                !(
                  type === "north" &&
                  JSON.stringify(label) === JSON.stringify(cell.ownerLabel)
                ),
            )
          )
            issues.push(type + " covers player information");
          if (
            type === "north" &&
            (cell.left < cell.ownerLabel.left ||
              cell.right > cell.ownerLabel.right ||
              cell.top < cell.ownerLabel.top ||
              cell.bottom + 3 > cell.ownerLabel.bottom)
          )
            issues.push("north escapes owner panel");
        }
      await page.screenshot({
        path: path.join(output, `${name}-${width}x${height}.png`),
      });
      results.push({
        name,
        width,
        height,
        passed: issues.length === 0,
        issues: [...new Set(issues)],
        boxes,
      });
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
assert.ok(
  results.every((r) => r.passed),
  JSON.stringify(
    results
      .filter((r) => !r.passed)
      .map(({ name, width, height, issues }) => ({
        name,
        width,
        height,
        issues,
      })),
  ),
);
