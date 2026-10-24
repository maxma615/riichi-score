import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
mkdirSync('.local/test-data',{recursive:true});
const dir=mkdtempSync('.local/test-data/username-browser-');
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,{server,store}=createApp({dataDir:dir,origin,basePath:'/riichi'});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch();
try{
 const one=await browser.newContext(),two=await browser.newContext();
 const p=await one.newPage();await p.goto(origin+'/riichi/');await p.locator('#me-tab').click();
 await p.locator('#account-name-form input').fill('中文牌友');await p.locator('#account-name-form button').click();
 await expect(p.locator('#account-name-form button')).toHaveText('保存名字');
 const first=await p.evaluate(async()=>fetch('/riichi/api/profile').then(r=>r.json()));
 const q=await two.newPage();await q.goto(origin+'/riichi/');await q.locator('#me-tab').click();
 await q.locator('#account-name-form input').fill('中文牌友');await q.locator('#account-name-form button').click();
 await expect(q.locator('#account-name-form button')).toHaveText('保存名字');
 const second=await q.evaluate(async()=>fetch('/riichi/api/profile').then(r=>r.json()));
 if(first.id!==second.id)throw Error('Different accounts');
 await p.locator('#account-name-form input').fill('新的中文名字');await p.locator('#account-name-form button').click();
 await expect(p.getByRole('heading',{name:'新的中文名字 · 我的牌谱'})).toBeVisible();
 await q.reload();await q.locator('#me-tab').click();await expect(q.locator('#account-name-form input')).toHaveValue('新的中文名字');
 const third=await browser.newContext();const z=await third.newPage();await z.goto(origin+'/riichi/');await z.locator('#me-tab').click();await z.locator('#account-name-form input').fill('新的中文名字');await z.locator('#account-name-form button').click();await expect(z.locator('#account-name-form button')).toHaveText('保存名字');
 const renamed=await z.evaluate(async()=>fetch('/riichi/api/profile').then(r=>r.json()));if(renamed.id!==first.id)throw Error('Lost account after rename');
 console.log('PASS: independent browsers share Chinese username, rename retains ID and updates existing sessions');
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
