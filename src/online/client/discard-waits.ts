import Majiang from '@kobalab/majiang-core';
import {sanmaRule,scoreSanma} from '../domain/sanma-scoring';
import type {GameVariant,GameView} from '../domain/types';
export type DiscardWait = {tile:string;remaining:number;ronYaku:boolean;tsumoYaku:boolean;furiten:boolean;ronYakuman:boolean;tsumoYakuman:boolean;ronYakumanPossible:boolean;tsumoYakumanPossible:boolean};
const normal=(tile:string)=>tile.slice(0,2).replace('0','5');
/** Shape waits after an offered discard. Counts use only this player's hand
 * and publicly exposed tiles; they are not a prediction of the live wall. */
export function discardWaits(game:GameView,seat:number,variant:GameVariant,choiceId:string):DiscardWait[]{
 const choice=game.choices.find(c=>c.id===choiceId&&(c.type==='discard'||c.type==='riichi'));
 if(!choice?.value)return [];
 const physical=game.hand.slice();const index=physical.indexOf(choice.value.slice(0,2));
 if(index<0)return [];
 physical.splice(index,1);
 return analyzeWaits(game,seat,variant,physical,choice.value,choice.type==='riichi');
}
/** A peek is unambiguous only when one physical tile type can be discarded
 * to stay tenpai. Duplicate hand/drawn choices for the same tile count once. */
export function singleDiscardWaits(game:GameView,seat:number,variant:GameVariant,mode:'discard'|'riichi'='discard'):DiscardWait[]{
 const seen=new Set<string>();let single:DiscardWait[]=[];
 for(const choice of game.choices){
  if(choice.type!==mode||!choice.value)continue;
  const tile=choice.value.slice(0,2);
  if(seen.has(tile))continue;
  seen.add(tile);
  const waits=discardWaits(game,seat,variant,choice.id);
  if(!waits.length)continue;
  if(single.length)return [];
  single=waits;
 }
 return single;
}
/** Waits for the current effective thirteen-tile hand, including an existing
 * missed-ron block. No hypothetical discard is made and no command is sent. */
export function currentWaits(game:GameView,seat:number,variant:GameVariant):DiscardWait[]{
 return analyzeWaits(game,seat,variant,game.hand);
}
function analyzeWaits(game:GameView,seat:number,variant:GameVariant,physical:string[],discard?:string,declareRiichi=false):DiscardWait[]{
 const own=game.players.find(p=>p.seat===seat);
 if(!own||game.settlement||game.ranking||physical.length+own.melds.length*3!==13)return [];
 try{
  const hand=Majiang.Shoupai.fromString(physical.join('')+(own.melds.length?','+own.melds.join(','):''));
  if(Majiang.Util.xiangting(hand)!==0)return [];
  const visible=new Map<string,number>();
  const visibleRed=new Set<string>();
  const add=(tile:string)=>{const key=normal(tile);visible.set(key,(visible.get(key)??0)+1);if(tile[1]==='0')visibleRed.add(tile[0]);};
  game.hand.forEach(add);game.doraIndicators.forEach(add);
  for(const player of game.players){
   player.discards.filter(t=>!/[+=-]$/.test(t)).forEach(add);
   for(const meld of player.melds)for(const rank of meld.match(/\d/g)??[])add(meld[0]+rank);
   for(let n=0;n<(player.nuki??0);n++)add('z4');
  }
  const waiting=[...new Set(Majiang.Util.tingpai(hand)??[])].filter(tile=>variant!=='sanma'||!/^m[2-8]$/.test(tile));
  // Own discard clears ordinary missed-ron furiten. A declared riichi keeps
  // its existing block; permanent furiten includes the prospective discard.
  const river=[...own.discards,...(discard?[discard]:[])].map(normal);
  const furiten=Boolean(game.ronBlocked&&(!discard||own.riichi))||waiting.some(tile=>river.includes(normal(tile)));
  // Use the requesting player's native base value, including double riichi.
  // No future ippatsu, hidden ura or other speculative win context is added.
  const lizhi=game.ownRiichi?.han??(own.riichi?1:0);
  const riichiHan=lizhi||(declareRiichi?(game.ownRiichi?.declarationHan||1):0);
  const param=Majiang.Util.hule_param({rule:variant==='sanma'?sanmaRule:Majiang.rule(),zhuangfeng:game.roundWind,menfeng:own.wind,lizhi:riichiHan});
  const scoreOptions={rule:variant==='sanma'?sanmaRule:Majiang.rule(),zhuangfeng:game.roundWind,menfeng:own.wind,lizhi:riichiHan,baopai:game.doraIndicators};
  const yakuman=(tile:string,tsumo:boolean)=>{
   const shape=tsumo?hand.clone().zimo(tile):hand.clone(),ron=tsumo?null:tile+'+';
   if(variant==='sanma'){
    const score=scoreSanma(shape,ron,{...scoreOptions,nuki:own.nuki??0});
    return Boolean(score&&(score.yakuman>0||(score.han??0)>=13));
   }
   const score=Majiang.Util.hule(shape,ron,Majiang.Util.hule_param(scoreOptions));
   return Boolean(score?.hupai?.length&&((score.damanguan??0)>0||(score.fanshu??0)>=13));
  };
  return waiting.map(tile=>{
   const ronYakuman=yakuman(tile,false),tsumoYakuman=yakuman(tile,true);
   const redPossible=/^[mps]5$/.test(tile)&&!visibleRed.has(tile[0])&&(variant!=='sanma'||tile[0]!=='m');
   return {tile,remaining:Math.max(0,4-(visible.get(normal(tile))??0)),
   ronYaku:Boolean(Majiang.Util.hule(hand.clone(),tile+'+',param)?.hupai?.length),
   tsumoYaku:Boolean(Majiang.Util.hule(hand.clone().zimo(tile),null,param)?.hupai?.length),furiten,
   ronYakuman,tsumoYakuman,
   ronYakumanPossible:ronYakuman||(redPossible&&yakuman(tile[0]+'0',false)),
   tsumoYakumanPossible:tsumoYakuman||(redPossible&&yakuman(tile[0]+'0',true))};
  });
 }catch{return []}
}
