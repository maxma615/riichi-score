import { chromium, webkit, expect } from "@playwright/test";
import { createApp } from "../src/server.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import net from "node:net";
mkdirSync(".local/browser", { recursive: true });
const results = [];
for (const engine of [chromium, webkit])
  for (const basePath of ["", "/riichi"]) {
    const probe = net.createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const origin = `http://127.0.0.1:${port}`,
      dataDir = mkdtempSync(".local/browser/online-synthetic-");
    const { server, online } = createApp({ origin, basePath, dataDir });
    await new Promise((r) => server.listen(port, "127.0.0.1", r));
    const browser = await engine.launch({ headless: true });
    const errors = [],
      failed = [];
    const tag = engine.name() + (basePath ? "prefix" : "root");
    try {
      const context = await browser.newContext({
        viewport: { width: 844, height: 390 },
        hasTouch: true,
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400 && !r.url().endsWith("/api/profile"))
          failed.push(r.url() + ":" + r.status());
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin + basePath + "/online/");
      await page.getByLabel("你的昵称").fill("独立牌桌测试");
      await page.getByRole("button", { name: "进入牌桌", exact: true }).click();
      await page.getByRole("button", { name: "三人", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "三人", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", { name: "三人", exact: true }),
      ).toHaveCSS("border-top-color", "rgb(153, 62, 49)");
      await page.screenshot({
        path: `.local/browser/lobby-${tag}.png`,
        fullPage: true,
      });
      const field = await page.locator("#mahjong-join-code").boundingBox();
      assert.ok(field.y + field.height <= 844);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.setViewportSize({ width: 844, height: 390 });
      await page
        .getByRole("button", { name: "创建三人东风牌桌", exact: true })
        .click();
      await page
        .getByRole("button", { name: "电脑补齐空位", exact: true })
        .click();
      await page.getByRole("button", { name: "准备好了", exact: true }).click();
      await page.getByRole("button", { name: "开始对局", exact: true }).click();
      await expect(page.locator(".mahjong-table")).toBeVisible();
      await expect(page.locator(".mahjong-link-state")).toHaveClass(
        /is-connected/,
      );
      await expect
        .poll(async () => page.locator(".mahjong-hand button").count())
        .toBeGreaterThan(0);
      await expect
        .poll(async () =>
          page.locator(".mahjong-game").getAttribute("data-round-opening"),
        )
        .toBe(null);
      await page.screenshot({
        path: `.local/browser/online-${tag}.png`,
        fullPage: true,
      });
      const images = await page
        .locator(".mahjong-table img")
        .evaluateAll((images) =>
          images.map((i) => ({
            src: i.src,
            ok: i.complete && i.naturalWidth > 0,
          })),
        );
      assert.ok(images.length > 10);
      assert.ok(
        images.every((i) => i.ok),
        JSON.stringify(images.filter((i) => !i.ok)),
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(failed, []);
      const fonts = await page.evaluate(() =>
        document.fonts.load("16px MahjongBrush").then((r) => r.length),
      );
      assert.ok(fonts > 0);
      const readRoom = async () =>
        (
          await (
            await page.request.get(origin + basePath + "/api/online")
          ).json()
        ).room;
      const playable = page
        .locator(
          '.mahjong-hand button[data-choice-type="discard"]:not(:disabled)',
        )
        .first();
      const waitForDiscard = async () => {
        await expect
          .poll(
            async () => {
              const pass = page.locator(
                'button[data-choice-type="pass"]:not(:disabled)',
              );
              if (await pass.count()) await pass.first().click();
              return playable.count();
            },
            { timeout: 30000 },
          )
          .toBeGreaterThan(0);
      };
      await waitForDiscard();
      const beforeDrag = await readRoom();
      const selectedChoice = await playable.getAttribute("data-choice-id");
      const value = beforeDrag.game.choices.find(
        (c) => c.id === selectedChoice,
      ).value;
      const ownRiverBefore = beforeDrag.game.players.find(
        (p) => p.seat === beforeDrag.mySeat,
      ).discards.length;
      const box = await playable.boundingBox();
      const target = await page.evaluate(() => {
        const surface = document.querySelector(".mahjong-table__surface");
        const table = surface.closest(".mahjong-table");
        const game = table.closest(".mahjong-game");
        const webgl = game.dataset.tableRenderer === "webgl";
        const tableBounds = table.getBoundingClientRect();
        const felt = webgl
          ? getComputedStyle(table).getPropertyValue("--table-felt-clip")
            .trim().replace(/^polygon\(/, "").replace(/\)$/, "")
            .split(",").map(pair => pair.trim().split(/\s+/).map(parseFloat))
          : [];
        const onFelt = (x, y) => {
          if (!webgl) return true;
          if (felt.length < 3 || felt.some(p => p.length !== 2 || !p.every(Number.isFinite))) return false;
          const point = game.dataset.tableRotated === "true"
            ? [y - tableBounds.top, tableBounds.right - x]
            : [x - tableBounds.left, y - tableBounds.top];
          let inside = false;
          for (let i = 0, j = felt.length - 1; i < felt.length; j = i++) {
            const a = felt[j], b = felt[i];
            if ((a[1] > point[1]) !== (b[1] > point[1])
              && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
          }
          return inside;
        };
        const rack = document
          .querySelector(".mahjong-hand")
          .getBoundingClientRect();
        const bounds = surface.getBoundingClientRect();
        for (let y = rack.top - 35; y > bounds.top + 20; y -= 20)
          for (let x = bounds.left + 50; x < bounds.right - 50; x += 30) {
            // Transparent CSS proxies can hit outside their clip in WebKit.
            // Keep candidates inside the real felt, including rounding tolerance.
            if (!onFelt(x - 2, y - 2) || !onFelt(x + 2, y - 2)
              || !onFelt(x + 2, y + 2) || !onFelt(x - 2, y + 2)) continue;
            const el = document.elementFromPoint(x, y);
            if (
              el &&
              surface.contains(el) &&
              !el.closest(
                'button,a,input,select,textarea,[role="button"],.mahjong-opponent-rack,.mahjong-player__melds,.mahjong-hand-public-melds,.mahjong-nuki-tray',
              )
            )
              return { x, y };
          }
        return null;
      });
      assert.ok(target, "Projected felt needs a reachable discard point");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 8 });
      await expect(page.locator(".mahjong-table")).toHaveClass(
        /is-discard-target/,
      );
      await page.mouse.up();
      await expect
        .poll(async () => {
          const room = await readRoom();
          return room.game.players.find((p) => p.seat === room.mySeat).discards
            .length;
        })
        .toBe(ownRiverBefore + 1);
      let afterDrag = await readRoom();
      const actual = afterDrag.game.players
        .find((p) => p.seat === afterDrag.mySeat)
        .discards.at(-1);
      assert.equal(actual.slice(0, 2), value.slice(0, 2));
      await expect
        .poll(async () =>
          page
            .getByTestId(`river-${beforeDrag.mySeat}`)
            .locator(".mahjong-river__tile")
            .count(),
        )
        .toBe(ownRiverBefore + 1);
      await waitForDiscard();
      const beforeClick = await readRoom();
      const countBeforeClick = beforeClick.game.players.find(
        (p) => p.seat === beforeClick.mySeat,
      ).discards.length;
      // Keyboard activation follows the same select / confirm behavior without mouse hover.
      await playable.focus();
      await page.keyboard.press("Enter");
      await expect(playable).toHaveAttribute("aria-pressed", "true");
      assert.equal(
        (await readRoom()).game.players.find(
          (p) => p.seat === beforeClick.mySeat,
        ).discards.length,
        countBeforeClick,
      );
      await page.keyboard.press("Enter");
      await expect
        .poll(
          async () =>
            (await readRoom()).game.players.find(
              (p) => p.seat === beforeClick.mySeat,
            ).discards.length,
        )
        .toBe(countBeforeClick + 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(failed, []);
      results.push({
        tag,
        images: images.length,
        fontLoaded: true,
        dragDiscard: true,
        selectConfirmDiscard: true,
        errors,
      });
    } finally {
      await browser.close();
      await online.close();
      await new Promise((r) => server.close(r));
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
writeFileSync(
  ".local/browser/online-results.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results));
