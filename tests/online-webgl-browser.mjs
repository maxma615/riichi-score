// Deterministic component + real rule/store integration, isolated loopback server.
// Full production HTTP/session/socket integration is tested by online-browser.mjs and online.test.js.
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const out = path.resolve(".local/browser/online-webgl");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/online-interaction-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: path.join(out, "fixtures.mjs"),
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
await build({
  entryPoints: ["tests/online-interactions-entry.tsx"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  jsx: "automatic",
  external: ["./assets/*"],
  outfile: path.join(out, "client.js"),
  loader: { ".woff2": "file", ".webp": "file" },
});
const cssImports = (source) =>
  [...source.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map((m) =>
    path.basename(m[1]),
  );
assert.deepEqual(
  cssImports(readFileSync("tests/online-interactions-entry.tsx", "utf8")),
  cssImports(readFileSync("src/online/client/entry.tsx", "utf8")),
  "Harness must use the production stylesheet sequence",
);
const { scenario } = await import("file://" + path.join(out, "fixtures.mjs"));
const fixtures = new Map(),
  results = [];
const scoresBySeat = (game) =>
  game.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.score);
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"),
      name = u.searchParams.get("scenario"),
      key = u.searchParams.get("key");
    if (u.pathname.startsWith("/fixture/")) {
      assert.ok(
        [
          "riichi",
          "tsumo",
          "nuki",
          "pon",
          "ankan",
          "kakan",
          "chi",
          "daiminkan",
          "double-ron",
        ].includes(name),
      );
      assert.ok(key);
      if (!fixtures.has(key)) fixtures.set(key, scenario(name));
      const fixture = fixtures.get(key);
      let value;
      if (u.pathname === "/fixture/choose" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        value = fixture.choose(JSON.parse(body));
      } else {
        assert.equal(u.pathname, "/fixture/state");
        value = fixture.view();
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return;
    }
    if (u.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="online-root"></div><link rel="stylesheet" href="/test/client.css"><script type="module" src="/test/client.js"></script>',
      );
      return;
    }
    const root = u.pathname.startsWith("/test/assets/")
      ? path.resolve("public/online")
      : u.pathname.startsWith("/test/")
        ? out
        : path.resolve("public");
    const file = path.resolve(
      root,
      "." +
        (u.pathname.startsWith("/test/") ? u.pathname.slice(5) : u.pathname),
    );
    assert.ok(file.startsWith(root + path.sep));
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;


const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try{
 for(const viewport of [{width:1280,height:720},{width:844,height:390}]){
  for(const name of ['pon','nuki']){
   const page=await browser.newPage({viewport,hasTouch:true}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const query='?scenario='+name+'&key=webgl-'+viewport.width+'-'+name;
   await page.goto(origin+'/'+query);
   await expect(page.locator('canvas.mahjong-table-webgl')).toBeVisible({timeout:5000});
   await expect(page.locator('.mahjong-game')).toHaveAttribute('data-table-renderer','webgl');
   await page.waitForLoadState('networkidle');
   const actual=await page.locator('canvas.mahjong-table-webgl').evaluate(canvas=>{
    const gl=canvas.getContext('webgl2');return{depth:gl?.getParameter(gl.DEPTH_BITS),pieces:Number(canvas.dataset.pieceCount),frames:Number(canvas.dataset.renderFrames),
     clip:canvas.closest('.mahjong-table').style.getPropertyValue('--table-felt-clip')};
   });
   assert.ok(actual.depth>=16,'Actual WebGL depth buffer is required');
   assert.ok(actual.pieces>=26,'Opponent physical meshes are present');
   const p=[...actual.clip.matchAll(/([\d.\-]+)px ([\d.\-]+)px/g)].map(m=>({x:+m[1],y:+m[2]}));
   assert.equal(p.length,4);assert.ok(p[2].x-p[3].x>(p[1].x-p[0].x)*1.05);
   assert.ok(Math.abs(p[0].y-p[1].y)<.1&&Math.abs(p[2].y-p[3].y)<.1);
   await page.screenshot({path:path.join(out,name+'-'+viewport.width+'-3d.png')});
   // Reaching the real action must update the physical scene as well as the engine.
   const before=await(await page.request.get(origin+'/fixture/state'+query)).json();
   await page.locator('button[data-choice-type="'+(name==='pon'?'pon':'nuki')+'"]').click();
   await expect.poll(async()=>{
    const state=await(await page.request.get(origin+'/fixture/state'+query)).json();
    const own=state.game.players.find(p=>p.seat===state.mySeat);
    return name==='pon'?own.melds.length:own.nuki;
   }).toBe(1);
   await expect(page.locator('.mahjong-discard-flight')).toHaveCount(0,{timeout:5000});
   await page.screenshot({path:path.join(out,name+'-'+viewport.width+'-after.png')});
   await page.waitForTimeout(2200);await page.waitForLoadState('networkidle');
   const frames=await page.locator('canvas').getAttribute('data-render-frames');await page.waitForTimeout(350);
   assert.equal(await page.locator('canvas').getAttribute('data-render-frames'),frames,'Idle table should not render a perpetual loop');
   if(name==='pon'&&viewport.width===1280){
    await page.locator('canvas').evaluate(canvas=>{window.webglRestore=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');window.webglRestore.loseContext();});
    await expect(page.locator('.mahjong-game')).not.toHaveAttribute('data-table-renderer','webgl');
    await expect(page.locator('canvas')).toBeHidden();
    await page.setViewportSize({width:1260,height:720});await page.waitForTimeout(150);
    await expect(page.locator('.mahjong-game')).not.toHaveAttribute('data-table-renderer','webgl');
    await expect(page.locator('canvas')).toBeHidden();
    await page.setViewportSize(viewport);await page.waitForTimeout(200);await page.evaluate(()=>window.webglRestore.restoreContext());
    await expect(page.locator('.mahjong-game')).toHaveAttribute('data-table-renderer','webgl',{timeout:8000});
    await expect(page.locator('canvas')).toBeVisible();
   }
   assert.deepEqual(errors,[]);results.push({name,viewport,depthBits:actual.depth,pieces:actual.pieces,action:true,idle:true});
   await page.close();
  }
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
