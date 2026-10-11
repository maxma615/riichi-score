"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {RoomView} from '../domain/types';
import {acceptedDeclarationSounds,type DeclarationSoundEvent} from './declaration-sounds';
const scope=(r:RoomView)=>JSON.stringify([r.id,r.variant,r.mySeat,r.game?.gameInstanceId,r.game?.handId]);
type Visible={event:DeclarationSoundEvent;age:number};
/** Live declarations use the same proven identities as audio; a result GET is silent. */
export function MahjongDeclarations({room,connected,canAnimate,ownSeat}:{room:RoomView;connected:boolean;canAnimate:boolean;ownSeat:number}){
 const prior=useRef<{room:RoomView;connected:boolean}|null>(null);
 const active=useRef<{events:DeclarationSoundEvent[];at:number}|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [visible,setVisible]=useState<Visible[]>([]),[reduced,setReduced]=useState(false);
 const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;active.current=null;setVisible([]);};
 useEffect(()=>{
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const update=()=>setReduced(media?.matches??false);update();media?.addEventListener?.('change',update);
  const visibility=()=>{if(document.visibilityState==='hidden'){cancel();prior.current=null;}};
  document.addEventListener('visibilitychange',visibility);
  return()=>{clearTimeout(timer.current);active.current=null;document.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',update);};
 },[]);
 useEffect(()=>{
  const old=prior.current;prior.current={room,connected};
  if(!connected||!canAnimate||document.visibilityState==='hidden'||!old?.connected||scope(old.room)!==scope(room)){cancel();return;}
  const events=acceptedDeclarationSounds(old.room,room);
  if(!events.length)return;
  cancel();const presentation={events,at:performance.now()-events[0].elapsedMs};active.current=presentation;
  const tick=()=>{
   if(active.current!==presentation)return;
   const age=Math.max(0,performance.now()-presentation.at),end=events[0].kind==='riichi'?1000:1200;
   setVisible(age>=300&&age<end?events.map(event=>({event,age:age-300})):[]);
   const next=age<300?300:age<end?end:undefined;
   if(next!==undefined)timer.current=setTimeout(tick,next-age);else active.current=null;
  };tick();
 },[room,connected,canAnimate]);
 const count=room.variant==='sanma'?3:4;
 return <div className={`mahjong-abort-announcements mahjong-live-declarations${reduced?' is-reduced-motion':''}`} aria-label="牌桌声明">
  {visible.map(({event,age})=>{
   const relative=(event.seat-ownSeat+count)%count,position=relative===0?'south':relative===1?'east':relative===3||count===3?'west':'north';
   const actor=event.seat===ownSeat?'你':room.members.find(m=>m.seat===event.seat)?.displayName||`座位 ${event.seat+1}`;
   const label=event.kind==='riichi'?'立直':event.kind==='tsumo'?'自摸':'荣和';
   return <MountedDeclaration key={event.id} event={event} age={age} position={position} actor={actor} label={label}/>;
  })}
 </div>;
}
function MountedDeclaration({event,age,position,actor,label}:{event:DeclarationSoundEvent;age:number;position:string;actor:string;label:string}){
 const initialAge=useRef(-Math.min(200,Math.max(0,age)));
 return <div className={`mahjong-abort-declaration is-${event.kind} is-${position}`} style={{'--abort-animation-age':`${initialAge.current}ms`} as CSSProperties}
  data-declaration-event={event.id} data-declaration-seat={event.seat} role="status" aria-label={`${actor} · ${label}`}>
  <b aria-hidden="true">{event.kind==='ron'?'荣':label}</b><small aria-hidden="true" title={actor}>{actor}</small>
 </div>;
}
