import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
test('线下两端不再出现下拉、单选点和小勾选控件',()=>{
 const web=readFileSync('public/app.js','utf8');
 assert.doesNotMatch(web,/<select\b|<input[^>]+type=["'](?:checkbox|radio|month)["']/);
 const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
 for(const f of walk('miniprogram/pages').filter(f=>f.endsWith('.wxml')))assert.doesNotMatch(readFileSync(f,'utf8'),/<(?:picker|checkbox|checkbox-group|radio|radio-group|switch)\b/,f);
 assert.doesNotMatch(readFileSync('miniprogram/pages/room/index.js','utf8'),/showActionSheet/);
});
