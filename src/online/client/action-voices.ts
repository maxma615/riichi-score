import type {RoomView,GameView} from '../domain/types';
import type {ActionVoiceKind} from './voice-samples';
import {acceptedPublicCallEvent,acceptedPendingKakanEvent} from './public-call-motion';
import {acceptedNukiEvent} from './nuki-motion';
export type ActionVoiceEvent={id:string;kind:ActionVoiceKind;seat:number;decisionId:string};
/** A call declaration is distinct from the later physical group landing. */
export function acceptedActionVoices(before:RoomView|null,after:RoomView):ActionVoiceEvent[]{
 const old=before?.game,game=after.game;
 if(!before||!old||!game||before.status!=='playing'||after.status!=='playing'||before.id!==after.id||before.variant!==after.variant||before.mySeat!==after.mySeat||after.version!==before.version+1)return [];
 const capacity=after.variant==='sanma'?3:4;
 if(old.players.length!==capacity||game.players.length!==capacity)return [];
 const pending=pendingActionKind(old,game);
 if(pending){
  const actor=old.players.find(p=>p.seat===old.turnSeat)!;
  const identity=pending==='north'?`nuki:${after.id}:${game.gameInstanceId}:${game.handId}:${game.turnSeat}:${actor.nuki??0}`:`pending-kan:${after.id}:${game.gameInstanceId}:${game.handId}:${game.turnSeat}:${game.decisionId}`;
  return [{id:'action-voice:'+identity,kind:pending,seat:game.turnSeat,decisionId:game.decisionId}];
 }
 // Reaction resolution is a physical landing, not a second declaration.
 if(old.phase==='gang'||old.phase==='nuki')return [];
 const call=acceptedPublicCallEvent(before,after)??acceptedPendingKakanEvent(before,after);
 if(call){
  const digits=(call.meld.match(/\d/g)??[]).map(n=>n==='0'?'5':n);
  const kind=digits.length===4?'kan':digits.every(n=>n===digits[0])?'pon':'chi';
  return [{id:'action-voice:'+call.id,kind,seat:call.seat,decisionId:after.game!.decisionId}];
 }
 const north=acceptedNukiEvent(before,after);
 return north?[{id:'action-voice:'+north.id,kind:'north',seat:north.seat,decisionId:after.game!.decisionId}]:[];
}

/** Public phase intent is enough to name a pending action, never its hidden tiles. */
export function pendingActionKind(old:GameView,game:GameView):'kan'|'north'|undefined{
 if(!old.gameInstanceId||old.gameInstanceId!==game.gameInstanceId||!Number.isInteger(old.handId)||old.handId!<1||old.handId!==game.handId||!old.decisionId||old.decisionId===game.decisionId||!game.decisionId||old.settlement||game.settlement
  ||!['zimo','gangzimo','nukizimo'].includes(old.phase)||!['gang','nuki'].includes(game.phase)||old.turnSeat!==game.turnSeat||old.remainingTiles!==game.remainingTiles||old.riichiSticks!==game.riichiSticks)return;
 const count=game.players.length;
 if(![3,4].includes(count)||old.players.length!==count||(game.phase==='nuki'&&count!==3)||[old,game].some(g=>new Set(g.players.map(p=>p.seat)).size!==count||g.players.some(p=>!Number.isInteger(p.seat)||p.seat<0||p.seat>=count)))return;
 const publicState=(g:GameView)=>g.players.map(p=>({seat:p.seat,score:p.score,melds:p.melds,discards:p.discards,nuki:p.nuki??0,riichi:p.riichi}));
 if(JSON.stringify(publicState(old))!==JSON.stringify(publicState(game)))return;
 const actor=old.players.find(p=>p.seat===old.turnSeat);if(!actor)return;
 if(game.phase==='nuki'&&(!Number.isInteger(actor.nuki??0)||(actor.nuki??0)<0||(actor.nuki??0)>=4))return;
 return game.phase==='nuki'?'north':'kan';
}
