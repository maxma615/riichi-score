"use client";
import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import type {RoomView} from '../domain/types';
import {TableAudioPlayer} from './table-audio';
import {loadMahjongVoices} from './voice-samples';
import {tableSoundTransition,type PendingKakanSound,type TableSoundEvent} from './table-sounds';
import {acceptedActionVoices} from './action-voices';
import {acceptedDeclarationSounds} from './declaration-sounds';
import {acceptedRankingSounds} from './ranking-sounds';
import {acceptedSettlementSounds,settlementSoundPhase,type SettlementSoundEvent} from './settlement-sounds';

type Pending={action?:{decision:string;kind:string;end:number};cue:TableSoundEvent;parent?:string;epoch:number;declarationEnd?:number;declarationGroup?:string;declarationOffset?:number;notBefore?:number;settlement?:SettlementSoundEvent;settlementAt?:number};
const storageKey='yougui.mahjong.sound';
const scope=(r:RoomView)=>JSON.stringify([r.id,r.variant,r.mySeat,r.game?.gameInstanceId,r.game?.handId]);

export type TableAudioControls={enabled:boolean;toggle:()=>void;land:(id:string)=>void;invalidate:()=>void;dealWave:(id:string,seat:number)=>void};

export function useTableAudio({room,connected,canAnimate,rootRef,shared}:{room:RoomView|null;connected:boolean;canAnimate:boolean;rootRef:RefObject<HTMLElement|null>;shared?:TableAudioControls}):TableAudioControls{
 const managed=!shared;
 const unlocking=useRef<Promise<boolean>|null>(null);
 const [enabled,setEnabled]=useState(true),enabledRef=useRef(true);
 const player=useRef<TableAudioPlayer|null>(null),previous=useRef<{room:RoomView;connected:boolean}|null>(null);
 const pending=useRef(new Map<string,Pending>()),frames=useRef(new Set<number>()),epoch=useRef(0);
 const pendingKan=useRef<PendingKakanSound|null>(null);
 const timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 const scheduleRef=useRef<(id:string)=>void>(()=>{});
 const clear=useCallback(()=>{
  epoch.current++;pending.current.clear();pendingKan.current=null;
  for(const id of frames.current)cancelAnimationFrame(id);frames.current.clear();
  for(const timer of timers.current)clearTimeout(timer);timers.current.clear();
 },[]);
 const invalidate=useCallback(()=>{clear();previous.current=null;player.current?.cancel();},[clear]);
 const land=useCallback((id:string)=>{
  const entry=pending.current.get(id);
  if(!entry||entry.parent||entry.epoch!==epoch.current)return;
  pending.current.delete(id);
  if(enabledRef.current&&document.visibilityState!=='hidden'){
   if(entry.settlement?.kind==='score-roll')player.current?.play(entry.cue,Math.max(0,(performance.now()-entry.settlementAt!-entry.settlement.atMs)/1000));
   else player.current?.play(entry.cue);
  }
  if(entry.declarationGroup&&entry.declarationOffset!==undefined){
   // A stalled main thread can release multiple due callbacks in one paint.
   // Keep later voices/cues separated from the actual first audible step.
   const now=performance.now();
   for(const value of pending.current.values())if(value.declarationGroup===entry.declarationGroup&&value.declarationOffset!==undefined&&value.declarationOffset>entry.declarationOffset)
    value.notBefore=Math.max(value.notBefore??0,now+value.declarationOffset-entry.declarationOffset);
  }
  for(const [child,value] of pending.current)if(value.parent===id){
   value.parent=undefined;
   // Completion promises may run before this frame's RAF callbacks. Cross a
   // paint boundary so the replacement is a separate presentation step.
   const frame=requestAnimationFrame(()=>{frames.current.delete(frame);if(pending.current.get(child)===value&&value.epoch===epoch.current)scheduleRef.current(child);});
   frames.current.add(frame);
  }
 },[]);
 const schedule=useCallback((id:string)=>{
  const frame=requestAnimationFrame(()=>{
   frames.current.delete(frame);
   const entry=pending.current.get(id),root=rootRef.current;
   if(!entry||entry.parent||entry.epoch!==epoch.current||!root)return;
   if(entry.settlement){
    const cue=entry.settlement,current=previous.current?.room,age=performance.now()-entry.settlementAt!;
    if(!current||settlementSoundPhase(current)!==cue.phaseKey||age>=cue.endMs){pending.current.delete(id);return;}
    if(!root.querySelector(cue.selector)){scheduleRef.current(id);return;}
    land(id);return;
   }
   if(entry.action){
    if(performance.now()>=entry.action.end){pending.current.delete(id);return;}
    const marker=[...root.querySelectorAll<HTMLElement>('[data-action-voice-kind]')].find(node=>node.dataset.actionVoiceKind===entry.action!.kind&&node.dataset.feedbackDecision===entry.action!.decision&&Number(node.dataset.feedbackSeat)===entry.cue.seat);
    if(!marker){scheduleRef.current(id);return;}
    land(id);return;
   }
   if(entry.declarationEnd!==undefined){
    if(performance.now()>=entry.declarationEnd){pending.current.delete(id);return;}
    if(entry.notBefore!==undefined&&performance.now()<entry.notBefore){scheduleRef.current(id);return;}
    const marker=[...root.querySelectorAll<HTMLElement>('[data-declaration-event]')].find(node=>node.dataset.declarationEvent===id);
    // React may commit the visual on the next paint. Never sound an absent
    // marker and never wait past this declaration's finite presentation window.
    if(!marker){scheduleRef.current(id);return;}
    land(id);return;
   }
   // Flight completion is reported by the actual layer, not a guessed delay.
   // Flights use a body portal; match only this proven room/event identity.
   const flight=[...document.querySelectorAll<HTMLElement>('[data-motion-event]')].find(node=>node.dataset.motionEvent===id);
   if(flight){
    const moves=flight.getAnimations?.()??[];
    if(moves.length)Promise.all(moves.map(a=>a.finished)).then(()=>land(id)).catch(()=>{if(pending.current.get(id)===entry){pending.current.delete(id);for(const [child,value] of pending.current)if(value.parent===id)pending.current.delete(child);}});
    return;
   }
   const animations:Animation[]=[];
   if(entry.cue.kind==='nuki'){
    for(const node of root.querySelectorAll<HTMLElement>('[data-nuki-seat]'))animations.push(...(node.getAnimations?.({subtree:true})??[]).filter(a=>a.id===`mahjong-nuki-arrival:${id}`));
   }else if(entry.cue.kind==='draw'){
    // Extraction completion can precede React committing the replacement rack.
    // Wait for the actual held tile to be released before inspecting its arrival.
    if(root.querySelector('.mahjong-drawn-wrap.is-nuki-held')){scheduleRef.current(id);return;}
    for(const node of root.querySelectorAll<HTMLElement>('button.mahjong-tile.is-draw-arriving'))animations.push(...(node.getAnimations?.()??[]).filter(a=>a.playState!=='finished'));
   }
   if(!animations.length){land(id);return;}
   Promise.all(animations.map(a=>a.finished)).then(()=>{
    if(pending.current.get(id)===entry&&entry.epoch===epoch.current)land(id);
   }).catch(()=>{
    if(pending.current.get(id)===entry){
     const current=previous.current?.room,game=current?.game;
     const isSettledDraw=entry.cue.kind==='draw'&&entry.epoch===epoch.current&&root.isConnected
      &&!root.querySelector('button.mahjong-tile.is-draw-arriving')&&game&&current
      &&id===JSON.stringify(['draw',current.id,game.gameInstanceId,game.handId,game.decisionId,game.turnSeat]);
     if(isSettledDraw)land(id);else{pending.current.delete(id);for(const [child,value] of pending.current)if(value.parent===id)pending.current.delete(child);}
    }
   });
  });
  frames.current.add(frame);
 },[rootRef,land]);
 scheduleRef.current=schedule;
 useEffect(()=>{
  if(!managed)return;
  const instance=new TableAudioPlayer(()=>{
   const Constructor=window.AudioContext??(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   if(!Constructor)throw Error('WebAudio unavailable');return new Constructor();
  },loadMahjongVoices);
  player.current=instance;
  let stored=true;try{stored=window.localStorage.getItem(storageKey)!=='off';}catch{/* Local settings may be unavailable. */}
  enabledRef.current=stored;setEnabled(stored);instance.setEnabled(stored);
  const gesture=(event:Event)=>{
   if(event.isTrusted&&enabledRef.current&&document.visibilityState!=='hidden'
    &&event.target instanceof Node&&rootRef.current?.contains(event.target)){
    const task=instance.unlock();unlocking.current=task;void task.finally(()=>{if(unlocking.current===task)unlocking.current=null;});
   }
  };
  const visibility=()=>{clear();previous.current=null;if(document.visibilityState==='hidden')instance.pause();};
  const geometry=()=>{clear();previous.current=null;instance.cancel();};
  const events=['resize','orientationchange','fullscreenchange','webkitfullscreenchange'];events.forEach(name=>window.addEventListener(name,geometry));
  document.addEventListener('pointerdown',gesture,true);document.addEventListener('keydown',gesture,true);
  document.addEventListener('visibilitychange',visibility);
  return()=>{
   clear();previous.current=null;instance.dispose();if(player.current===instance)player.current=null;
   events.forEach(name=>window.removeEventListener(name,geometry));
   document.removeEventListener('pointerdown',gesture,true);document.removeEventListener('keydown',gesture,true);document.removeEventListener('visibilitychange',visibility);
  };
 },[rootRef,clear,managed]);
 const toggle=useCallback(()=>{
  const next=!enabledRef.current;enabledRef.current=next;setEnabled(next);clear();player.current?.setEnabled(next);
  try{window.localStorage.setItem(storageKey,next?'on':'off');}catch{/* Muting still works without persistent settings. */}
  if(next&&document.visibilityState!=='hidden')void player.current?.unlock();
 },[clear]);
 useEffect(()=>{
  if(!managed)return;
  if(!room){clear();previous.current=null;player.current?.pause();return;}
  const old=previous.current;previous.current={room,connected};
  if(old&&old.room.game&&scope(old.room)!==scope(room)){clear();player.current?.cancel();}
  if(!connected||document.visibilityState==='hidden'){clear();player.current?.pause();return;}
  if(!canAnimate){clear();player.current?.cancel();return;}
  if(!old?.connected||!canAnimate||!enabledRef.current||scope(old.room)!==scope(room)){pendingKan.current=null;return;}
  const resultCues=[...acceptedSettlementSounds(old.room,room),...acceptedRankingSounds(old.room,room)];
  for(const cue of resultCues){
   if(cue.kind==='score-roll'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)continue;
   pending.current.set(cue.id,{cue,epoch:epoch.current,settlement:cue,settlementAt:performance.now()-cue.elapsedMs});
   const timer=setTimeout(()=>{timers.current.delete(timer);if(pending.current.has(cue.id))schedule(cue.id);},Math.max(0,cue.atMs-cue.elapsedMs));
   timers.current.add(timer);
  }
  for(const cue of acceptedActionVoices(old.room,room)){
   pending.current.set(cue.id,{cue,epoch:epoch.current,action:{decision:cue.decisionId,kind:cue.kind,end:performance.now()+900}});
   schedule(cue.id);
  }
  const transition=tableSoundTransition(old.room,room,pendingKan.current);pendingKan.current=transition.pending;
  const cues=transition.cues;
  const declarations=acceptedDeclarationSounds(old.room,room),declarationGroup=JSON.stringify(declarations.map(c=>c.id));
  for(const cue of declarations){
   const at=performance.now()-cue.elapsedMs,end=at+(cue.kind==='riichi'?1000:1200);
   pending.current.set(cue.id,{cue,epoch:epoch.current,declarationEnd:end,declarationGroup,declarationOffset:cue.atMs,notBefore:at+cue.atMs});
   const timer=setTimeout(()=>{timers.current.delete(timer);if(pending.current.has(cue.id))schedule(cue.id);},Math.max(0,cue.atMs-cue.elapsedMs));
   timers.current.add(timer);
  }
  for(const cue of cues){
   const parent=cue.kind==='draw'&&cues[0]?.kind!=='draw'?cues[0].id:undefined;
   pending.current.set(cue.id,{cue,parent,epoch:epoch.current});
   if(!parent)schedule(cue.id);
  }
 },[room,connected,canAnimate,clear,schedule,managed]);
 const dealWave=useCallback((id:string,seat:number)=>{
  if(!enabledRef.current||document.visibilityState==='hidden')return;
  const instance=player.current,task=unlocking.current;
  if(!task){instance?.play({id,kind:'draw',seat});return;}
  // The start gesture may still be resuming WebKit's context when the first
  // batch commits. Only that in-flight gesture may release this short cue.
  const started=performance.now(),generation=epoch.current;
  void task.then(ready=>{
   if(ready&&performance.now()-started<100&&epoch.current===generation&&player.current===instance
    &&enabledRef.current&&document.visibilityState!=='hidden')instance?.play({id,kind:'draw',seat});
  });
 },[]);
 return shared??{enabled,toggle,land,invalidate,dealWave};
}
