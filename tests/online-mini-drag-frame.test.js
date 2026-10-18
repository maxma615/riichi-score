import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DragFrames}=require('../miniprogram/utils/online-drag-frame');
function harness(){const tasks=new Map(),writes=[],callbacks=[];let id=0;const host={currentDrag:d=>d.valid,renderDrag(d,done){writes.push(d.x);callbacks.push(done);}};const frames=new DragFrames(host,{setTimeout(fn){tasks.set(++id,fn);return id;},clearTimeout(i){tasks.delete(i);}});return{frames,writes,callbacks,tick(){const list=[...tasks.values()];tasks.clear();list.forEach(fn=>fn());}};}
test('120 touch samples coalesce to the latest point with one bridge write in flight',()=>{const h=harness(),d={valid:true,x:0};for(let n=0;n<120;n++){d.x=n;h.frames.request(d);}assert.deepEqual(h.writes,[]);h.tick();assert.deepEqual(h.writes,[119]);d.x=121;h.frames.request(d);h.tick();assert.deepEqual(h.writes,[119]);h.callbacks.shift()();h.tick();assert.deepEqual(h.writes,[119,121]);});
test('release/background cancels queued work and delayed callbacks cannot revive old drag',()=>{const h=harness(),d={valid:true,x:1};h.frames.request(d);h.tick();h.frames.request({...d,x:2});h.frames.cancel();h.callbacks.shift()();h.tick();assert.deepEqual(h.writes,[1]);h.frames.request({valid:false,x:3});h.tick();assert.deepEqual(h.writes,[1]);});
