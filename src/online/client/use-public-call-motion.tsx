'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import type {RoomView} from '../domain/types';
import {acceptedPublicCallEvent} from './public-call-motion';
import {measureDiscardElement,rectToFlight,type FlightView} from './use-discard-motion';
type Measurement = NonNullable<ReturnType<typeof measureDiscardElement>>;
type Baseline = {room:RoomView;connected:boolean;environmentEpoch:number;sources:Map<string,Measurement>};
type Active = {id:string;decision:string;group:HTMLElement;emphasis:Animation|null;target?:HTMLElement;visibility:string;priority:string;volume?:HTMLElement;volumeVisibility:string;volumePriority:string};
function readRivers(table:HTMLElement|null, retained:ReadonlyMap<string,Measurement> = new Map()) {
  const sources = new Map<string,Measurement>();
  table?.querySelectorAll<HTMLElement>('[data-discard-event-id]').forEach(wrapper=>{
    const id = wrapper.dataset.discardEventId;
    if (wrapper.closest('.is-discard-motion-hidden')) {
      const active = id && retained.get(id);
      if (active) sources.set(id!,active);
      return;
    }
    const face = wrapper.querySelector<HTMLElement>('.mahjong-tile');
    if (!id || !face || !face.isConnected || getComputedStyle(face).visibility !== 'visible'
      || getComputedStyle(wrapper).visibility !== 'visible' || Number(getComputedStyle(face).opacity) === 0
      || Number(getComputedStyle(wrapper).opacity) === 0) return;
    const measurement = measureDiscardElement(face);
    if (measurement) {
      const filter = getComputedStyle(wrapper).filter;
      const paint = {...measurement.paint,filter:[measurement.paint.filter,filter].filter(f=>f&&f!=='none').join(' ')||'none'};
      sources.set(id,{...measurement,paint});
    }
  });
  return sources;
}
export function usePublicCallMotion({room,ownSeat,connected,canAnimate,tableRef}:{
  room:RoomView;ownSeat:number;connected:boolean;canAnimate:boolean;tableRef:RefObject<HTMLDivElement|null>;
}) {
  const previous = useRef<Baseline|null>(null), active = useRef<Active|null>(null);
  const environmentEpoch = useRef(0);
  const [flight,setFlight] = useState<FlightView|null>(null);
  const restoreTarget = useCallback(()=>{
    const current=active.current;
    if(current?.target){
      if(current.visibility)current.target.style.setProperty('visibility',current.visibility,current.priority);
      else current.target.style.removeProperty('visibility');
      current.target=undefined;
    }
    if(current?.volume){
      if(current.volumeVisibility)current.volume.style.setProperty('visibility',current.volumeVisibility,current.volumePriority);
      else current.volume.style.removeProperty('visibility');
      current.volume=undefined;
    }
    setFlight(null);
  },[]);
  const cancel = useCallback(()=>{
    restoreTarget();
    const current=active.current;active.current=null;
    if(current?.emphasis){current.emphasis.onfinish=null;current.emphasis.cancel()}
    current?.group.removeAttribute('data-public-call-active');
  },[restoreTarget]);
  const finishFlight = useCallback((id:string)=>{if(active.current?.id===id)restoreTarget()},[restoreTarget]);
  // Read every committed render: discard motion can hide a river in its own
  // state update, without changing the room object's identity.
  useLayoutEffect(()=>{
    const old=previous.current,table=tableRef.current;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const hidden=document.visibilityState==='hidden';
    const eligible=connected&&canAnimate&&!reduced&&!hidden;
    const event=eligible&&old?.connected?acceptedPublicCallEvent(old.room,room):null;
    const sameScope=old&&old.room.id===room.id&&old.room.variant===room.variant
      &&old.room.status===room.status&&old.room.mySeat===room.mySeat
      &&old.room.game?.gameInstanceId===room.game?.gameInstanceId&&old.room.game?.handId===room.game?.handId;
    const retainActiveSources=Boolean(eligible&&sameScope&&old?.connected===connected
      &&old.environmentEpoch===environmentEpoch.current);
    if(active.current&&(!connected||reduced||hidden||room.status!=='playing'||!active.current.group.isConnected||!sameScope||old?.connected!==connected
      ||room.game?.settlement||room.game?.decisionId!==active.current.decision))cancel();
    if(event&&table){
      cancel();
      const group=table.querySelector<HTMLElement>(`[data-meld-seat="${event.seat}"][data-meld-index="${event.index}"]`);
      if(group?.dataset.meldValue===event.meld){
        const current:Active={id:event.id,decision:room.game!.decisionId,group,emphasis:null,visibility:'',priority:'',volumeVisibility:'',volumePriority:''};
        active.current=current;group.dataset.publicCallActive=event.id;
        try{
          const emphasis=group.animate([
            {boxShadow:'0 0 0 2px rgba(236,194,103,.9), 0 0 20px rgba(236,194,103,.45)'},
            {boxShadow:'0 0 0 2px rgba(236,194,103,.65), 0 0 12px rgba(236,194,103,.25)',offset:.72},
            {boxShadow:'0 0 0 0px rgba(236,194,103,0), 0 0 0px rgba(236,194,103,0)'}
          ],{duration:900,easing:'ease-out',fill:'both'});
          emphasis.id=`mahjong-public-call:${event.id}`;current.emphasis=emphasis;
          emphasis.onfinish=()=>{if(active.current?.id===event.id)cancel()};
        }catch{cancel();}
        const target=group.querySelector<HTMLElement>(event.kind==='kakan'?'[data-layer="added"] .mahjong-tile':'[data-called] .mahjong-tile');
        const source=event.source&&old!.sources.get(event.source.id),destination=target&&measureDiscardElement(target);
        if(active.current&&event.source&&source&&target&&destination
          &&target.closest<HTMLElement>('[data-tile-value]')?.dataset.tileValue===event.tile){
          const volume=target.closest<HTMLElement>('[data-meld-volume]');
          current.target=target;current.visibility=target.style.getPropertyValue('visibility');current.priority=target.style.getPropertyPriority('visibility');
          current.volume=volume??undefined;current.volumeVisibility=volume?.style.getPropertyValue('visibility')??'';current.volumePriority=volume?.style.getPropertyPriority('visibility')??'';
          target.style.setProperty('visibility','hidden');
          volume?.style.setProperty('visibility','hidden');
          setFlight({event:{...event.source,id:event.id,seat:event.seat,index:event.index,tile:event.tile!},source:'public',sourceTileId:event.source.id,
            sourcePaint:source.paint,targetPaint:destination.paint,
            from:rectToFlight(source.rect,source.geometry),to:rectToFlight(destination.rect,destination.geometry)});
        }
      }
    }
    previous.current={room,connected,environmentEpoch:environmentEpoch.current,
      sources:readRivers(table,retainActiveSources?old!.sources:undefined)};
  });
  useEffect(()=>{
    const table=tableRef.current,query=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let size=table?.getBoundingClientRect(),frame:number|null=null;
    const invalidate=()=>{
      environmentEpoch.current++;
      cancel();if(frame!==null)cancelAnimationFrame(frame);frame=null;
      const baseline=previous.current;if(!baseline)return;
      const invalidated={...baseline,environmentEpoch:environmentEpoch.current,sources:new Map<string,Measurement>()};previous.current=invalidated;
      if(typeof requestAnimationFrame!=='function')return;
      frame=requestAnimationFrame(()=>{
        frame=null;
        if(previous.current===invalidated&&invalidated.connected&&document.visibilityState!=='hidden'&&!query?.matches)
          previous.current={...invalidated,sources:readRivers(table)};
      });
    };
    const observer=typeof ResizeObserver==='undefined'||!table?null:new ResizeObserver(()=>{
      const next=table.getBoundingClientRect();if(!size||Math.abs(next.width-size.width)>.5||Math.abs(next.height-size.height)>.5)invalidate();size=next;
    });observer?.observe(table!);
    const events=['resize','orientationchange','fullscreenchange','webkitfullscreenchange'];events.forEach(e=>window.addEventListener(e,invalidate));
    window.visualViewport?.addEventListener('resize',invalidate);screen.orientation?.addEventListener?.('change',invalidate);
    document.addEventListener('visibilitychange',invalidate);query?.addEventListener?.('change',invalidate);
    return()=>{observer?.disconnect();if(frame!==null)cancelAnimationFrame(frame);events.forEach(e=>window.removeEventListener(e,invalidate));window.visualViewport?.removeEventListener('resize',invalidate);screen.orientation?.removeEventListener?.('change',invalidate);document.removeEventListener('visibilitychange',invalidate);query?.removeEventListener?.('change',invalidate);cancel()};
  },[cancel,tableRef,ownSeat]);
  return {flight,finishFlight,cancel};
}
