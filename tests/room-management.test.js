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
