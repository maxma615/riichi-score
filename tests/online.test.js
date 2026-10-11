import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {io} from 'socket.io-client';
import {createApp} from '../src/server.js';
const root=path.resolve('.local/test-data');mkdirSync(root,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
for(const variant of ['sanma','yonma'])test(`独立${variant}：双人身份、人机、手牌权限、解散与按需停止`,async()=>{
 const dataDir=mkdtempSync(path.join(root,'online-synthetic-'));
 const origin='http://127.0.0.1:3200',basePath='/riichi';
 const {server,online,store}=createApp({dataDir,origin,basePath,onlineOptions:{idleMs:150,sweepMs:50,botDelayMs:20}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}${basePath}`;
 const post=(endpoint,body,cookie='')=>fetch(base+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 const command=(cookie,body)=>post('/api/online',{nonce:randomUUID(),...body},cookie);
 const get=(cookie)=>fetch(base+'/api/online',{headers:{Cookie:cookie}});
 let socketA,socketB;
 try{
  assert.equal((await get('yougui_session=abcdef')).status,401);assert.equal(online.running,false);
  const login=async name=>(await post('/api/session',{name})).headers.get('set-cookie').split(';')[0];
  const a=await login('联机东家'),b=await login('联机南家'),c=await login('旁观身份');
  assert.deepEqual(await(await get(a)).json(),{room:null,serviceRunning:false});assert.equal(online.running,false);
  const invalid=await command(a,{action:'create',mode:'bad'});assert.equal(invalid.status,400);
  const creation={nonce:randomUUID(),action:'create',mode:'east',variant};
  let state=await(await post('/api/online',creation,a)).json();assert.ok(state.room?.id);const roomId=state.room.id;
  assert.equal((await(await post('/api/online',creation,a)).json()).room.id,roomId);
  assert.equal((await post('/api/online',{...creation,mode:'hanchan'},a)).status,409);
  const join=await(await command(b,{action:'join',code:state.room.code})).json();assert.equal(join.room.mySeat,1);
  assert.equal((await command(b,{action:'fill-bots',roomId})).status,403);
  assert.equal((await command(c,{action:'finish',roomId})).status,409);
  for(const [cookie,name] of [[a,'A'],[b,'B']]){
   const socket=io(base.replace(basePath,''),{path:basePath+'/online/socket.io',transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:origin},reconnection:false});
   if(name==='A')socketA=socket;else socketB=socket;
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('socket connect timeout')),3000);socket.once('connect',()=>{clearTimeout(timer);resolve();});socket.once('connect_error',reject);});
  }
  await command(a,{action:'fill-bots',roomId});await command(a,{action:'ready',ready:true,roomId});await command(b,{action:'ready',ready:true,roomId});
  let latestA,latestB;socketA.on('mahjong:state',s=>latestA=s);socketB.on('mahjong:state',s=>latestB=s);
  state=await(await command(a,{action:'start',roomId})).json();assert.equal(state.room.status,'playing');
  for(let n=0;n<60&&!latestB?.room?.game;n++)await pause(50);
  assert.ok(latestA.room.game);assert.ok(latestB.room.game);assert.equal(latestA.room.mySeat,0);assert.equal(latestB.room.mySeat,1);
  assert.ok(latestA.room.game.hand.length>=13);assert.ok(latestB.room.game.hand.length>=13);
  for(const s of [latestA,latestB])for(const player of s.room.game.players){assert.equal('hand' in player,false);assert.equal('choices' in player,false);}
  assert.equal((await(await get(c)).json()).room,null);
  let metrics;
  for(let n=0;n<80;n++){
   metrics=await online.call('metrics');if(metrics.metrics.computed>0)break;
   for(const cookie of [a,b]){const s=await(await get(cookie)).json(),g=s.room?.game;const choice=g?.choices.find(c=>c.type==='discard')||g?.choices.find(c=>c.type==='pass'||c.type==='ack');if(choice)await command(cookie,{action:'respond',roomId,decisionId:g.decisionId,choiceId:choice.id});}
   await pause(30);
  }
  assert.ok(metrics.metrics.computed>0,JSON.stringify(metrics));assert.equal(metrics.metrics.peakWorkers,1);assert.ok(metrics.metrics.maxQueue<=32);
  assert.equal((await fetch(base+'/api/health')).status,200);
  const p=await fetch(base+'/api/profile',{headers:{Cookie:a}});const profile=await p.json();assert.equal(latestA.room.members[0].userId,profile.id);
  assert.equal((await fetch(base+'/online/assets/fonts/mahjong-brush.woff2')).status,200);
  assert.equal((await fetch(base+'/online/')).status,200);
  const cleared=await(await command(a,{action:'finish',roomId})).json();assert.equal(cleared.room,null);
  for(let n=0;n<60&&latestB?.room;n++)await pause(20);assert.equal(latestB.room,null);
  socketA.disconnect();socketB.disconnect();
  for(let n=0;n<60&&online.running;n++)await pause(25);assert.equal(online.running,false);
  assert.equal((await(await get(a)).json()).serviceRunning,false);assert.ok(store.identity(a.split('=')[1]));
  const restarted=await(await command(a,{action:'create',mode:'east',variant})).json();assert.ok(restarted.room.id);assert.notEqual(restarted.room.id,roomId);
  online.child.kill('SIGKILL');for(let n=0;n<40&&online.running;n++)await pause(25);
  assert.equal((await fetch(base+'/api/health')).status,200);assert.equal((await(await get(a)).json()).room,null);
 }finally{socketA?.disconnect();socketB?.disconnect();await online.close();await new Promise(r=>server.close(r));rmSync(dataDir,{recursive:true,force:true});}
});
