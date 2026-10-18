// Deterministic component + real rule/store integration, isolated loopback server.
// Full production HTTP/session/socket integration is tested by online-browser.mjs and online.test.js.
import { PNG } from "pngjs";
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const out = path.resolve(".local/browser/online-table-depth");
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

// Pixel checks exercise rendered paint; the old white strips have no orange
// material in the projected north rack even though their DOM boxes have height.
const orangePixels = (buffer, bounds) => {
 const png=PNG.sync.read(buffer); let count=0;
 for(let y=Math.max(0,Math.floor(bounds.y));y<Math.min(png.height,Math.ceil(bounds.y+bounds.height));y++)
  for(let x=Math.max(0,Math.floor(bounds.x));x<Math.min(png.width,Math.ceil(bounds.x+bounds.width));x++){
   const p=(y*png.width+x)*4,[r,g,b,a]=png.data.subarray(p,p+4);
   if(a>200&&r>145&&r>g*1.2&&g>b*1.2&&b<150)count++;
  }
 return count;
};
const corners=page=>page.locator('.mahjong-table__surface').evaluate(surface=>{
 const points=[];
 for(const [x,y] of [[0,0],[100,0],[0,100],[100,100]]){
  const marker=document.createElement('b');marker.style.cssText=`position:absolute;left:${x}%;top:${y}%;width:0;height:0;pointer-events:none`;
  surface.appendChild(marker);const r=marker.getBoundingClientRect();points.push({x:r.x,y:r.y});marker.remove();
 }
 return points;
});
try {
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try {
   for(const viewport of [{width:844,height:390},{width:1280,height:720}]){
    const label=engine.name()+'-'+viewport.width;
    const page=await browser.newPage({viewport,hasTouch:true});
    const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url()+':'+r.status())});
    const query='?scenario=pon&key=depth-'+label;
    const state=async()=>{const response=await page.request.get(origin+'/fixture/state'+query);assert.equal(response.status(),200);return response.json()};
    try {
     await page.goto(origin+'/'+query);
     await expect(page.locator('.mahjong-standing-tile').first()).toBeVisible();
     await page.evaluate(()=>document.fonts.ready);
     const button=page.locator('button[data-choice-type="pon"]');await expect(button).toBeEnabled();
     // Record existing control coordinates with the original camera, then click
     // those exact physical coordinates after the depth fix is restored.
     const original=await page.addStyleTag({content:'.mahjong-table__surface{perspective:none!important}.mahjong-game .mahjong-player__hidden > i.mahjong-standing-tile > .mahjong-standing-tile__body{height:var(--standing-d)!important;transform-style:preserve-3d!important}.mahjong-standing-tile__face{backface-visibility:hidden!important}.mahjong-standing-tile__face--back{transform:rotateX(90deg)!important}.mahjong-standing-tile__face--top{height:var(--standing-d)!important;transform:translateZ(var(--standing-h))!important;transform-origin:0 0!important}.mahjong-standing-tile__face--right{left:0!important;width:var(--standing-d)!important;transform:translateX(var(--standing-w)) translateY(var(--standing-d)) translateZ(var(--standing-h)) rotateZ(-90deg) rotateX(-90deg)!important}.mahjong-standing-tile__face--front,.mahjong-standing-tile__face--left,.mahjong-standing-tile__face--bottom{display:block!important}'});
     await page.waitForTimeout(250);
     const oldButton=await button.boundingBox();assert.ok(oldButton);
     const beforeCorners=await corners(page);
     await page.screenshot({path:path.join(out,label+'-original.png')});
     await original.evaluate(e=>e.remove());await page.waitForTimeout(250);
     const afterCorners=await corners(page);
     const shot=await page.screenshot({path:path.join(out,label+'-depth.png')});
     if(engine===chromium)for(const position of ['north','west']){
      const clip=await page.locator('.mahjong-table__position--'+position+' .mahjong-standing-tile__face').evaluateAll(faces=>{const boxes=faces.map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);const x=Math.max(0,Math.min(...boxes.map(r=>r.x))-6),y=Math.max(0,Math.min(...boxes.map(r=>r.y))-6);return {x,y,width:Math.min(innerWidth,Math.max(...boxes.map(r=>r.right))+6)-x,height:Math.min(innerHeight,Math.max(...boxes.map(r=>r.bottom))+6)-y}});
      await page.screenshot({path:path.join(out,label+'-'+position+'-crop.png'),clip});
     }
     const northBounds=await page.locator('.mahjong-table__position--north .mahjong-standing-tile__face--back').evaluateAll(faces=>{
      const boxes=faces.map(face=>face.getBoundingClientRect());
      const x=Math.min(...boxes.map(r=>r.x)),y=Math.min(...boxes.map(r=>r.y));
      return{x,y,width:Math.max(...boxes.map(r=>r.right))-x,height:Math.max(...boxes.map(r=>r.bottom))-y};
     });
     const orange=orangePixels(shot,northBounds);
     if(engine===chromium){
      assert.ok(orange>2000,`${label}: north rack needs visible orange vertical material, found ${orange} pixels`);
      const [tl,tr,bl,br]=afterCorners,topWidth=tr.x-tl.x,bottomWidth=br.x-bl.x;
      assert.ok(bottomWidth>topWidth*1.05,`${label}: near rail must be wider than far rail`);
      assert.ok(Math.abs((tl.x+tr.x)-(bl.x+br.x))<1,`${label}: trapezoid must remain symmetric`);
      assert.ok(Math.abs(tl.y-tr.y)<1&&Math.abs(bl.y-br.y)<1,`${label}: rails must stay horizontal`);
      afterCorners.forEach((point,i)=>assert.ok(Math.hypot(point.x-beforeCorners[i].x,point.y-beforeCorners[i].y)<1,`${label}: ground camera shifted`));
     }
     const newButton=await button.boundingBox();assert.ok(newButton);
     assert.ok(Math.abs(newButton.x-oldButton.x)<1&&Math.abs(newButton.y-oldButton.y)<1,`${label}: existing action coordinates moved`);
     const before=await state();
     await page.mouse.click(oldButton.x+oldButton.width/2,oldButton.y+oldButton.height/2);
     await expect.poll(async()=>{const current=await state();return current.game.players.find(p=>p.seat===current.mySeat).melds.length}).toBe(1);
     const called=await state();assert.equal(called.game.players.find(p=>p.seat===called.mySeat).melds[0].replace(/[+\-=]/g,''),'p111');
     await expect(page.locator('.mahjong-hand button[data-choice-id]:not(:disabled)').first()).toBeEnabled();
     const cut=called.game.choices.find(c=>c.type==='discard');assert.ok(cut);
     const tile=page.locator('.mahjong-hand button[data-choice-id="'+cut.id+'"]');
     await expect(tile).toBeEnabled();
     const box=await tile.boundingBox();assert.ok(box);
     const discards=called.game.players.find(p=>p.seat===called.mySeat).discards.length;
     await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
     await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
     await expect.poll(async()=>{const current=await state();return current.game.players.find(p=>p.seat===current.mySeat).discards.length}).toBe(discards+1);
     await page.screenshot({path:path.join(out,label+'-after-coordinate-clicks.png')});
     assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
     results.push({browser:engine.name(),viewport,northOrangePixels:orange,afterCorners,oldButton,newButton,calledMeld:'p111',coordinateDiscard:true,visualDepth:engine===chromium?'passed':'limited: local WebKit backend also flattens an isolated six-face CSS cube'});
    }finally{await page.close()}
   }

   for(const name of ['pon','ankan','kakan','riichi']){
    const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true});
    const query='?scenario='+name+'&key=public-depth-'+engine.name()+'-'+name;
    try{
     await page.goto(origin+'/'+query);
     await expect(page.locator('.mahjong-standing-tile').first()).toBeVisible();
     const before=await(await page.request.get(origin+'/fixture/state'+query)).json();
     if(name==='riichi'){
      await page.getByRole('button',{name:'立直',exact:true}).click();
      const choice=before.game.choices.find(c=>c.type==='riichi');assert.ok(choice);
      const tile=page.locator('.mahjong-hand button[data-choice-id="'+choice.id+'"]');
      await tile.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
      await expect(page.locator('.mahjong-river__tile.is-riichi')).toHaveCount(1);
     }else{
      await page.locator('button[data-choice-type="'+(name==='pon'?'pon':'kan')+'"]').click();
      await expect(page.locator('.mahjong-meld[data-meld-seat="'+before.mySeat+'"] [data-meld-volume]')).toHaveCount(name==='pon'?3:4);
     }
     await page.waitForTimeout(2200);
     const leaf=page.locator(name==='riichi'?'.mahjong-river__tile.is-riichi .mahjong-river__cap > .mahjong-tile':'.mahjong-meld[data-meld-seat="'+before.mySeat+'"] .mahjong-meld__slot:not(.is-sideways) .mahjong-meld__face').first();
     const bounds=await leaf.boundingBox();assert.ok(bounds);
     const shot=await page.screenshot({path:path.join(out,engine.name()+'-'+name+'-public-depth.png')});
     const png=PNG.sync.read(shot);let edgePixels=0;
     for(let y=Math.max(0,Math.floor(bounds.y-6));y<Math.min(png.height,Math.ceil(bounds.y+bounds.height+7));y++)
      for(let x=Math.max(0,Math.floor(bounds.x-6));x<Math.min(png.width,Math.ceil(bounds.x+bounds.width+7));x++){
       if(x>=bounds.x-1&&x<=bounds.x+bounds.width+1&&y>=bounds.y-1&&y<=bounds.y+bounds.height+1)continue;
       const p=(y*png.width+x)*4,[r,g,b]=png.data.subarray(p,p+3);
       if(r>100&&r<235&&g>70&&g<210&&b>35&&r>g*1.12&&g>b*1.17)edgePixels++;
      }
     if(engine===chromium)assert.ok(edgePixels>10,`${engine.name()} ${name}: needs a visible material edge outside the face, found ${edgePixels}`);
     if(name==='riichi')assert.ok(bounds.width>bounds.height,'riichi face stays sideways');
     results.push({browser:engine.name(),publicScenario:name,edgePixels,bounds,passed:true,visualDepth:engine===chromium?'passed':'limited: local WebKit 3D paint differs from computed coordinates'});
    }finally{await page.close()}
   }
  }finally{await browser.close()}
 }
}finally{await new Promise(resolve=>server.close(resolve))}
writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({out,results},null,2));
