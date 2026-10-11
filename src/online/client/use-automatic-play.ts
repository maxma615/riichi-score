"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Choice,RoomView} from '../domain/types';
import {automaticChoice,automaticOff,type AutomaticPreferences} from './automatic-choice';

// A new qipai resets transient auto-play options; reconnecting to the same
// hand keeps them. Include the authoritative hand ID even on dealer repeats.
const automaticScope=(room:RoomView,ownSeat:number)=>JSON.stringify([room.id,ownSeat,room.game?.gameInstanceId,room.game?.handId]);

export function useAutomaticPlay({room,ownSeat,connected,busy,onChoice,lastDiscardValue}:{room:RoomView;ownSeat:number;connected:boolean;busy:boolean;onChoice:(choice:Choice)=>void;lastDiscardValue?:string}){
 const scope=automaticScope(room,ownSeat);
 const [state,setState]=useState({scope,options:{...automaticOff}});
 const options=state.scope===scope?state.options:automaticOff;
 const [visibleEpoch,setVisibleEpoch]=useState(0);
 const latest=useRef({room,connected,busy,onChoice,lastDiscardValue});latest.current={room,connected,busy,onChoice,lastDiscardValue};
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null), consumed=useRef<string|null>(null);
 useEffect(()=>{setState(old=>old.scope===scope?old:{scope,options:{...automaticOff}});consumed.current=null;},[scope]);
 const decision=JSON.stringify([scope,room.game?.decisionId]);
 const candidate=room.status==='playing'&&room.game?automaticChoice(room.game,options,lastDiscardValue):null;
 const clear=useCallback(()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;},[]);
 const manual=useCallback(()=>{clear();consumed.current=decision;},[clear,decision]);
 const toggle=useCallback((key:keyof AutomaticPreferences)=>{
  clear();consumed.current=null;
  setState(old=>({scope,options:{...(old.scope===scope?old.options:automaticOff),[key]:!(old.scope===scope?old.options:automaticOff)[key]}}));
 },[scope,clear]);
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();else setVisibleEpoch(n=>n+1);};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);
  return()=>{clear();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);};
 },[clear]);
 useEffect(()=>{
  clear();
  if(!candidate||!connected||busy||document.visibilityState==='hidden'||consumed.current===decision)return;
  const id=candidate.id;
  timer.current=setTimeout(()=>{
   timer.current=null;const current=latest.current,g=current.room.game;
   if(!current.connected||current.busy||current.room.status!=='playing'||!g||document.visibilityState==='hidden'||JSON.stringify([automaticScope(current.room,ownSeat),g.decisionId])!==decision||consumed.current===decision)return;
   const choice=automaticChoice(g,options,current.lastDiscardValue);if(choice?.id!==id)return;
   consumed.current=decision;current.onChoice(choice);
  },candidate.type==='ron'||candidate.type==='tsumo'?800:0);
  return clear;
 },[candidate?.id,candidate?.type,decision,connected,busy,options,ownSeat,visibleEpoch,clear]);
 return {options,toggle,manual};
}
