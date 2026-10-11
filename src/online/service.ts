import {RoomStore} from './domain/rooms';
import {BotRunner} from './domain/bot-runner';
import type {PlayerIdentity} from './domain/types';
const rooms=new RoomStore();
const idleMs=Number(process.env.ONLINE_IDLE_MS||60000),sweepMs=Number(process.env.ONLINE_SWEEP_MS||5000);
let closing=false,emptySince=Date.now(),scheduled=false;
const notify=()=>{if(scheduled||closing)return;scheduled=true;setImmediate(()=>{scheduled=false;process.send?.({type:'changed'});});};
rooms.subscribe(notify);
const bots=new BotRunner(rooms,{visualDelayMs:Number(process.env.ONLINE_BOT_DELAY_MS||1000),onChange:notify});
const timer=setInterval(()=>{
 rooms.sweep();
 if(rooms.size)emptySince=Date.now();
 else if(Date.now()-emptySince>=idleMs)void close();
},sweepMs);
async function close(){if(closing)return;closing=true;clearInterval(timer);await bots.close();process.disconnect?.();}
process.on('message',(m:any)=>{
 if(!m||closing)return;
 if(m.type==='shutdown'){void close();return;}
 try{
  let value;
  if(m.type==='view')value=rooms.view(m.userId);
  else if(m.type==='connection'){rooms.connection(m.userId,m.delta);value=true;}
  else if(m.type==='execute')value=rooms.execute(m.player as PlayerIdentity,m.command);
  else if(m.type==='metrics')value={rooms:rooms.size,workerRunning:bots.workerRunning,metrics:bots.metrics,rssBytes:process.memoryUsage().rss};
  else throw Error('Invalid internal message');
  process.send?.({type:'reply',id:m.id,value});
 }catch(e:any){process.send?.({type:'reply',id:m.id,error:{status:e.status||500,message:e.status?e.message:'牌桌暂时不可用',code:e.code}});}
});
process.on('disconnect',()=>void close());
process.on('SIGTERM',()=>void close());
process.on('SIGINT',()=>void close());
process.send?.({type:'ready'});
