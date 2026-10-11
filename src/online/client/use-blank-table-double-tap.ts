'use client';
import {useCallback,useEffect,useRef,useState,type PointerEvent} from 'react';
export const blankTablePreference='yougui.mahjong.doubleClick';
const surface=(target:EventTarget|null)=>target instanceof Element&&target.matches('.mahjong-table,.mahjong-table__surface');
export function useBlankTableDoubleTap({scope,disabled,onDoubleTap,recoveryEpoch=0}:{scope:string;disabled:boolean;onDoubleTap:()=>boolean;recoveryEpoch?:number}){
 const [enabled,setEnabled]=useState(false);
 const press=useRef<{id:number;x:number;y:number;scope:string}|null>(null),last=useRef<{at:number;scope:string}|null>(null),consumed=useRef<string|null>(null);
 const latest=useRef({scope,disabled,onDoubleTap});latest.current={scope,disabled,onDoubleTap};
 const reset=useCallback(()=>{press.current=null;last.current=null;},[]);
 useEffect(()=>{try{setEnabled(localStorage.getItem(blankTablePreference)==='1');}catch{/* Optional preference storage. */}},[]);
 useEffect(()=>{reset();consumed.current=null;},[scope,enabled,recoveryEpoch,reset]);
 useEffect(()=>{if(disabled)reset();},[disabled,reset]);
 useEffect(()=>{
  const events=['blur','pagehide','resize','orientationchange','fullscreenchange','webkitfullscreenchange'];
  for(const event of events)window.addEventListener(event,reset);
  window.visualViewport?.addEventListener('resize',reset);
  document.addEventListener('visibilitychange',reset);
  return()=>{reset();for(const event of events)window.removeEventListener(event,reset);window.visualViewport?.removeEventListener('resize',reset);document.removeEventListener('visibilitychange',reset);};
 },[reset]);
 const toggle=()=>{reset();setEnabled(old=>{const next=!old;try{localStorage.setItem(blankTablePreference,next?'1':'0');}catch{/* Keep this session usable. */}return next;});};
 const down=(event:PointerEvent<HTMLElement>)=>{
  if(!enabled||latest.current.disabled||event.button!==0||event.isPrimary===false||!surface(event.target)||document.visibilityState==='hidden'){reset();return;}
  press.current={id:event.pointerId,x:event.clientX,y:event.clientY,scope:latest.current.scope};
 };
 const up=(event:PointerEvent<HTMLElement>)=>{
  const p=press.current;press.current=null;
  if(!p||p.scope!==latest.current.scope||p.id!==event.pointerId||!surface(event.target)||Math.hypot(event.clientX-p.x,event.clientY-p.y)>8||!enabled||latest.current.disabled||document.visibilityState==='hidden'){reset();return;}
  const now=performance.now(),previous=last.current;last.current={at:now,scope:latest.current.scope};
  if(previous===null||previous.scope!==latest.current.scope||now-previous.at>=300)return;
  last.current=null;
  if(consumed.current===latest.current.scope)return;
  if(latest.current.onDoubleTap())consumed.current=latest.current.scope;
 };
 return {enabled,toggle,reset,down,up};
}
