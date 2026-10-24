import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
test('自动入座、排序及选庄、删除后的历史统计和隔离',()=>{
 const s=new Store(':memory:');try{
  const a=s.session('甲'),b=s.session('乙'),c=s.session('丙'),outsider=s.session('外人');
  let r=s.create(a,{players:3,chooseDealer:true});
  r=s.join(b,r.code);assert.equal(r.mySeat,1);r=s.join(c,r.code);assert.equal(r.mySeat,2);
  assert.throws(()=>s.join(outsider,r.code),e=>e.status===409);
  const command=(u,action,fields={})=>s.command(u,r.id,{action,version:r.version,nonce:crypto.randomUUID(),...fields});
  assert.throws(()=>command(b,'reorder',{order:[0,0,2]}),e=>e.status===400);
  r=command(b,'reorder',{order:[2,0,1]});assert.deepEqual(r.members.map(m=>m.name),['丙','甲','乙']);assert.equal(r.dealerSelected,false);
  r=command(c,'set-dealer',{seat:1});assert.deepEqual(r.members.map(m=>m.name),['甲','乙','丙']);
  r=command(b,'record',{event:{kind:'win',method:'ron',loser:1,winners:[{seat:0,han:3,fu:30}],riichi:[]}});
  assert.throws(()=>command(b,'reorder',{order:[1,0,2]}),e=>e.status===409);
  assert.throws(()=>command(outsider,'delete'),e=>e.status===403);
  assert.throws(()=>command(b,'delete',{version:r.version-1}),e=>e.status===409);
  const code=r.code,id=r.id;
  assert.equal(command(c,'delete').deleted,true);
  assert.deepEqual(s.list(a),[]);assert.deepEqual(s.list(b),[]);
  assert.throws(()=>s.get(id,a),e=>e.status===404);assert.throws(()=>s.invitation(code),e=>e.status===404);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM commands WHERE room=?').get(id).n,0);
  const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
  assert.equal(s.stats(a,month).hands,0);assert.equal(s.stats(a,month).net,0);
  r=s.create(a,{players:3});assert.equal(command(a,'delete').deleted,true);
 }finally{s.close();}
});

