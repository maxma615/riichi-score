import type {RoomView} from '../domain/types';
import {detailValueAt,yakuRevealAt,YAKU_STEP_MS,SCORE_START_MS,SCORE_STEP_MS,SCORE_STEPS} from './settlement-presentation';
import type {TableSoundEvent} from './table-sounds';
export type SettlementSoundEvent=TableSoundEvent & {atMs:number;elapsedMs:number;endMs:number;phaseKey:string;selector:string};
export const settlementSoundPhase=(r:RoomView)=>{const ranking=r.game?.rankingFlow;if(r.game?.ranking&&ranking)return JSON.stringify(['ranking',ranking.id]);const f=r.game?.settlementFlow;return f?JSON.stringify([f.id,f.stage,f.detailIndex]):'';};
/** Live phase entries only; no past cue is replayed. Web requires adjacent
 * versions. An active native poller may explicitly allow increasing version
 * gaps after proving continuity with its own lifecycle and monotonic clock. */
export function acceptedSettlementSounds(before:RoomView|null,after:RoomView,options:{allowVersionGap?:boolean}={}):SettlementSoundEvent[]{
 const old=before?.game,g=after.game,f=g?.settlementFlow;
 if(!before||!old||!g||!f||before.id!==after.id||before.variant!==after.variant||before.mySeat!==after.mySeat
  ||before.status!=='playing'||after.status!=='playing'
  ||!Number.isFinite(after.version)||(options.allowVersionGap?after.version<=before.version:after.version!==before.version+1)
  ||!old.gameInstanceId||g.gameInstanceId!==old.gameInstanceId||!old.handId||g.handId!==old.handId
  ||!f.id||!Number.isFinite(f.elapsedMs)||f.elapsedMs<0||!g.settlement||g.ranking
  ||g.decisionId===old.decisionId||settlementSoundPhase(before)===settlementSoundPhase(after))return [];
 const n=after.variant==='sanma'?3:4;
 if(g.players.length!==n||f.oldScores.length!==n||f.delta.length!==n||f.newScores.length!==n
  ||[...f.oldScores,...f.delta,...f.newScores].some(v=>!Number.isFinite(v)))return [];
 const phaseKey=settlementSoundPhase(after),seat=g.settlement.winnerSeat??after.mySeat??0;
 const cue=(kind:TableSoundEvent['kind'],atMs:number,endMs:number,selector:string,index=0):SettlementSoundEvent=>({id:JSON.stringify(['settlement-sound',after.id,g.gameInstanceId,g.handId,phaseKey,kind,index]),kind,seat,atMs,elapsedMs:f.elapsedMs,endMs,phaseKey,selector});
 if(f.stage==='scores'){
  const prior=old.settlementFlow;
  if(!prior||prior.id!==f.id||!['detail','draw'].includes(prior.stage)||!f.delta.some(d=>d!==0)||f.elapsedMs>=SCORE_START_MS)return [];
  return [cue('score-roll',SCORE_START_MS,SCORE_START_MS+SCORE_STEP_MS*SCORE_STEPS,'.is-scores [data-settlement-seat]')];
 }
 if(f.stage!=='detail'||g.settlement.kind!=='win')return [];
 const prior=old.settlementFlow;
 if(prior?(prior.id!==f.id||prior.stage!=='detail'||f.detailIndex!==prior.detailIndex+1):f.detailIndex!==0)return [];
 const lead=f.detailIndex===0&&f.winDeclarations?.length?1200:0;
 const cues=g.settlement.yaku.map((_,index)=>cue('yaku',lead+yakuRevealAt(index),lead+yakuRevealAt(index)+YAKU_STEP_MS,`.is-detail li:nth-child(${index+1}).is-revealed`,index));
 if(g.settlement.points!==undefined)cues.push(cue('hand-value',lead+detailValueAt(g.settlement),lead+detailValueAt(g.settlement)+600,'.is-detail .mahjong-settlement-panel__value.is-revealed'));
 return cues.filter(cue=>cue.atMs>=f.elapsedMs);
}
