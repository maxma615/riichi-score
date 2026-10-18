import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function fixture(){let definition;const timers=new Map();let serial=0;
vm.runInNewContext(fs.readFileSync('archive/native-online/pages/online/index.js','utf8'),{Page:p=>definition=p,require:p=>p==='../../utils/api'?{api:async()=>{},error:()=>{}}:require('../archive/native-online/'+p.replace('../../','')),setTimeout:(f,ms)=>{const id=++serial;timers.set(id,{f:()=>{timers.delete(id);f()},ms});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>0,clearInterval:()=>{},Date,console});
const choice={id:'draw',type:'discard',value:'p3_'};const page={...definition,data:{busy:false,openingHolding:false,room:{id:'room',status:'playing',mySeat:0,game:{gameInstanceId:'instance',handId:1,decisionId:'d1',ownRiichi:{han:1},drawnTile:'p3',choices:[choice]}}},active:true,sent:[],send:async function(c){this.sent.push(c)}};return{page,timers,choice};}
test('原生立直自动摸切只提交当前引擎选项，并给摸牌留出阅读时间',()=>{const{page,timers}=fixture();assert.equal(typeof page.scheduleAutomatic,'function');page.scheduleAutomatic();assert.equal(timers.size,1);const t=[...timers.values()][0];assert.equal(t.ms,650);t.f();assert.equal(page.sent.length,1);assert.equal(page.sent[0].choiceId,'draw');page.scheduleAutomatic();assert.equal(timers.size,0);});
test('原生自动摸切的旧回调不能跨决策、隐藏页或手动提交生效',()=>{for(const change of ['decision','hidden','busy']){const{page,timers}=fixture();assert.equal(typeof page.scheduleAutomatic,'function');page.scheduleAutomatic();const t=[...timers.values()][0];if(change==='decision')page.data.room.game.decisionId='d2';if(change==='hidden')page.active=false;if(change==='busy')page.data.busy=true;t.f();assert.equal(page.sent.length,0);}});
test('原生立直暗杠、拔北、自摸和荣和保留选择机会',()=>{for(const type of ['kan','nuki','tsumo','ron']){const{page,timers}=fixture();assert.equal(typeof page.scheduleAutomatic,'function');page.data.room.game.choices.push({id:type,type});page.scheduleAutomatic();assert.equal(timers.size,0);}});

function requestFixture() {
  let definition, serial = 0;
  const timers = new Map(), requests = [];
  let getFails = false;
  const room = structuredClone(fixture().page.data.room);
  vm.runInNewContext(fs.readFileSync('archive/native-online/pages/online/index.js', 'utf8'), {
    Page: p => definition = p,
    require: p => p === '../../utils/api' ? {
      api: async (_path, method, body) => {
        if (method === 'POST') { requests.push(structuredClone(body)); throw Error('temporary network failure'); }
        if (getFails) throw Error('refresh unavailable');
        return { room: structuredClone(room) };
      }, error: () => {},
    } : require('../archive/native-online/' + p.replace('../../', '')),
    setTimeout: (run, ms) => { const id = ++serial; timers.set(id, { run, ms }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => 0, clearInterval: () => {}, Date,
  });
  const page = { ...definition, active: true, data: { ...definition.data, room: structuredClone(room) },
    setData(update) { Object.assign(this.data, update); },
    accept(result) { this.setData({ room: result.room }); this.scheduleAutomatic(); },
    touchCancel() {}, cancelOpening() {},
  };
  return { page, room, requests, timers, failRefresh(value) { getFails = value; },
    async fire() {
      assert.equal(timers.size, 1, 'one delayed automatic submission');
      const [id, timer] = [...timers][0]; timers.delete(id); timer.run();
      await new Promise(setImmediate);
    },
  };
}

test('原生自动请求失败只在成功权威刷新后同nonce重试两次，之后仍可手动操作', async () => {
  const h = requestFixture();
  h.page.scheduleAutomatic(); await h.fire();
  assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
  h.page.scheduleAutomatic(); assert.equal(h.timers.size, 0, 'no immediate retry');
  h.failRefresh(true); await h.page.refresh(); assert.equal(h.timers.size, 0);
  h.failRefresh(false);
  for (let attempt = 2; attempt <= 3; attempt++) {
    await h.page.refresh();
    assert.equal([...h.timers.values()][0]?.ms, 650);
    await h.fire(); assert.equal(h.requests.length, attempt); assert.equal(h.timers.size, 0);
  }
  await h.page.refresh(); assert.equal(h.timers.size, 0, 'two automatic retries exhausted');
  assert.equal(new Set(h.requests.map(r => r.nonce)).size, 1);
  await h.page.send({ action: 'respond', decisionId: 'd1', choiceId: 'draw' });
  assert.equal(h.requests.length, 4); assert.equal(h.requests[3].nonce, h.requests[0].nonce);
  await h.page.refresh(); assert.equal(h.timers.size, 0, 'manual failure does not restart automatic retries');
});

test('原生自动失败刷新到新决策或新桌时不携带旧请求与重试预算', async () => {
  for (const change of ['decision', 'room', 'choice']) {
    const h = requestFixture(); h.page.scheduleAutomatic(); await h.fire();
    if (change === 'decision') h.room.game.decisionId = 'd2';
    if (change === 'room') h.room.id = 'other-room';
    if (change === 'choice') h.room.game.choices = [{ id: 'kan', type: 'kan' }, ...h.room.game.choices];
    await h.page.refresh();
    assert.equal(h.page.pending, null, 'obsolete automatic pending request cleared');
    if (change === 'choice') assert.equal(h.timers.size, 0);
    else {
      await h.fire(); assert.notEqual(h.requests[1].nonce, h.requests[0].nonce);
      assert.equal(h.requests[1].roomId, h.room.id);
      assert.equal(h.requests[1].decisionId, h.room.game.decisionId);
    }
  }
});

test('原生隐藏页清理失败与已安排重试，旧回调和恢复快照都不重复提交', async () => {
  const h = requestFixture(); h.page.scheduleAutomatic(); await h.fire();
  await h.page.refresh();
  assert.equal(h.timers.size, 1);
  const stale = [...h.timers.values()][0].run;
  h.page.onHide();
  assert.equal(h.timers.size, 0); assert.equal(h.page.pending, null);
  stale(); await new Promise(setImmediate); assert.equal(h.requests.length, 1);
  h.page.active = true; await h.page.refresh();
  assert.equal(h.timers.size, 0, 'resuming same consumed decision cannot reset retry budget');
});

test('原生已安排重试时手动提交接管决策，失败也不能重开自动重试预算', async () => {
  const h = requestFixture(); h.page.scheduleAutomatic(); await h.fire();
  await h.page.refresh();
  assert.equal(h.timers.size, 1);
  const stale = [...h.timers.values()][0].run;
  await h.page.send({ action: 'respond', decisionId: 'd1', choiceId: 'draw' });
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].nonce, h.requests[0].nonce);
  assert.equal(h.timers.size, 0);
  stale(); await h.page.refresh();
  assert.equal(h.requests.length, 2); assert.equal(h.timers.size, 0);
});
