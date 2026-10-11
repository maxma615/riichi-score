"use client";

import {useEffect, useRef, useState} from "react";
import type {GameView, RoomMember} from "../domain/types";
import {pendingActionKind} from './action-voices';
import {tileName} from "./mahjong-tile";

export type TableActionLabel = "吃" | "碰" | "杠" | "拔北" | "立直" | "自摸" | "荣和" | "和牌" | "流局";
export type TableFeedback = {key:string; kind:"draw"|"discard"|"call"|"riichi"|"nuki"|"win"; text:string; seat?:number; actionLabel?:TableActionLabel};
type Snapshot = {game:GameView;room:string; gameInstanceId?:string; handId?:number; round:string; decision:string; settlementIdentity:string|null; players:{seat:number;nuki:number;riichi:boolean;discards:string[];melds:string[]}[]};
type FeedbackSource = {connected:boolean; canAnimate:boolean};

function callActionLabel(meld:string):TableActionLabel|undefined {
  const digits=meld.match(/\d/g)??[];
  if(digits.length===4) return "杠";
  if(digits.length!==3) return undefined;
  const ranks=digits.map(rank=>rank==="0"?"5":rank);
  return ranks.every(rank=>rank===ranks[0])?"碰":"吃";
}

function legacyCallLabel(meld:string) {
  const digits=meld.replace(/\D/g,"");
  return digits.length===4 ? "杠" : /^(\d)\1\1$/.test(digits.replace(/0/g,"5")) || meld[0]==="z" ? "碰" : "吃";
}

// Feedback follows acknowledged public state, never an optimistic button press.
export function useTableFeedback(game:GameView|null, members:RoomMember[], ownSeat:number, roomId:string, source:FeedbackSource = {connected:true,canAnimate:true}) {
  const previous=useRef<Snapshot|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const activeKind=useRef<string|null>(null);
  const [feedback,setFeedback]=useState<TableFeedback|null>(null);
  useEffect(() => {
    if (!game) {if(timer.current) clearTimeout(timer.current); timer.current=null; activeKind.current=null; previous.current=null; setFeedback(null); return;}
    const next:Snapshot={game:{...game,players:game.players.map(p=>({...p,melds:p.melds.slice(),discards:p.discards.slice()}))},room:roomId,gameInstanceId:game.gameInstanceId,handId:game.handId,round:`${game.roundWind}:${game.roundNumber}:${game.honba}`,decision:game.decisionId,settlementIdentity:game.settlement ? `${game.settlement.kind}:${game.settlement.winnerSeat ?? ""}` : null,
      players:game.players.map(p=>({seat:p.seat,nuki:p.nuki??0,riichi:p.riichi,discards:p.discards.slice(),melds:p.melds.slice()}))};
    const old=previous.current;
    previous.current=next;
    if (!old || old.room!==next.room || old.gameInstanceId!==next.gameInstanceId || old.handId!==next.handId || old.round!==next.round) {
      if (timer.current) clearTimeout(timer.current);
      timer.current=null; activeKind.current=null;
      setFeedback(null); return;
    }
    if (!source.connected) {
      if (timer.current) clearTimeout(timer.current);
      timer.current=null;
      activeKind.current=null;
      setFeedback(null);
      return;
    }
    // The server-relative abort sequence owns declarations and the result.
    // Do not replace its ordered seat indicators with an immediate generic draw.
    if (game.settlement?.drawInfo?.kind === "abort" && game.settlementFlow?.stage === "draw") {
      if (timer.current) clearTimeout(timer.current);
      timer.current=null; activeKind.current=null; setFeedback(null); return;
    }
    if (old.decision===next.decision) return;
    // GET refreshes and a socket's first snapshot establish state only. They may
    // contain actions that happened while this view was disconnected.
    if (!source.canAnimate) return;
    let event:Omit<TableFeedback,'key'>|undefined;
    const actor=(seat:number)=>seat===ownSeat ? "你" : members.find(m=>m.seat===seat)?.displayName || "牌友";
    if (game.settlement && next.settlementIdentity!==old.settlementIdentity) {
      const winner=game.settlement.winnerSeat;
      const actionLabel = game.settlement.kind==="draw" ? "流局" : game.settlement.winMethod === "tsumo" ? "自摸" : game.settlement.winMethod === "ron" ? "荣和" : "和牌";
      event={kind:"win",text:game.settlement.kind==="win" ? `${winner===undefined ? "" : `${actor(winner)} · `}${actionLabel}` : actionLabel,seat:winner,actionLabel};
    }
    const pending=pendingActionKind(old.game,game);
    if(!event&&pending){const actionLabel=pending==='north'?'拔北':'杠';event={kind:pending==='north'?'nuki':'call',text:`${actor(game.turnSeat)} · ${actionLabel}`,seat:game.turnSeat,actionLabel};}
    if (!event) for(const p of next.players) {
      const before=old.players.find(o=>o.seat===p.seat);
      if (before && p.nuki>before.nuki && old.game.phase!=="nuki") {event={kind:"nuki",text:`${actor(p.seat)} · 拔北`,seat:p.seat,actionLabel:"拔北"};break;}
      if (before && p.riichi && !before.riichi) {event={kind:"riichi",text:`${actor(p.seat)} · 立直`,seat:p.seat,actionLabel:"立直"};break;}
    }
    if (!event) for(const p of next.players) {
      const before=old.players.find(o=>o.seat===p.seat);
      if (!before) continue;
      const meld=p.melds.find((m,i)=>m!==before.melds[i]);
      if (meld && old.game.phase!=="gang") {const actionLabel=callActionLabel(meld);event={kind:"call",text:`${actor(p.seat)} · ${actionLabel??legacyCallLabel(meld)}`,seat:p.seat,...(actionLabel?{actionLabel}:{})};break;}
    }
    if (!event) for(const p of next.players) {
      const before=old.players.find(o=>o.seat===p.seat);
      if (!before) continue;
      if (p.discards.length>before.discards.length) {event={kind:"discard",text:`${actor(p.seat)} · ${tileName(p.discards.at(-1)!)}`,seat:p.seat};break;}
    }
    if (!event && game.turnSeat===ownSeat && game.drawnTile && ["zimo","gangzimo","nukizimo"].includes(game.phase)) {
      event={kind:"draw",text:game.phase==="zimo" ? "摸牌" : "补牌",seat:ownSeat};
    }
    if (!event) return;
    // Routine updates must not erase an important announcement or extend its
    // deadline. A newer special action still replaces the previous one at once.
    if (["draw","discard"].includes(event.kind) && activeKind.current && !["draw","discard"].includes(activeKind.current)) return;
    if (timer.current) clearTimeout(timer.current);
    activeKind.current=event.kind;
    setFeedback({...event,key:game.decisionId});
    timer.current=setTimeout(()=>{activeKind.current=null;setFeedback(null);timer.current=null;},900);
  },[game,roomId,ownSeat,members,source.connected,source.canAnimate]);
  useEffect(()=>()=>{if(timer.current) clearTimeout(timer.current);},[]);
  return feedback;
}
