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
        await expect(
          page.getByRole("heading", { name: "符翻速查", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "3翻", exact: true }).click();
        await expect(page.locator(".result")).toContainText("3,900");
        await page.getByRole("button", { name: "自摸", exact: true }).click();
        await expect(page.locator(".result")).toContainText("庄家 2,000 点");
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
        await page.getByRole("button", { name: "记一局", exact: true }).click();
        await page.locator("#tsumo-seat").selectOption("1");
        await expect(page.locator("#preview")).toContainText("测试南家 +4000");
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