test('删除写入持久存储，重启后不再出现',async()=>{
 const {mkdtempSync,rmSync,mkdirSync}=await import('node:fs');
 mkdirSync('.local/test-data',{recursive:true});const dir=mkdtempSync('.local/test-data/delete-room-');
 let s=new Store(dir+'/data.sqlite');try{
  const a=s.session('持久删除测试');const r=s.create(a,{players:3});
  s.command(a,r.id,{action:'delete',version:r.version,nonce:'persistent-delete'});s.close();s=new Store(dir+'/data.sqlite');
  assert.deepEqual(s.list(a),[]);assert.throws(()=>s.get(r.id,a),e=>e.status===404);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('原班续桌保留身份、并发只开一桌，开局前换人和场长',()=>{
 const s=new Store(':memory:');try{
  const a=s.session('续桌甲'),b=s.session('续桌乙'),c=s.session('续桌丙'),x=s.session('新朋友');
  let r=s.create(a,{players:3,chooseDealer:true,rounds:1});r=s.join(b,r.code);r=s.join(c,r.code);
  const send=(u,action,extra={})=>s.command(u,r.id,{action,version:r.version,nonce:crypto.randomUUID(),...extra});
  assert.throws(()=>send(a,'rematch'),e=>e.status===409);
  r=send(b,'set-length',{rounds:2});assert.equal(r.rules.rounds,2);
  assert.throws(()=>send(a,'set-length',{rounds:3}),e=>e.status===400);
  assert.throws(()=>send(a,'remove-player',{seat:0}),e=>e.status===400);
  r=send(a,'remove-player',{seat:2});assert.equal(r.members[2],null);assert.equal(r.dealerSelected,false);
  r=s.join(x,r.code);r=send(a,'set-dealer',{seat:0});
  r=send(b,'record',{event:{kind:'draw',tenpai:[],riichi:[]}});
  assert.throws(()=>send(a,'remove-player',{seat:2}),e=>e.status===409);
  assert.throws(()=>send(a,'set-length',{rounds:1}),e=>e.status===409);
  r=send(b,'finish');const old=s.raw(r.id),v=r.version,nonce=crypto.randomUUID();
  assert.throws(()=>send(c,'rematch'),e=>e.status===403);
  assert.throws(()=>send(a,'rematch',{version:v-1}),e=>e.status===409);
  const fresh=send(b,'rematch',{nonce});assert.notEqual(fresh.id,r.id);assert.equal(fresh.finished,false);assert.equal(fresh.dealerSelected,false);
  assert.deepEqual(s.raw(fresh.id).members,old.members);assert.deepEqual(fresh.scores,[35000,35000,35000]);assert.equal(fresh.hand,0);assert.equal(fresh.honba,0);assert.equal(fresh.pot,0);assert.deepEqual(fresh.history,[]);
  const again=send(a,'rematch');assert.equal(again.id,fresh.id);assert.equal(s.list(a).length,2);
  assert.equal(send(b,'rematch',{nonce}).id,fresh.id);
  assert.deepEqual(s.raw(r.id).history,old.history);assert.deepEqual(s.raw(r.id).scores,old.scores);
 }finally{s.close();}
});

test('东风和半庄末局换庄自动结算，连庄继续，撤回恢复并持久保存续桌',async()=>{
 const {mkdtempSync,rmSync,mkdirSync}=await import('node:fs');mkdirSync('.local/test-data',{recursive:true});const dir=mkdtempSync('.local/test-data/rematch-');
 let s=new Store(dir+'/data.sqlite');try{
  const a=s.session('整场测试');let r=s.create(a,{players:3,rounds:1,chooseDealer:true});
  const cmd=(action,fields={})=>s.command(a,r.id,{action,version:r.version,nonce:crypto.randomUUID(),...fields});
  r=cmd('add-player',{seat:1,name:'乙'});r=cmd('add-player',{seat:2,name:'丙'});r=cmd('set-dealer',{seat:0});
  for(let i=0;i<2;i++)r=cmd('record',{event:{kind:'draw',tenpai:[],riichi:[]}});
  r=cmd('record',{event:{kind:'draw',tenpai:[2],riichi:[]}});assert.equal(r.finished,false);assert.equal(r.hand,2);
  r=cmd('record',{event:{kind:'draw',tenpai:[],riichi:[]}});assert.equal(r.finished,true);assert.equal(r.hand,3);
  r=cmd('undo');assert.equal(r.finished,false);assert.equal(r.hand,2);
  r=cmd('record',{event:{kind:'draw',tenpai:[],riichi:[]}});const id=r.id;const fresh=cmd('rematch');s.close();s=new Store(dir+'/data.sqlite');
  assert.equal(s.get(id,a).finished,true);assert.equal(s.get(fresh.id,a).dealerSelected,false);
  assert.equal(s.command(a,id,{action:'rematch',version:1,nonce:crypto.randomUUID()}).id,fresh.id);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('四麻半庄南四与旧桌兼容，续桌删除后可重新开桌',()=>{
 const s=new Store(':memory:');try{
  const a=s.session('半庄验收'),b=s.session('半庄伙伴');let r=s.create(a,{players:4});r=s.join(b,r.code);
  for(const seat of [2,3])r=s.command(a,r.id,{action:'add-player',version:r.version,nonce:crypto.randomUUID(),seat,name:'玩家'+seat});
  const saved=s.raw(r.id);saved.hand=7;saved.dealer=3;s.save(saved);r=s.get(r.id,a);
  const send=(action,extra={})=>s.command(a,r.id,{action,version:r.version,nonce:crypto.randomUUID(),...extra});
  r=send('record',{event:{kind:'abort',riichi:[]}});assert.equal(r.finished,false);
  r=send('record',{event:{kind:'win',method:'tsumo',winners:[{seat:0,han:3,fu:30}],riichi:[]}});assert.equal(r.finished,true);assert.equal(r.hand,8);
  let next=send('rematch');s.command(a,next.id,{action:'delete',version:next.version,nonce:crypto.randomUUID()});r=s.get(r.id,a);
  const replacement=send('rematch');assert.notEqual(replacement.id,next.id);
  const legacy=s.raw(replacement.id);delete legacy.rules.rounds;legacy.hand=7;legacy.dealer=3;legacy.dealerSelected=true;s.save(legacy);r=s.get(legacy.id,a);
  r=send('record',{event:{kind:'draw',tenpai:[],riichi:[]}});assert.equal(r.finished,false);assert.equal(r.hand,8);
 }finally{s.close();}
});

test('只读追踪后续桌：成员自动跟进、历史保留、移出或删除不跟进',()=>{
 const s=new Store(':memory:');try{
  const a=s.session('追踪甲'),b=s.session('追踪乙'),x=s.session('外部');
  let old=s.create(a,{players:3});old=s.join(b,old.code);
  old=s.command(a,old.id,{action:'finish',version:old.version,nonce:crypto.randomUUID()});
  const next=s.command(a,old.id,{action:'rematch',version:old.version,nonce:crypto.randomUUID()});
  assert.equal(s.current(old.id,b).id,next.id);assert.equal(s.get(old.id,b).id,old.id);
  assert.throws(()=>s.current(old.id,x),e=>e.status===403);
  s.command(a,next.id,{action:'remove-player',seat:1,version:next.version,nonce:crypto.randomUUID()});
  assert.equal(s.current(old.id,b).id,old.id);assert.equal(s.current(old.id,a).id,next.id);
  const raw=s.raw(next.id);raw.finished=true;raw.nextRoomId=old.id;s.save(raw);
  assert.equal(s.current(old.id,a).id,next.id);
  s.command(a,next.id,{action:'delete',version:raw.version,nonce:crypto.randomUUID()});
  assert.equal(s.current(old.id,a).id,old.id);
 }finally{s.close();}
});
