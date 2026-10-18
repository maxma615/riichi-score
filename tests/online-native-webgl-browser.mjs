// Actual native r108/WebGL1 renderer validation in Chromium. This does not certify WeChat/Android performance.
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, ".local/browser/online-native-webgl");
mkdirSync(out, { recursive: true });
await Promise.all([
  build({
    entryPoints: [path.join(root, "tests/online-interaction-fixtures.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: path.join(out, "fixtures.mjs"),
    banner: {
      js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
    },
  }),
  build({
    entryPoints: [path.join(root, "tests/online-native-webgl-entry.js")],
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "esm",
    outfile: path.join(out, "client.js"),
  }),
]);
const { scenario } = await import(
  pathToFileURL(path.join(out, "fixtures.mjs"))
);
const fixtures = Object.fromEntries(
  ["pon", "nuki", "kakan"].map((name) => [name, scenario(name)]),
);
// Majiang.Shan shuffles a full legal physical wall. Seed fixture generation only
// (never rendering) so the naturally played long river covers all 37 faces.
const originalRandom = Math.random;
let fixtureSeed = 22;
Math.random = () => {
  fixtureSeed = (fixtureSeed * 1664525 + 1013904223) >>> 0;
  return fixtureSeed / 4294967296;
};
try {
  fixtures["draw-four"] = scenario("draw-four");
} finally {
  Math.random = originalRandom;
}
const rooms = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [name, fixture.view()]),
);
for (const name of ["pon", "nuki", "kakan"]) {
  const game = fixtures[name].view().game;
  const choice = game.choices.find(
    (c) => c.type === (name === "kakan" ? "kan" : name),
  );
  assert.ok(choice, name + " must be a real engine choice");
  rooms[name + "-after"] = fixtures[name].choose({
    id: choice.id,
    decisionId: game.decisionId,
  });
}
const assetRequests = [],
  errors = [],
  results = [];
