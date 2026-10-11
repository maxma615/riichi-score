import { chromium, webkit, expect } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import net from "node:net";
import path from "node:path";

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
const testRoot = path.resolve(".local/test-data");
mkdirSync(testRoot, { recursive: true });
const out = path.resolve(".local/browser");
mkdirSync(out, { recursive: true });
const results = [];
for (const engine of [chromium, webkit])
  for (const mobile of [false, true])
    for (const basePath of ["", "/riichi"]) {
      const probe = net.createServer();
      await new Promise((r) => probe.listen(0, "127.0.0.1", r));
      const port = probe.address().port;
      await new Promise((r) => probe.close(r));
      const origin = `http://127.0.0.1:${port}`,
        dataDir = mkdtempSync(path.join(testRoot, "riichi-browser-synthetic-")),
        { server } = createApp({ dataDir, origin, basePath });
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
      const entry = origin + basePath + "/";
      const browser = await engine.launch({ headless: true });
      const tag = `${engine.name()}-${mobile ? "mobile" : "desktop"}-${basePath ? "prefix" : "root"}`;
      try {
        const host = await browser.newContext({
            viewport: mobile
              ? { width: 390, height: 844 }
              : { width: 1440, height: 1000 },
            hasTouch: mobile,
          }),
          page = await host.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(entry);
        await expect(page.locator("#room")).toBeVisible();
        await expect(page.locator("#quick")).not.toBeVisible();
        assert.equal(
          await page.locator(".bottom-nav button").first().getAttribute("id"),
          "room-tab",
        );
        await page
          .getByRole("button", { name: "符番速查", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "符番速查", exact: true }),
        ).toBeVisible();
        const bottomNav = page.getByRole("navigation", { name: "功能" });
        await expect(bottomNav).toBeVisible();
        const bounds = await bottomNav.boundingBox();
        assert.ok(bounds.y + bounds.height <= page.viewportSize().height + 1);
        assert.ok(bounds.y >= page.viewportSize().height - 120);
        await page.screenshot({
          path: path.join(out, `${tag}-bottom-nav.png`),
        });
        await expect(page.locator("#open-fu")).toHaveCount(0);
        await page.locator("#open-yaku").click();
        await page.locator("#yaku-query").fill("三色");
        await expect(page.locator(".yaku-item")).toHaveCount(2);
        await expect(
          page.locator(".yaku-item").filter({ hasText: "三色同顺" }),
        ).toContainText("副露 1番");
        await page.locator("#yaku-query").fill("");
        await page.locator('[data-group="役满"]').click();
        await expect(page.locator("#yaku-list")).toContainText("国士无双");
        await page.locator("#back-points").click();
        await expect(page.locator(".quick-context")).toBeVisible();
        const contextBounds = await page
          .locator(".quick-context")
          .boundingBox();
        const seatBounds = await page.locator(".lookup-switches").boundingBox();
        assert.ok(contextBounds.y < seatBounds.y);
        await page
          .getByRole("button", { name: "增加一本场", exact: true })
          .click();
        await expect(page.locator("#quick .result")).toContainText("1,300");
        await page
          .getByRole("button", { name: "减少一本场", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "减少一本场", exact: true }),
        ).toBeDisabled();
        await expect(page.locator("#quick-honba")).toHaveCount(0);
        await expect(
          page.locator('.point-matrix [data-fu="20"][data-han="1"]'),
        ).toBeDisabled();
        await page
          .locator('.point-matrix [data-fu="40"][data-han="3"]')
          .click();
        await expect(page.locator("#quick .result")).toContainText("3番40符");
        await expect(page.locator("#quick .result")).toContainText("5,200");
        await expect(
          page.locator('.point-matrix [data-fu="40"][data-han="3"]'),
        ).toHaveAttribute("aria-pressed", "true");
        const matrixBounds = await page.locator(".point-matrix").boundingBox();
        assert.ok(matrixBounds.y < (mobile ? 540 : 600));
        await page
          .locator('.limit-matrix [data-han="5"][data-yakuman="0"]')
          .click();
        await expect(page.locator("#quick .result")).toContainText(
          "5番 · 满贯",
        );
        await expect(page.locator("#quick .result")).toContainText("8,000");
        await page.getByRole("button", { name: "庄家", exact: true }).click();
        await expect(page.locator("#quick .result")).toContainText("12,000");
        await page.getByRole("button", { name: "闲家", exact: true }).click();
        await page
          .locator('.point-matrix [data-fu="30"][data-han="1"]')
          .click();
        await page.getByRole("button", { name: "算符", exact: true }).click();
        await expect(page.locator(".fu-result")).toContainText("30符");
        const assertFuVisible = async () => {
          const result = await page.locator(".fu-result").boundingBox();
          const nav = await bottomNav.boundingBox();
          assert.ok(
            result.y >= 0 && result.y + result.height <= nav.y,
            JSON.stringify({ tag, result, nav }),
          );
          const action = await page.locator("#use-fu").boundingBox();
          assert.ok(action.height >= 44);
        };
        await assertFuVisible();
        await expect(page.locator("#fu")).toContainText("门前清荣和");
        await expect(
          page.getByRole("heading", { name: "听牌形", exact: true }),
        ).toBeVisible();
        await expect(page.locator("#fu")).not.toContainText("等待");
        await page
          .getByRole("button", { name: "自摸 +2符", exact: true })
          .click();
        await page
          .getByRole("button", { name: "添加刻子 / 杠子", exact: true })
          .click();
        await page.locator('[data-meld="0"]').selectOption("closedKan");
        await page.locator('[data-terminal="0"]').check();
        await expect(page.locator(".fu-result")).toContainText("60符");
        await page.locator("#add-meld").scrollIntoViewIfNeeded();
        await assertFuVisible();
        await page.screenshot({
          path: path.join(out, `${tag}-compact-fu.png`),
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.getByRole("button", { name: "门前清", exact: true }).click();
        await page
          .getByRole("button", { name: "平和自摸 20符", exact: true })
          .click();
        await expect(page.locator(".fu-result")).toContainText("20符");
        await page
          .getByRole("button", { name: "用这个符数查点", exact: true })
          .click();
        await page
          .locator('.point-matrix [data-fu="30"][data-han="3"]')
          .click();
        await page.getByRole("button", { name: "荣和", exact: true }).click();
        await expect(
          page.getByRole("heading", {
            name: "5番及以上 · 满贯与役满",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("row").filter({ hasText: "13番及以上" }),
        ).toContainText("32,000");
        await expect(
          page.getByRole("row").filter({ hasText: "5番" }),
        ).toContainText("8,000");
        await page
          .locator('.point-matrix [data-fu="30"][data-han="3"]')
          .click();
        await expect(page.locator("#quick .result")).toContainText("3,900");
        await page.getByRole("button", { name: "自摸", exact: true }).click();
        await expect(page.locator("#quick .result")).toContainText(
          "庄家付 2,000 点",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(out, `${tag}-quick.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "线下牌桌", exact: true })
          .click();
        await page.locator("#name").fill("测试桌主");
        await page
          .getByRole("button", { name: "创建牌桌", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: /东1局/ }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "扫码入桌", exact: true })
          .click();
        await page.locator(".qr").waitFor();
        await expect(page.locator(".qr")).toBeVisible();
        await page.locator(".qr").evaluate((img) => img.decode());
        const png = PNG.sync.read(await page.locator(".qr").screenshot()),
          decoded = jsQR(
            new Uint8ClampedArray(png.data),
            png.width,
            png.height,
          );
        assert.ok(decoded);
        assert.match(
          decoded.data,
          new RegExp(
            `^${(origin + basePath).replaceAll(".", "\\.")}/\\?join=[a-f0-9]{32}$`,
          ),
        );
        await page.getByRole("button", { name: "关闭", exact: true }).click();
        const guest = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
          }),
          other = await guest.newPage();
        await other.goto(decoded.data);
        await other.locator("#name").fill("测试南家");
        await other
          .getByRole("button", { name: "加入牌桌", exact: true })
          .click();
        await expect(
          other.getByText("由桌主记分", { exact: false }),
        ).toBeVisible();
        assert.equal(
          await other
            .getByRole("button", { name: "记一局", exact: true })
            .count(),
          0,
        );
        await page.reload();
        await expect(
          page.getByText("测试南家", { exact: false }).first(),
        ).toBeVisible();
        for (const [index, name] of [
          [0, "测试西家"],
          [0, "测试北家"],
        ]) {
          await page
            .getByRole("button", { name: "填写玩家", exact: true })
            .nth(index)
            .click();
          await page.locator("#player-name").fill(name);
          await page.getByRole("button", { name: "保存", exact: true }).click();
          await expect(page.locator("#modal")).not.toBeVisible();
        }
        await expect(page.locator(".round-status")).toContainText("首次坐庄");
        await page.getByRole("button", { name: "记一局", exact: true }).click();
        await page.locator("#kind").selectOption("ron");
        await expect(page.locator(".winner:visible")).toHaveCount(0);
        await expect(page.locator('[data-winner-seat="0"]')).toBeDisabled();
        await page.locator('[data-winner-seat="1"]').click();
        await page
          .locator('.winner[data-seat="1"] [data-han-step="1"]')
          .click();
        await page.locator('[data-winner-seat="2"]').click();
        await expect(page.locator(".winner:visible")).toHaveCount(2);
        await expect(page.locator('[data-winner-seat="3"]')).toBeDisabled();
        await expect(page.locator("#preview")).toContainText("本局收支");
        await page.screenshot({
          path: path.join(out, `${tag}-winner-picker.png`),
        });
        await page.locator('[data-winner-seat="1"]').click();
        await expect(page.locator('.winner[data-seat="1"]')).not.toBeVisible();
        await page.locator('[data-winner-seat="1"]').click();
        await expect(page.locator('.winner[data-seat="1"] .han')).toContainText(
          "4 番",
        );
        await page.locator("#loser").selectOption("1");
        await expect(page.locator('.winner[data-seat="1"]')).not.toBeVisible();
        await expect(page.locator(".winner:visible")).toHaveCount(1);
        await page.locator("#kind").selectOption("tsumo");
        await expect(page.locator(".record-status")).toContainText("0 本场");
        await expect(
          page.locator("#record-fields input[type=number]"),
        ).toHaveCount(0);
        await expect(page.locator("#record-fields select.fu")).toHaveCount(0);
        await page
          .getByRole("button", { name: "增加一番", exact: true })
          .click();
        await expect(page.locator(".winner .han")).toContainText("4 番");
        await page.locator('[data-fu-choice="40"]').click();
        await expect(page.locator('[data-fu-choice="40"]')).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(
          page
            .locator("#preview .payment-table tr")
            .filter({ hasText: "测试南家" }),
        ).toContainText("4,000");
        await page
          .getByRole("button", { name: "减少一番", exact: true })
          .click();
        await page.locator('[data-fu-choice="30"]').click();
        await expect(page.locator("#preview .payment-table")).toContainText(
          "基础点数",
        );
        await expect(page.locator("#preview .payment-table")).toContainText(
          "本场加点",
        );
        await expect(page.locator("#preview .next-round")).toContainText(
          "1 本场",
        );
        await page
          .getByRole("button", { name: "确认记分", exact: true })
          .click();
        await expect(page.locator(".round-status")).toContainText("连庄 1 次");
        await expect(
          page.getByRole("heading", { name: /东1局/ }),
        ).toBeVisible();
        await page.getByRole("button", { name: "记一局", exact: true }).click();
        await expect(
          page
            .locator("#preview .payment-table tr")
            .filter({ hasText: "测试南家" }),
        ).toContainText("2,100");
        await expect(page.locator("#preview .next-round")).toContainText(
          "2 本场",
        );
        await page.locator("#preview .payment-table").scrollIntoViewIfNeeded();
        await expect(page.locator("#preview .payment-table")).toBeVisible();
        await page.screenshot({
          path: path.join(out, `${tag}-honba-payment.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "确认记分", exact: true })
          .click();
        await expect(page.locator(".round-status")).toContainText("连庄 2 次");
        for (let i = 0; i < 2; i++) {
          await page
            .getByRole("button", { name: "撤回最近记录", exact: true })
            .click();
          await page.getByRole("button", { name: "确认", exact: true }).click();
          await expect(page.locator("#modal")).not.toBeVisible();
        }
        await expect(page.locator(".round-status")).toContainText("首次坐庄");
        await page.getByRole("button", { name: "记一局", exact: true }).click();
        await page.locator("#tsumo-seat").selectOption("1");
        await expect(
          page.locator("#preview .line").filter({ hasText: "测试南家" }),
        ).toContainText("+4,000");
        await page
          .getByRole("button", { name: "确认记分", exact: true })
          .click();
        await expect(page.locator("#modal")).not.toBeVisible();
        await expect(
          page.getByRole("heading", { name: /东2局/ }),
        ).toBeVisible();
        await expect(page.locator(".seat").nth(1)).toContainText("29,000");
        await other.reload();
        await expect(other.locator(".seat").nth(1)).toContainText("29,000");
        await page.getByRole("button", { name: "记一局", exact: true }).click();
        const secondTab = await host.newPage();
        await secondTab.goto(entry);
        await secondTab
          .getByRole("button", { name: "记一局", exact: true })
          .click();
        await secondTab.locator("#kind").selectOption("abort");
        await secondTab
          .getByRole("button", { name: "确认记分", exact: true })
          .click();
        await expect(secondTab.locator("#modal")).not.toBeVisible();
        await page
          .getByRole("button", { name: "确认记分", exact: true })
          .click();
        await expect(page.locator("#modal-error")).toContainText("牌桌已更新");
        await expect(
          page.getByRole("button", { name: "确认记分", exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("button", { name: "关闭并刷新牌桌", exact: true })
          .click();
        await expect(page.locator("#modal")).not.toBeVisible();
        await secondTab.close();
        await page
          .getByRole("button", { name: "撤回最近记录", exact: true })
          .click();
        await page.getByRole("button", { name: "确认", exact: true }).click();
        await expect(page.locator("#modal")).not.toBeVisible();

        await page
          .getByRole("button", { name: "撤回最近记录", exact: true })
          .click();
        await page.getByRole("button", { name: "确认", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: /东1局/ }),
        ).toBeVisible();
        await expect(page.locator(".seat").nth(1)).toContainText("25,000");
        await page.getByRole("button", { name: "记一局", exact: true }).click();
        await page.locator("#kind").selectOption("draw");
        await page.locator('[name=tenpai][value="0"]').check();
        await page.locator('[name=riichi][value="1"]').check();
        await page
          .getByRole("button", { name: "确认记分", exact: true })
          .click();
        await expect(page.locator("#modal")).not.toBeVisible();
        await expect(page.getByText(/供托 1 根/)).toBeVisible();
        await expect(page.locator(".seat").nth(0)).toContainText("28,000");
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(out, `${tag}-table.png`),
          fullPage: true,
        });
        await page.getByRole("button", { name: "我的", exact: true }).click();
        await expect(page.locator("#me")).toContainText("净点数");
        await expect(page.locator("#me .seat").first()).toContainText("3,000");
        await expect(page.locator("#me")).toContainText("同桌收支");
        await expect(page.locator("#me")).toContainText("带福之人");
        await expect(page.locator("#me")).toContainText("带负之人");
        await expect(page.locator(".monthly-summary")).toContainText("放铳率");
        await page.screenshot({
          path: path.join(out, `${tag}-stats.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "线下牌桌", exact: true })
          .click();
        await page
          .getByRole("button", { name: "结束牌局", exact: true })
          .click();
        await page.getByRole("button", { name: "确认", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: /牌局已结束/ }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("heading", { name: /牌局已结束/ }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "另开一桌", exact: true })
          .click();
        await page.locator("#confirm-new").click();
        await expect(
          page.getByRole("heading", { name: "最近的牌桌", exact: true }),
        ).toBeVisible();
        assert.deepEqual(errors, []);
        results.push({
          tag,
          quick: true,
          qrDecoded: true,
          independentGuest: true,
          record: true,
          undo: true,
          draw: true,
          reload: true,
          history: true,
          staleFormConflict: true,
        });
        await host.close();
        await guest.close();
      } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
        rmSync(dataDir, { recursive: true, force: true });
      }
    }
writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
