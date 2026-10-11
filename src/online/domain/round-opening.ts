import type {RoomView,GameView,GameVariant} from './types';
export const ROUND_OPENING={waves:[0,300,600,900],tilesPerWave:4,doraAndSortMs:1200,operationsMs:1500} as const;
export const openingKey=(room:RoomView,seat=room.mySeat)=>room.game?.gameInstanceId&&Number.isInteger(room.game.handId)?JSON.stringify([room.id,room.game.gameInstanceId,room.game.handId,seat]):null;
export function isOpeningGame(game:GameView|null,variant:GameVariant){
 return Boolean(game?.gameInstanceId)&&Number.isInteger(game?.handId)&&game!.handId!>0
  &&game!.phase==='zimo'&&!game!.settlement&&!game!.ranking
  &&game!.players.length===(variant==='sanma'?3:4)
  &&game!.players.every(p=>p.discards.length===0&&p.melds.length===0&&!p.riichi&&(p.nuki??0)===0&&p.handCount>=13&&p.handCount<=14);
}
export const isUndealtRound=(room:RoomView)=>room.status==='playing'&&isOpeningGame(room.game,room.variant);
/** Only an accepted live transition can originate a deal. Initial GET/socket
 * baselines, a different membership and snapshots from an ongoing hand cannot. */
export function acceptedRoundOpening(before:RoomView|null,after:RoomView,live:boolean){
 if(!live||!before||before.id!==after.id||before.variant!==after.variant||before.mySeat!==after.mySeat||after.version<=before.version||!isUndealtRound(after))return null;
 if(before.status==='lobby'&&!before.game)return openingKey(after);
 return before.game&&before.status==='playing'&&openingKey(before)!==openingKey(after)?openingKey(after):null;
}
export const openingTileCount=(age:number|null,total:number)=>age===null?total:Math.min(total,ROUND_OPENING.tilesPerWave*(Math.floor(age/300)+1));
/** The normalized hand remains authoritative for choices. Only a live opening
 * may show the owner's recorded wall order, after exact physical-tile validation
 * (red fives are not interchangeable with ordinary fives). */
export function openingHand(game: GameView, age: number | null): string[] {
 const sorted = game.drawnTile && game.hand.at(-1) === game.drawnTile ? game.hand.slice(0,-1) : game.hand;
 if(age===null || age>=ROUND_OPENING.doraAndSortMs || !game.initialDeal || game.initialDeal.length!==13 || sorted.length!==13)return sorted;
 const physical = sorted.slice();
 for(const tile of game.initialDeal){const index=physical.indexOf(tile);if(index<0)return sorted;physical.splice(index,1);}
 return game.initialDeal.slice();
}
