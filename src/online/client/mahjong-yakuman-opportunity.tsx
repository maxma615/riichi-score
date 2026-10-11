"use client";
import {useEffect,useRef,useState} from 'react';
import type {RoomView} from '../domain/types';
import type {DiscardWait} from './discard-waits';

export function yakumanWaitLevel(waits:DiscardWait[]):0|1|2 {
 if(!waits.length)return 0;
 if(waits.every(w=>w.ronYakuman&&w.tsumoYakuman))return 2;
 return waits.some(w=>w.ronYakumanPossible||w.tsumoYakumanPossible)?1:0;
}
const scope=(room:RoomView)=>JSON.stringify([room.id,room.variant,room.mySeat,room.game?.gameInstanceId,room.game?.handId,room.game?.roundWind,room.game?.roundNumber,room.game?.honba]);
type Seen={scope:string;key:string;level:0|1|2;connected:boolean};
/** Current thirteen-tile waits only. A selected hypothetical cut is not an event.
 * Restore/GET/hidden snapshots establish a baseline and never replay a cue. */
export function MahjongYakumanOpportunity({room,waits,connected,canAnimate}:{room:RoomView;waits:DiscardWait[];connected:boolean;canAnimate:boolean}){
 const previous=useRef<Seen|null>(null),timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 const [visible,setVisible]=useState<{level:1|2;id:string}|null>(null);
 const cancel=()=>{for(const timer of timers.current)clearTimeout(timer);timers.current.clear();setVisible(null);};
 useEffect(()=>{
  const hide=()=>{if(document.visibilityState==='hidden'){cancel();previous.current=null;}};
  const pagehide=()=>{cancel();previous.current=null;};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);
  return()=>{for(const timer of timers.current)clearTimeout(timer);timers.current.clear();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pagehide);};
 },[]);
 useEffect(()=>{
  const game=room.game,own=game?.players.find(p=>p.seat===room.mySeat);
  const effective=game&&own?game.hand.length+own.melds.length*3:0;
  const key=waits.map(w=>w.tile).sort().join(','),level=game&&game.remainingTiles>0?yakumanWaitLevel(waits):0;
  const next:Seen={scope:scope(room),key,level,connected},old=previous.current;
  // A draw temporarily has fourteen tiles; keep the last thirteen-tile wait
  // identity across it so a repeated tsumogiri cannot replay the same hint.
  previous.current=effective===14&&old?.scope===next.scope?{...old,connected}:next;
  if(!game||game.settlement||game.ranking||room.status!=='playing'||!connected||!canAnimate||document.visibilityState==='hidden'||!old?.connected||old.scope!==next.scope){cancel();return;}
  if(effective!==13)return;
  if(!level){cancel();return;}
  if(old.key===key&&old.level===level)return;
  cancel();
  const id=JSON.stringify([next.scope,game.decisionId,key,level]);
  const intro=setTimeout(()=>{
   timers.current.delete(intro);setVisible({level,id});
   const end=setTimeout(()=>{timers.current.delete(end);setVisible(null);},3000);timers.current.add(end);
  },600);timers.current.add(intro);
 },[room,waits,connected,canAnimate]);
 return visible?<div key={visible.id} className={`mahjong-yakuman-opportunity is-${visible.level===2?'certain':'possible'}`} role="status" aria-label={visible.level===2?'役满确定':'役满机会'} data-yakuman-event={visible.id}><b>役满</b><span>{visible.level===2?'确定':'机会'}</span></div>:null;
}
