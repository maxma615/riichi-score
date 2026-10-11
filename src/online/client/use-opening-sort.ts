"use client";
import {useLayoutEffect,useEffect,useRef} from 'react';
import {ROUND_OPENING} from '../domain/round-opening';
/** Ordinary reference SetIndex spacing 2.55 / Update speed (2.55 * 25):
 * 40 ms per rack slot, linear. Use local rack coordinates, never screen X. */
export const openingSortDuration=(distance:number,pitch:number)=>pitch>0?Math.abs(distance)/pitch*40:0;
// Sum layout offsets through slot wrappers; CSS transforms remain independent.
export function rackLayoutX(element:HTMLElement){let x=0,node:HTMLElement|null=element;for(let depth=0;node&&depth<32;depth++){x+=node.offsetLeft;node=node.offsetParent as HTMLElement|null;}return x;}
export function useOpeningSort(age:number|null,scope:string,connected:boolean){
 const rack=useRef<HTMLDivElement>(null),previous=useRef<Map<HTMLElement,number>|null>(null);
 const lastAge=useRef<number|null>(null),animations=useRef(new Set<Animation>());
 const cancel=()=>{for(const animation of animations.current)animation.cancel();animations.current.clear();previous.current=null;};
 useLayoutEffect(()=>{cancel();lastAge.current=null;return cancel;},[scope,connected]);
 useLayoutEffect(()=>{
  const tiles=[...(rack.current?.querySelectorAll<HTMLElement>('button[data-hand-instance-id]')??[])];
  if(age!==null&&age<ROUND_OPENING.doraAndSortMs){previous.current=new Map(tiles.map(tile=>[tile,rackLayoutX(tile)]));}
  else if(age!==null&&lastAge.current!==null&&lastAge.current<ROUND_OPENING.doraAndSortMs&&previous.current){
   const gaps=tiles.slice(1).map((tile,i)=>Math.abs(rackLayoutX(tile)-rackLayoutX(tiles[i]))).filter(gap=>gap>0);
   const pitch=Math.min(...gaps);
   for(const tile of tiles){
    // The reference's final separated SetIndex(..., true, false) is immediate.
    if(tile.classList.contains('is-drawn'))continue;
    const before=previous.current.get(tile),delta=before===undefined?0:before-rackLayoutX(tile);
    if(!delta||!Number.isFinite(pitch)||!tile.animate)continue;
    const animation=tile.animate([{translate:`${delta}px 0px`},{translate:'0px 0px'}],{duration:openingSortDuration(delta,pitch),easing:'linear'});
    animations.current.add(animation);animation.finished.then(()=>animations.current.delete(animation),()=>animations.current.delete(animation));
   }
   previous.current=null;
  }else if(age===null&&lastAge.current!==null&&lastAge.current<ROUND_OPENING.doraAndSortMs)cancel();
  lastAge.current=age;
 },[age,scope,connected]);
 useEffect(()=>{
  const clear=()=>cancel(),events=['resize','orientationchange','fullscreenchange','webkitfullscreenchange','blur','pagehide'];
  events.forEach(event=>window.addEventListener(event,clear));document.addEventListener('visibilitychange',clear);
  const element=rack.current;element?.addEventListener('pointerdown',clear,true);
  window.visualViewport?.addEventListener('resize',clear);window.screen.orientation?.addEventListener?.('change',clear);
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');media?.addEventListener?.('change',clear);
  return()=>{events.forEach(event=>window.removeEventListener(event,clear));document.removeEventListener('visibilitychange',clear);element?.removeEventListener('pointerdown',clear,true);window.visualViewport?.removeEventListener('resize',clear);window.screen.orientation?.removeEventListener?.('change',clear);media?.removeEventListener?.('change',clear);cancel();};
 },[scope,connected]);
 return rack;
}
