"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Choice,RoomView} from '../domain/types';
import {automaticChoice,automaticChoiceDelay,automaticOff,type AutomaticPreferences} from './automatic-choice';

// A new qipai resets transient auto-play options; reconnecting to the same
// hand keeps them. Include the authoritative hand ID even on dealer repeats.
const automaticScope=(room:RoomView,ownSeat:number)=>JSON.stringify([room.id,ownSeat,room.game?.gameInstanceId,room.game?.handId]);

export function useAutomaticPlay({room,ownSeat,connected,busy,onChoice,lastDiscardValue}:{room:RoomView;ownSeat:number;connected:boolean;busy:boolean;onChoice:(choice:Choice)=>void;lastDiscardValue?:string}){
 const scope=automaticScope(room,ownSeat);
 const [state,setState]=useState({scope,options:{...automaticOff}});
 const options=state.scope===scope?state.options:automaticOff;
 const [visibleEpoch,setVisibleEpoch]=useState(0);
 const latest=useRef({room,ownSeat,connected,busy,onChoice,lastDiscardValue,options});latest.current={room,ownSeat,connected,busy,onChoice,lastDiscardValue,options};
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null), consumed=useRef<string|null>(null);
 const generation=useRef(0), active=useRef(true);
 useEffect(()=>{setState(old=>old.scope===scope?old:{scope,options:{...automaticOff}});consumed.current=null;},[scope]);
 const decision=JSON.stringify([scope,room.game?.decisionId]);
 const candidate=room.status==='playing'&&room.game?automaticChoice(room.game,options,lastDiscardValue):null;
 const clear=useCallback(()=>{generation.current++;if(timer.current!==null)clearTimeout(timer.current);timer.current=null;},[]);
 const manual=useCallback(()=>{clear();consumed.current=decision;},[clear,decision]);
 const toggle=useCallback((key:keyof AutomaticPreferences)=>{
  clear();
  setState(old=>({scope,options:{...(old.scope===scope?old.options:automaticOff),[key]:!(old.scope===scope?old.options:automaticOff)[key]}}));
 },[scope,clear]);
 useEffect(()=>{
  const hide=()=>{active.current=false;clear();};
  const show=()=>{active.current=document.visibilityState!=='hidden';if(active.current)setVisibleEpoch(n=>n+1);};
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else show();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return()=>{clear();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
 },[clear]);
 useEffect(()=>{
  clear();
  if(!candidate||!connected||busy||!active.current||document.visibilityState==='hidden'||consumed.current===decision)return;
  const id=candidate.id, epoch=generation.current;
  timer.current=setTimeout(()=>{
   if(epoch!==generation.current)return;
   timer.current=null;const current=latest.current,g=current.room.game;
   if(!active.current||!current.connected||current.busy||current.room.status!=='playing'||!g||document.visibilityState==='hidden'||JSON.stringify([automaticScope(current.room,current.ownSeat),g.decisionId])!==decision||consumed.current===decision)return;
   const choice=automaticChoice(g,current.options,current.lastDiscardValue);if(choice?.id!==id)return;
   consumed.current=decision;current.onChoice(choice);
  },automaticChoiceDelay(candidate));
  return clear;
 },[candidate?.id,candidate?.type,decision,connected,busy,options,ownSeat,visibleEpoch,clear]);
 return {options,toggle,manual};
}
