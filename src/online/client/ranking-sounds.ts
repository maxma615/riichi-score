import type {RoomView} from '../domain/types';
import {rankingRowAt} from './final-ranking-presentation';
import {settlementSoundPhase,type SettlementSoundEvent} from './settlement-sounds';
/** A final snapshot can describe rows, but only the live final ACK boundary
 * authorizes playing their reveal cues. Native scores/ranks are never changed. */
export function acceptedRankingSounds(before:RoomView|null,after:RoomView):SettlementSoundEvent[]{
 const old=before?.game,g=after.game,f=g?.rankingFlow,rows=g?.ranking;
 if(!before||!old||!g||!f||!rows||before.status!=='playing'||after.status!=='finished'
  ||before.id!==after.id||before.variant!==after.variant||before.mySeat!==after.mySeat
  ||after.version!==before.version+1||!old.gameInstanceId||g.gameInstanceId!==old.gameInstanceId
  ||!old.handId||g.handId!==old.handId||old.ranking||old.rankingFlow
  ||f.id!==g.gameInstanceId||!Number.isFinite(f.elapsedMs)||f.elapsedMs<0||f.elapsedMs>=rankingRowAt(0))return [];
 const count=after.variant==='sanma'?3:4;
 if(rows.length!==count||g.players.length!==count)return [];
 const sorted=rows.slice().sort((a,b)=>a.rank-b.rank);
 if(sorted.some((r,index)=>r.rank!==index+1||!Number.isInteger(r.seat)||r.seat<0||r.seat>=count||!Number.isFinite(r.score))||new Set(rows.map(r=>r.seat)).size!==count)return [];
 return sorted.map((row,index)=>({
  id:JSON.stringify(['ranking-sound',after.id,g.gameInstanceId,f.id,row.seat,row.rank]),kind:index===0?'rank-first':'rank-row',seat:row.seat,
  atMs:rankingRowAt(index),endMs:rankingRowAt(index)+200,elapsedMs:f.elapsedMs,phaseKey:settlementSoundPhase(after),
  selector:`.mahjong-ranking[data-ranking-id] .mahjong-ranking__row:nth-child(${index+1})[data-ranking-visible="true"]`
 }));
}
