"use client";
import {useLayoutEffect,useRef,useState} from "react";
import type {GameView} from "../domain/types";

/** Retain the latest physical animation deadline at this draw boundary. A
 * refresh with no flight keeps the server age; later pages never inherit it. */
export function useDrawResultLead(game:GameView|null, flight:unknown) {
  const flow=game?.settlementFlow;
  const key=flow?.stage === "draw" ? flow.id : "";
  const observed=useRef({key:"",age:0,at:0,ms:0});
  const [lead,setLead]=useState({key:"",ms:0});
  useLayoutEffect(()=>{
    if (!key) return;
    if(observed.current.key!==key) observed.current={key,age:flow?.elapsedMs ?? 0,at:performance.now(),ms:0};
    const remaining=Math.max(0,...[...document.querySelectorAll<HTMLElement>('.mahjong-discard-flight')].flatMap(element=>
      (element.getAnimations?.({subtree:true}) ?? []).flatMap(animation=>{
        const end=animation.effect?.getComputedTiming().endTime, current=animation.currentTime;
        return animation.playState === "running" && typeof end === "number" && Number.isFinite(end) && typeof current === "number" ? [Math.max(0,end-current)] : [];
      })));
    if(remaining) {
      const ms=observed.current.age+performance.now()-observed.current.at+remaining;
      // The final discard can mount after an earlier overlapping flight. Its
      // later deadline must extend the lead, never shorten an established one.
      if(ms>observed.current.ms) {observed.current.ms=ms;setLead({key,ms});}
    }
  },[key,flight,flow?.elapsedMs]);
  return lead.key===key ? lead.ms : 0;
}
