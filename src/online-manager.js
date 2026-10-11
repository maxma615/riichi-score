import {fork} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {HttpError} from './store.js';
const entry=fileURLToPath(new URL('../dist/online-server.js',import.meta.url));
export class OnlineManager extends EventEmitter {
 constructor({idleMs=60000,sweepMs=5000,botDelayMs=1000,leaseMs=30000}={}){
  super();this.options={idleMs,sweepMs,botDelayMs,leaseMs};this.pending=new Map();this.sockets=new Map();this.leases=new Map();this.child=null;this.starting=null;this.serial=0;this.stopped=false;
  this.timer=setInterval(()=>this.expire(),Math.min(5000,leaseMs));this.timer.unref();
 }
 get running(){return Boolean(this.child?.connected&&this.ready);}
 online(id){return (this.sockets.get(id)||0)>0||(this.leases.get(id)||0)>Date.now();}
 async wake(){
  if(this.stopped)throw new HttpError(503,'服务正在关闭');
  if(this.running)return;
  if(this.starting)return this.starting;
  this.starting=this.start();
  try{await this.starting;}finally{this.starting=null;}
 }
 async start(){
  const child=fork(entry,[],{execArgv:['--max-old-space-size=48'],env:{...process.env,ONLINE_IDLE_MS:String(this.options.idleMs),ONLINE_SWEEP_MS:String(this.options.sweepMs),ONLINE_BOT_DELAY_MS:String(this.options.botDelayMs)},stdio:['ignore','ignore','ignore','ipc']});
  this.child=child;this.ready=false;
  const ready=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{child.kill('SIGTERM');reject(new HttpError(503,'联机服务未能启动'));},10000);
   const fail=()=>{clearTimeout(timeout);reject(new HttpError(503,'联机服务暂时不可用'));};
   child.once('error',fail);child.once('exit',fail);
   child.on('message',m=>{
    if(m?.type==='ready'){clearTimeout(timeout);this.ready=true;resolve();}
    else if(m?.type==='changed')this.emit('changed');
    else if(m?.type==='reply'){
     const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timeout);this.pending.delete(m.id);
     if(m.error)p.reject(new HttpError(m.error.status,m.error.message));else p.resolve(m.value);
    }
   });
  });
  child.once('exit',()=>{
   if(this.child!==child)return;this.child=null;this.ready=false;
   for(const p of this.pending.values()){clearTimeout(p.timeout);p.reject(new HttpError(503,'联机服务已停止，请重新开桌'));}this.pending.clear();this.emit('changed');
  });
  await ready;
  for(const id of new Set([...this.sockets.keys(),...this.leases.keys()]))if(this.online(id))await this.call('connection',{userId:id,delta:1});
 }
 call(type,fields={}){
  if(!this.running)return Promise.reject(new HttpError(503,'联机服务未启动'));
  const id=++this.serial;
  return new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{this.pending.delete(id);reject(new HttpError(503,'牌桌暂时未响应，请重试'));},5000);
   this.pending.set(id,{resolve,reject,timeout});
   this.child.send({type,id,...fields},error=>{if(!error)return;const p=this.pending.get(id);if(!p)return;clearTimeout(timeout);this.pending.delete(id);reject(new HttpError(503,'联机连接已断开'));});
  });
 }
 connected(id,delta){const before=this.online(id);const count=Math.max(0,(this.sockets.get(id)||0)+delta);if(count)this.sockets.set(id,count);else this.sockets.delete(id);this.connectionChange(id,before);}
 touch(id){const before=this.online(id);this.leases.set(id,Date.now()+this.options.leaseMs);this.connectionChange(id,before);}
 connectionChange(id,before){const after=this.online(id);if(before!==after&&this.running)void this.call('connection',{userId:id,delta:after?1:-1}).catch(()=>{});}
 expire(){const now=Date.now();for(const [id,expiry]of this.leases)if(expiry<=now){const before=true;this.leases.delete(id);this.connectionChange(id,before);}}
 async view(id,{touch=false}={}){if(!this.running)return {room:null,serviceRunning:false};if(touch)this.touch(id);return {room:await this.call('view',{userId:id}),serviceRunning:true};}
 async execute(user,command){await this.wake();this.touch(user.id);return {room:await this.call('execute',{player:{userId:user.id,displayName:user.name},command}),serviceRunning:true};}
 async close(){if(this.stopped)return;this.stopped=true;clearInterval(this.timer);const child=this.child;if(!child)return;await new Promise(resolve=>{const kill=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(kill);resolve();});if(child.connected)child.send({type:'shutdown'});else child.kill('SIGTERM');});}
}
