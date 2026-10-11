"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {RoomView} from '../domain/types';
import {openingKey,isUndealtRound,ROUND_OPENING} from '../domain/round-opening';
export function useRoundOpening({room,ownSeat,connected,intent}:{room:RoomView;ownSeat:number;connected:boolean;intent:string|null}){
 const key=openingKey(room,ownSeat),decision=room.game?.decisionId;
 const consumed=useRef(new Set<string>()),active=useRef<{key:string;decision:string;start:number}|null>(null);
 const timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 const [phase,setPhase]=useState<{key:string;decision:string;age:number}|null>(null);
 const cancel=useCallback(()=>{for(const t of timers.current)clearTimeout(t);timers.current.clear();active.current=null;setPhase(null);},[]);
 const arm=useCallback((run:{key:string;decision:string;start:number})=>{
  const elapsed=performance.now()-run.start;
  if(elapsed>=ROUND_OPENING.operationsMs){cancel();return;}
  for(const at of [...ROUND_OPENING.waves.slice(1),ROUND_OPENING.doraAndSortMs,ROUND_OPENING.operationsMs]){
   if(at<=elapsed)continue;
   const t=setTimeout(()=>{timers.current.delete(t);if(active.current!==run)return;
    const age=Math.max(at,performance.now()-run.start);
    if(age>=ROUND_OPENING.operationsMs){cancel();return;}
    // A stalled main thread reveals the current phase without replaying waves.
    setPhase({key:run.key,decision:run.decision,age});
   },at-elapsed);timers.current.add(t);
  }
 },[cancel]);
 useLayoutEffect(()=>{
  if(!connected||!key||intent!==key||!isUndealtRound(room)||document.visibilityState==='hidden'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){cancel();if(intent)consumed.current.add(intent);return;}
  if(active.current?.key===key&&active.current.decision===decision)return;
  cancel();if(consumed.current.has(key))return;consumed.current.add(key);
  // Bounded memory: no per-tile timers, no perpetual frame loop.
  if(consumed.current.size>128)consumed.current=new Set([key]);
  const run={key,decision:decision!,start:performance.now()};active.current=run;setPhase({key,decision:run.decision,age:0});arm(run);
 },[room,intent,key,decision,connected,cancel,arm]);
 useEffect(()=>{
  // Strict Mode can clean up and set up effects on the same mounted instance.
  // Resume the same deadline, while an actual unmount leaves no live callbacks.
  if(active.current&&timers.current.size===0)arm(active.current);
  const events=['resize','orientationchange','fullscreenchange','webkitfullscreenchange','blur','pagehide'];events.forEach(n=>window.addEventListener(n,cancel));
  document.addEventListener('visibilitychange',cancel);window.visualViewport?.addEventListener('resize',cancel);window.screen.orientation?.addEventListener?.('change',cancel);
  const query=window.matchMedia?.('(prefers-reduced-motion: reduce)');query?.addEventListener?.('change',cancel);
  return()=>{events.forEach(n=>window.removeEventListener(n,cancel));document.removeEventListener('visibilitychange',cancel);window.visualViewport?.removeEventListener('resize',cancel);window.screen.orientation?.removeEventListener?.('change',cancel);query?.removeEventListener?.('change',cancel);for(const t of timers.current)clearTimeout(t);timers.current.clear();};
 },[cancel,arm]);
 const age=connected&&phase?.key===key&&phase.decision===decision?phase.age:null;
 return {age,holding:age!==null,doraVisible:age===null||age>=ROUND_OPENING.doraAndSortMs};
}
