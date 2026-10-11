'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

export const handClickPreference = 'yougui.mahjong.confirmClick';
type Selection = {tileId:string;choiceId:string};

// Desktop selection settles after a short hover. A press freezes eligibility:
// time spent holding an unselected tile must never turn into a confirmed click.
export function useHandHover({scope,disabled,onSelect,onClear}:{scope:string;disabled:boolean;onSelect:(selection:Selection)=>void;onClear:()=>void}) {
 const [twoClicks,setTwoClicks]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const owned=useRef(false);
 const latest=useRef({scope,disabled,twoClicks,onSelect,onClear});
 latest.current={scope,disabled,twoClicks,onSelect,onClear};
 const freeze=useCallback(()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;},[]);
 const reset=useCallback(()=>{freeze();if(owned.current)latest.current.onClear();owned.current=false;},[freeze]);
 useEffect(()=>{try{setTwoClicks(localStorage.getItem(handClickPreference)==='1');}catch{/* Optional preference storage. */}},[]);
 useEffect(()=>{reset();},[scope,disabled,twoClicks,reset]);
 useEffect(()=>{
  const events=['blur','pagehide','resize','orientationchange','fullscreenchange','webkitfullscreenchange'];
  for(const event of events)window.addEventListener(event,reset);
  document.addEventListener('visibilitychange',reset);
  return()=>{freeze();for(const event of events)window.removeEventListener(event,reset);document.removeEventListener('visibilitychange',reset);};
 },[reset,freeze]);
 const enter=(selection:Selection)=>{
  reset();const state=latest.current;
  if(state.disabled||state.twoClicks||document.visibilityState==='hidden')return;
  const expected=state.scope;
  timer.current=setTimeout(()=>{
   timer.current=null;const current=latest.current;
   if(current.scope!==expected||current.disabled||current.twoClicks||document.visibilityState==='hidden')return;
   owned.current=true;current.onSelect(selection);
  },11);
 };
 const press=(pointerType:string)=>{freeze();if(pointerType!=='mouse')reset();owned.current=false;};
 const toggle=()=>{reset();setTwoClicks(old=>{const next=!old;try{localStorage.setItem(handClickPreference,next?'1':'0');}catch{/* Session preference still works. */}return next;});};
 return {twoClicks,enter,leave:reset,press,reset,toggle};
}
