import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
test('中文用户名跨浏览器保持身份；改名同步历史、统计并持久化',()=>{
 mkdirSync('.local/test-data',{recursive:true});
 const dir=mkdtempSync('.local/test-data/username-');const file=path.join(dir,'db.sqlite');
 let store=new Store(file);
 try {
  const a=store.session(' 马超 '),b=store.session('牌友乙'),c=store.session('牌友丙');
  let r=store.create(a,{players:3});r=store.join(b,r.code,1);r=store.join(c,r.code,2);
  r=store.command(a,r.id,{action:'record',nonce:'username-record',version:r.version,event:{kind:'win',method:'ron',loser:1,winners:[{seat:0,han:3,fu:30}],riichi:[]}});
  const scores=[...r.scores];const before=store.raw(r.id).history;
  const again=store.session('马超');assert.equal(again.id,a.id);assert.notEqual(again.token,a.token);
  assert.equal(store.get(r.id,again).mySeat,0);
  store.updateProfile(a,'新中文名字');
  assert.equal(store.identity(again.token).name,'新中文名字');
  assert.equal(store.get(r.id,b).members[0].name,'新中文名字');
  assert.equal(store.list(b)[0].names[0],'新中文名字');
  assert.equal(store.invitation(r.code).seats[0].name,'新中文名字');
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
  assert.equal(store.stats(b,month).peers.find(p=>p.id===a.id).name,'新中文名字');
  assert.deepEqual(store.get(r.id,b).scores,scores);assert.deepEqual(store.raw(r.id).history,before);
  assert.equal(store.session('新中文名字').id,a.id);
  assert.throws(()=>store.updateProfile(b,'新中文名字'),e=>e.status===409);
  assert.equal(store.profile(b.id).name,'牌友乙');
  store.close();store=new Store(file);
  assert.equal(store.session('新中文名字').id,a.id);
  assert.equal(store.get(r.id,b).members[0].name,'新中文名字');
  assert.notEqual(store.session('马超').id,a.id);
 } finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('历史同名账号不自动合并；改名可以解除歧义',()=>{
 const s=new Store(':memory:');try{
  s.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run('old-a','重名','');
  s.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run('old-b','重名','');
  assert.throws(()=>s.session('重名'),e=>e.status===409);
  s.updateProfile({id:'old-a'},'独立名字');
  assert.equal(s.session('独立名字').id,'old-a');
  assert.equal(s.session('重名').id,'old-b');
 }finally{s.close();}
});

test('历史列表覆盖超过30桌，按本人身份隔离，显示最终点数和最新名字',()=>{
 const s=new Store(':memory:');try{
  const a=s.session('历史甲'),b=s.session('历史乙'),c=s.session('历史丙'),outside=s.session('外部');
  let r=s.create(a,{players:3});r=s.join(b,r.code,1);r=s.join(c,r.code,2);
  r=s.command(b,r.id,{action:'record',version:r.version,nonce:'history-record',event:{kind:'win',method:'ron',loser:1,winners:[{seat:0,han:3,fu:30}],riichi:[]}});
  r=s.command(c,r.id,{action:'finish',version:r.version,nonce:'history-finish'});
  for(let i=0;i<31;i++)s.create(a,{players:3});
  s.updateProfile(a,'历史新名字');
  const rows=s.list(s.session('历史新名字'));
  assert.equal(rows.length,32);
  const h=rows.find(x=>x.id===r.id);assert.equal(h.finished,true);assert.equal(h.hands,1);
  assert.equal(h.net,r.scores[0]-35000);assert.deepEqual(h.scores,r.scores);
  assert.equal(h.names[0],'历史新名字');assert.ok(h.updatedAt);
  assert.equal(s.list(b).length,1);assert.equal(s.list(b)[0].net,r.scores[1]-35000);
  assert.deepEqual(s.list(outside),[]);
  assert.throws(()=>s.get(r.id,outside),e=>e.status===403);
 }finally{s.close();}
});
