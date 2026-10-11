import type {RoomView} from '../domain/types';
import {acceptedTableSounds} from './table-sounds';
export type DeclarationSoundEvent = {id:string;kind:'riichi'|'ron'|'tsumo';seat:number;atMs:number;elapsedMs:number};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const publicState=(r:RoomView)=>r.game?.players.map(p=>({seat:p.seat,score:p.score,riichi:p.riichi,melds:p.melds,discards:p.discards,nuki:p.nuki??0}));
/** Only continuously observed public declarations can create an audible cue. */
export function acceptedDeclarationSounds(before:RoomView|null,after:RoomView):DeclarationSoundEvent[]{
 const old=before?.game,game=after.game;
 if(!before||!old||!game||before.id!==after.id||before.variant!==after.variant||before.mySeat!==after.mySeat
  ||before.status!=='playing'||after.status!=='playing'||after.version!==before.version+1
  ||!old.gameInstanceId||game.gameInstanceId!==old.gameInstanceId||!Number.isInteger(old.handId)||old.handId!<1||game.handId!==old.handId
  ||!old.decisionId||!game.decisionId||old.decisionId===game.decisionId||old.settlement||old.settlementFlow)return [];
 const count=after.variant==='sanma'?3:4;
 if([old,game].some(g=>g.players.length!==count||new Set(g.players.map(p=>p.seat)).size!==count||g.players.some(p=>!Number.isInteger(p.seat)||p.seat<0||p.seat>=count)))return [];
 const flow=game.settlementFlow;
 if(game.settlement?.kind==='win'){
  const declarations=flow?.winDeclarations;
  if(!flow||!flow.id||flow.stage!=='detail'||flow.detailIndex!==0||!Number.isFinite(flow.elapsedMs)||flow.elapsedMs<0||flow.elapsedMs>=1200
   ||game.phase!=='hule'||!['zimo','gangzimo','nukizimo','dapai','gang','nuki'].includes(old.phase)||(old.phase==='nuki'&&after.variant!=='sanma')
   ||!declarations?.length||declarations.length!==flow.detailCount||declarations.length>=count
   ||new Set(declarations.map(d=>d.seat)).size!==declarations.length
   ||declarations.some(d=>!Number.isInteger(d.seat)||d.seat<0||d.seat>=count||(d.winMethod!=='ron'&&d.winMethod!=='tsumo'))
   ||(declarations.length>1&&declarations.some(d=>d.winMethod!=='ron'))
   ||declarations[0].seat!==game.settlement.winnerSeat||declarations[0].winMethod!==game.settlement.winMethod
   ||!same(publicState(before),publicState(after)))return [];
  if(declarations.some(d=>d.winMethod==='tsumo'&&(!['zimo','gangzimo','nukizimo'].includes(old.phase)||d.seat!==old.turnSeat))
   ||declarations.some(d=>d.winMethod==='ron'&&(!['dapai','gang','nuki'].includes(old.phase)||d.seat===old.turnSeat)))return [];
  return declarations.map((d,index)=>({id:JSON.stringify(['declaration',after.id,game.gameInstanceId,game.handId,flow.id,d.winMethod,d.seat]),kind:d.winMethod,seat:d.seat,atMs:300+(d.winMethod==='ron'?index*30:0),elapsedMs:flow.elapsedMs}));
 }
 if(game.settlement||flow)return [];
 const discard=acceptedTableSounds(before,after).find(c=>c.kind==='discard');
 if(!discard)return [];
 const prior=old.players.find(p=>p.seat===discard.seat)!,actor=game.players.find(p=>p.seat===discard.seat)!;
 if(prior.riichi||!actor.riichi||!actor.discards.at(-1)?.endsWith('*'))return [];
 return [{id:JSON.stringify(['declaration',discard.id,'riichi']),kind:'riichi',seat:discard.seat,atMs:300,elapsedMs:0}];
}
