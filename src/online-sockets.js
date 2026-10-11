import {Server} from 'socket.io';
function identity(req,store){
 const bearer=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 const token=bearer??req.headers.cookie?.match(/(?:^|;\s*)riichi_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 const u=store.identity(token);return bearer&&u?.channel!=='wechat'?null:u;
}
export function attachOnlineSockets(server,manager,store,{origin,basePath}){
 const io=new Server(server,{path:basePath+'/online/socket.io',addTrailingSlash:false,serveClient:false,maxHttpBufferSize:4096,allowRequest:(req,accept)=>accept(null,!req.headers.origin||req.headers.origin===origin)});
 let closing=false,pushing=false,again=false,timer;
 const push=async()=>{
  if(closing)return;if(pushing){again=true;return;}pushing=true;
  try{const views=new Map();for(const socket of io.sockets.sockets.values()){
   const u=identity(socket.request,store);if(!u){socket.emit('mahjong:error',{code:'authentication_required',message:'登录已失效，请重新填写昵称'});socket.disconnect(true);continue;}
   let data=views.get(u.id);if(!data){data=await manager.view(u.id);views.set(u.id,data);}
   const text=JSON.stringify(data);if(text!==socket.data.last){socket.data.last=text;socket.emit('mahjong:state',data);}
  }}catch{/* An exiting child triggers a fresh stopped snapshot. */}finally{pushing=false;if(again){again=false;schedule();}}
 };
 const schedule=()=>{if(!timer&&!closing)timer=setTimeout(()=>{timer=null;void push();},30);};
 io.use((socket,next)=>{const u=identity(socket.request,store);if(!u)return next(new Error('请填写昵称'));if([...io.sockets.sockets.values()].filter(s=>s.data.userId===u.id).length>=8)return next(new Error('连接过多'));socket.data.userId=u.id;next();});
 io.on('connection',socket=>{manager.connected(socket.data.userId,1);socket.on('disconnect',()=>{manager.connected(socket.data.userId,-1);schedule();});schedule();});
 manager.on('changed',schedule);
 return {io,close:async()=>{closing=true;clearTimeout(timer);manager.off('changed',schedule);io.disconnectSockets(true);io.engine.close();}};
}
