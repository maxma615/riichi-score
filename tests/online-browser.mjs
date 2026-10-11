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
      results.push({ tag, images: images.length, fontLoaded: true, errors });
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
