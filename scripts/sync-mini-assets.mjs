// Export the existing licensed artwork; this does not redraw tile identities.
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (x) => createHash("sha256").update(x).digest("hex");
const source = path.join(root, "public/online/assets");
const output = path.join(root, "miniprogram/assets");
for (const dir of ["tiles", "calligraphy", "licenses"])
  mkdirSync(path.join(output, dir), { recursive: true });
const files = [];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 480, height: 240 },
    deviceScaleFactor: 1,
  });
  await page.route("**/*", (route) => route.abort());
  for (const name of readdirSync(path.join(source, "tiles/regular"))
    .filter((n) => n.endsWith(".svg"))
    .sort()) {
    const svg = readFileSync(path.join(source, "tiles/regular", name));
    await page.setContent(
      "<style>html,body{margin:0;background:transparent}img{display:block;width:150px;height:200px}</style><img>",
    );
    await page.locator("img").evaluate((img, base64) => {
      img.src = "data:image/svg+xml;base64," + base64;
      return img.decode();
    }, svg.toString("base64"));
    const png = await page.locator("img").screenshot({ omitBackground: true });
    const target = "tiles/" + name.replace(".svg", ".png");
    writeFileSync(path.join(output, target), png);
    files.push({
      target,
      source: "public/online/assets/tiles/regular/" + name,
      sourceSha256: hash(svg),
      sha256: hash(png),
      width: 150,
      height: 200,
      bytes: png.length,
    });
  }
  const font = readFileSync(path.join(source, "fonts/mahjong-brush.woff2"));
  await page.setContent(
    '<style>html,body{margin:0;background:transparent}.glyph{box-sizing:border-box;width:480px;height:240px;display:flex;align-items:center;justify-content:center;font:140px Brush;letter-spacing:-.035em;color:#fff0c9;-webkit-text-stroke:3px #322114;paint-order:stroke fill;text-shadow:2px 3px 0 #091723,0 0 12px #efb86b80}</style><div class="glyph"></div>',
  );
  await page.evaluate(async (base64) => {
    const face = new FontFace(
      "Brush",
      "url(data:font/woff2;base64," + base64 + ")",
    );
    await face.load();
    document.fonts.add(face);
  }, font.toString("base64"));
  for (const [name, text] of Object.entries({
    Riichi: "立直",
    Tsumo: "自摸",
    Ron: "荣和",
    Chi: "吃",
    Pon: "碰",
    Kan: "杠",
    Nuki: "拔北",
  })) {
    await page.locator(".glyph").evaluate((el, text) => {
      el.textContent = text;
      return document.fonts.ready;
    }, text);
    const png = await page
      .locator(".glyph")
      .screenshot({ omitBackground: true });
    const target = "calligraphy/" + name + ".png";
    writeFileSync(path.join(output, target), png);
    files.push({
      target,
      source: "public/online/assets/fonts/mahjong-brush.woff2",
      text,
      sourceSha256: hash(font),
      sha256: hash(png),
      width: 480,
      height: 240,
      bytes: png.length,
    });
  }
} finally {
  await browser.close();
}
for (const name of [
  "FluffyStuff-riichi-mahjong-tiles-NOTICE.txt",
  "FluffyStuff-riichi-mahjong-tiles-LICENSE.md",
  "Ma-Shan-Zheng-NOTICE.txt",
  "Ma-Shan-Zheng-OFL.txt",
])
  copyFileSync(
    path.join(root, "public/online/licenses", name),
    path.join(output, "licenses", name),
  );
for (const f of files) {
  const image = PNG.sync.read(readFileSync(path.join(output, f.target)));
  if (image.width !== f.width || image.height !== f.height)
    throw Error("Wrong export dimensions: " + f.target);
}
writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      generator: "scripts/sync-mini-assets.mjs",
      renderer: "Chromium " + browser.version(),
      scope:
        "PNG exports of existing CC0 tile art and SIL OFL brush font; no WeChat device acceptance",
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    tiles: files.filter((f) => f.target.startsWith("tiles/")).length,
    calligraphy: 7,
    pngBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    externalRequests: 0,
  }),
);
