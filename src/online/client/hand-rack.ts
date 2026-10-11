import type {GameView} from '../domain/types';
import {openingHand,ROUND_OPENING} from '../domain/round-opening';
export type RackTile={value:string;key:string;tileId:string;logicalDraw:boolean;separated:boolean};
/** Ordinary closed-hand reference order: m,p,s,z; red five before plain five;
 * equal physical copies retain their prior order. */
export function rackTileRank(value:string){const suit='mpsz'.indexOf(value[0]),number=Number(value[1]);return suit*100+(number===0?5:number)*2+(number===0?0:1);}
export function validOpeningDeal(game:GameView){const normalized=openingHand(game,null),raw=openingHand(game,0);return normalized.length===13&&raw.length===13&&game.initialDeal?.length===13&&raw.every((value,index)=>value===game.initialDeal![index]);}
export function handRack(game:GameView,age:number|null,liveOpening:boolean):RackTile[]{
 const normalized=openingHand(game,null),counts=new Map<string,number>();
 let tiles: RackTile[]=normalized.map((value,index)=>{
  const occurrence=counts.get(value)??0;counts.set(value,occurrence+1);
  return {value,key:`hand:${value}:${occurrence}`,tileId:`hand:${index}:${value}`,logicalDraw:false,separated:false};
 });
 const raw=openingHand(game,0),valid=validOpeningDeal(game);
 if(age!==null&&age<ROUND_OPENING.doraAndSortMs&&valid){
  const remaining=tiles.slice();tiles=raw.map(value=>remaining.splice(remaining.findIndex(tile=>tile.value===value),1)[0]);
 }
 if(game.drawnTile)tiles.push({value:game.drawnTile,key:`drawn:${game.decisionId}`,tileId:`drawn:${game.decisionId}:${game.drawnTile}`,logicalDraw:true,separated:true});
 if(liveOpening&&valid&&game.drawnTile&&tiles.length===14&&(age===null||age>=ROUND_OPENING.doraAndSortMs)){
  tiles.sort((a,b)=>rackTileRank(a.value)-rackTileRank(b.value));
  tiles=tiles.map((tile,index)=>({...tile,separated:index===13}));
 }
 return tiles;
}