const server = createServer((req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native WebGL1 browser verification</title><style>html,body{margin:0;background:#101920;overflow:hidden}canvas{display:block}</style><canvas></canvas><script type="module" src="/client.js"></script>',
      );
    } else if (u.pathname.startsWith("/assets/tiles/")) {
      const name = path.basename(u.pathname);
      assert.equal(u.pathname, "/assets/tiles/" + name);
      const bytes = readFileSync(
        path.join(root, "archive/native-online/assets/tiles", name),
      );
      assetRequests.push(name);
      res.setHeader("Content-Type", "image/png");
      res.end(bytes);
    } else if (u.pathname === "/client.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(readFileSync(path.join(out, "client.js")));
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (error) {
    errors.push(String(error));
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const report = {
  scope:
    "Chromium native-backend bridge; actual WebGL1, may use software GPU. No WeChat or Android-device certification.",
  results,
  errors,
};
function trapezoid(felt) {
  assert.equal(felt.length, 4);
  assert.ok(
    felt[2].x - felt[3].x > (felt[1].x - felt[0].x) * 1.05,
    "near edge must be wider under perspective",
  );
  assert.ok(
    Math.abs(felt[0].y - felt[1].y) < 0.1 &&
      Math.abs(felt[2].y - felt[3].y) < 0.1,
    "camera edges must be horizontal",
  );
  assert.ok(
    Math.abs(felt[0].x + felt[1].x - felt[2].x - felt[3].x) < 0.1,
    "camera must be centered and symmetric",
  );
}
try {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 844, height: 390 },
  ]) {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
      hasTouch: true,
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon"))
        pageErrors.push(message.text());
    });
    await page.goto(origin);
    await page.waitForFunction(() => !!window.nativeHarness);
    const call = (method, ...args) =>
      page.evaluate(
        ({ method, args }) => window.nativeHarness[method](...args),
        { method, args },
      );
    assert.equal(
      await call("boot", rooms.pon, viewport.width, viewport.height, 3),
      true,
    );
    const ready = async () => {
      await expect
        .poll(
          async () => {
            const i = await call("info");
            return (
              i.textures.length > 0 &&
              i.textures.every((t) => t.complete && t.width > 0)
            );
          },
          { timeout: 10000 },
        )
        .toBe(true);
      await page.waitForTimeout(100);
      assert.equal((await call("render")).ok, true);
    };
    await call("setRoom", rooms["pon-after"]);
    await ready();
    let info = await call("info");
    assert.equal(info.revision, "108");
    assert.equal(info.webgl1, true);
    assert.ok(
      info.contextRequests.every((type) =>
        ["webgl", "experimental-webgl"].includes(type),
      ),
      "native backend must not request WebGL2",
    );
    assert.ok(info.depthBits >= 16);
    assert.equal(info.depthTest, true);
    assert.ok(info.pieces.filter((p) => p.kind === "concealed").length >= 26);
    assert.ok(info.pieces.filter((p) => p.kind === "meld").length >= 3);
    assert.ok(
      info.projected.every(
        (p) =>
          p.hull.length >= 4 &&
          p.hull.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)),
      ),
    );
    trapezoid(info.felt);
    assert.equal(
      await call(
        "pointInPolygon",
        { x: viewport.width / 2, y: viewport.height / 2 },
        info.felt,
      ),
      true,
    );
    assert.equal(
      await call("pointInPolygon", { x: 1, y: 1 }, info.felt),
      false,
    );
    assert.equal(info.shadow.enabled, true);
    assert.equal(info.shadow.map, true);
    assert.deepEqual(info.shadow.size, [512, 512]);
    await page.screenshot({
      path: path.join(out, "initial-" + viewport.width + ".png"),
    });
    const shadow = await call("shadowPixels");
    assert.ok(
      shadow.changed > 50 && shadow.maxDelta > 20,
      "real framebuffer must visibly change when shadows are disabled: " +
        JSON.stringify(shadow),
    );
    assert.ok(
      shadow.colored > 200 && shadow.palette > 30,
      "framebuffer must contain lit tile geometry and textured colors",
    );
    await call("setRoom", rooms["nuki-after"]);
    await ready();
    const nuki = (await call("info")).pieces.find(
      (p) => p.kind === "nuki" && p.value === "z4",
    );
    assert.ok(
      nuki?.nodeId,
      "physical nuki must retain its native flight endpoint",
    );
    const beforeHide = await call("render");
    await call("hide", nuki.nodeId);
    const hidden = await call("render");
    assert.ok(
      hidden.stats.triangles < beforeHide.stats.triangles,
      "hiding a flight target must remove actual mesh triangles",
    );
    assert.ok(
      (await call("info")).projected.some(
        (p) => p.piece.nodeId === nuki.nodeId,
      ),
      "flight endpoint remains measurable while hidden",
    );
    await call("hide", null);
    assert.equal(
      (await call("render")).stats.triangles,
      beforeHide.stats.triangles,
    );
    await call("setRoom", rooms["kakan-after"]);
    await ready();
    const melds = (await call("info")).pieces.filter((p) => p.kind === "meld");
    assert.ok(
      melds.some((p) => p.layer === "added") &&
        melds.some((p) => p.layer === "called"),
    );
    await call("setRoom", rooms["draw-four"]);
    await ready();
    const stress = await call("info"),
      draw = await call("render");
    assert.ok(
      stress.pieces.length >= 95,
      "stress must use a real long-river round",
    );
    assert.equal(
      new Set(stress.pieces.filter((p) => p.value).map((p) => p.value)).size,
      37,
      "stress must exercise every physical face material, including red fives",
    );
    assert.ok(
      draw.stats.drawCalls <= 50,
      "native draw-call budget exceeded: " + JSON.stringify(draw),
    );
    // Scene call budget is <=50; the separate depth shadow pass adds calls.
    assert.ok(
      draw.gpuDraws > 0 && draw.gpuDraws <= 60,
      "all actual GPU draws including shadow pass must fit the <=60 budget: " +
        JSON.stringify(draw),
    );
    const performance = await call("performance", rooms["draw-four"]);
    console.log(
      "Native performance " + viewport.width,
      JSON.stringify(performance),
    );
    assert.equal(
      performance.hide.allocations,
      0,
      "flight visibility cannot allocate full table geometry",
    );
    assert.equal(
      performance.hide.projections,
      0,
      "flight visibility cannot reproject stable pieces",
    );
    assert.equal(
      performance.hide.stable,
      true,
      "flight visibility keeps GPU buffers",
    );
    assert.equal(
      performance.change.allocations,
      0,
      "moving one piece updates existing buffers",
    );
    assert.equal(
      performance.outlineShadowDraws,
      0,
      "outline-only changes reuse the static shadow map",
    );
    assert.equal(
      performance.visibility.hiddenAfterChange,
      performance.visibility.hiddenTriangles,
    );
    assert.equal(
      performance.visibility.restoredTriangles,
      performance.visibility.total,
    );
    assert.equal(
      performance.visibility.afterRemoval,
      performance.visibility.clearedAfterRemoval,
    );
    const integrity = await call("bufferIntegrity");
    assert.equal(integrity.valid, true);
    assert.ok(
      integrity.error < 0.00001 && integrity.vertices > 10000,
      JSON.stringify(integrity),
    );
    await call("setRoom", rooms["draw-four"]);
    await ready();
    const frame = (await call("info")).frames;
    assert.equal(
      await call("setRoom", rooms["draw-four"]),
      false,
      "unchanged state must not rebuild",
    );
    await page.waitForTimeout(350);
    assert.equal(
      (await call("info")).frames,
      frame,
      "idle must not continuously render",
    );
    await call("suspend");
    await call("resize", viewport.width - 20, viewport.height - 10, 3);
    assert.equal((await call("render")).ok, false);
    await page.waitForTimeout(100);
    assert.equal(
      (await call("info")).frames,
      frame,
      "suspended resize must not render",
    );
    await call("resume");
    await expect
      .poll(async () => (await call("info")).frames)
      .toBeGreaterThan(frame);
    await call("resize", viewport.width, viewport.height, 3);
    await ready();
    info = await call("info");
    trapezoid(info.felt);
    const dpr = Math.min(
      1.25,
      Math.sqrt(900000 / (viewport.width * viewport.height)),
    );
    assert.equal(info.stats.width, Math.floor(viewport.width * dpr));
    assert.equal(info.stats.height, Math.floor(viewport.height * dpr));
    await page.screenshot({
      path: path.join(out, "native-webgl-" + viewport.width + ".png"),
    });
    await call("lose");
    await expect.poll(async () => (await call("info")).failed).toBe(true);
    const lost = await call("info");
    assert.ok(lost.failureCount >= 1);
    assert.equal((await call("render")).ok, false);
    // Backgrounding while the context is lost must survive its restoration.
    await call("suspend");
    await call("resize", viewport.width - 10, viewport.height, 3);
    assert.equal((await call("info")).failed, true);
    await call("restore");
    await expect
      .poll(async () => (await call("info")).failed, { timeout: 10000 })
      .toBe(false);
    await page.waitForTimeout(100);
    const restoredHidden = await call("info");
    assert.equal(restoredHidden.active, false);
    assert.equal(restoredHidden.frames, lost.frames);
    await call("resume");
    await ready();
    assert.ok((await call("info")).frames > lost.frames);
    const disposed = await call("dispose");
    assert.equal(disposed.disposed, true);
    assert.equal(disposed.active, false);
    assert.equal(disposed.pending, 0);
    assert.equal(disposed.pieces, 0);
    assert.equal(disposed.projected, 0);
    assert.equal(disposed.renderAfter, false);
    assert.equal(disposed.frames, disposed.before);
    assert.equal(disposed.disposedResources, disposed.resources);
    const presentation = await call(
      "controllerPerformance",
      rooms["draw-four"],
      viewport.width,
      viewport.height,
    );
    assert.equal(presentation.initial, true);
    assert.equal(presentation.hidden, false);
    assert.equal(presentation.resumed, true);
    assert.equal(
      presentation.afterUi.frames,
      presentation.before.frames,
      "UI-only sync must not redraw GPU",
    );
    assert.equal(
      presentation.afterUi.copies,
      presentation.before.copies,
      "UI-only sync must not copy Canvas2D",
    );
    assert.equal(
      presentation.afterUi.selectorQueries,
      presentation.before.selectorQueries,
    );
    assert.equal(
      presentation.afterUi.layoutBuilds,
      presentation.before.layoutBuilds,
    );
    assert.equal(
      presentation.during.frames,
      presentation.before.frames,
      "opaque settlement must suspend GPU work",
    );
    assert.equal(presentation.during.copies, presentation.before.copies);
    assert.equal(presentation.during.active, false);
    assert.equal(
      presentation.afterResume.selectorQueries,
      presentation.before.selectorQueries + 1,
    );
    assert.equal(
      presentation.afterResume.copies,
      presentation.before.copies + 1,
    );
    assert.equal(
      presentation.clears,
      0,
      "opaque full-canvas presentation needs no pre-clear",
    );
    assert.ok(
      presentation.lit > 200,
      "Canvas2D bridge must contain actual rendered tiles",
    );
    assert.ok(
      Number.isFinite(presentation.presentMs) && presentation.presentations > 0,
    );
    assert.equal(
      presentation.adaptive.projectedStable,
      true,
      "framebuffer DPR changes preserve CSS camera projections",
    );
    if (presentation.adaptive.reason) {
      assert.equal(presentation.adaptive.reason, "slow-android-canvas-copy");
      assert.equal(presentation.adaptive.effectiveDpr, 1);
      assert.equal(presentation.adaptive.requestedDpr, 1);
    } else
      assert.equal(
        presentation.adaptive.effectiveDpr,
        presentation.adaptive.defaultDpr,
      );
    assert.deepEqual(pageErrors, [], "unexpected browser errors");
    results.push({
      viewport,
      revision: info.revision,
      webgl1: info.webgl1,
      renderer: info.renderer,
      depthBits: info.depthBits,
      stressPieces: stress.pieces.length,
      textures: stress.textures.length,
      drawCalls: draw.stats.drawCalls,
      actualGpuDraws: draw.gpuDraws,
      shadow,
      performance,
      presentation,
      lifecycle: true,
      idle: true,
      screenshot: path.join(out, "native-webgl-" + viewport.width + ".png"),
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  throw error;
} finally {
  report.assetRequests = [...new Set(assetRequests)];
  writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(report, null, 2));
