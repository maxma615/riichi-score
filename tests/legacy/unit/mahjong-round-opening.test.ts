import {expect,it} from 'vitest';
import {acceptedRoundOpening,isOpeningGame,openingKey,openingTileCount,openingHand,ROUND_OPENING} from '../../../src/online/domain/round-opening';
import {physicalEngine} from '../fixtures/mahjong-settlement-game';
import ref from '../fixtures/mahjong-round-opening-reference.json';
import type {RoomView} from '../../../src/online/domain/types';
const room=(variant:'sanma'|'yonma'):RoomView=>({id:'room',code:'ABCDEFGH',hostUserId:'0',variant,mode:'east',status:'playing',version:4,mySeat:0,members:[],game:physicalEngine(variant,{0:'p123456789s123z2'},'z2').view(0)});
it('matches the pinned ordinary live reference timeline for 13 and 14 tile hands',()=>{expect(ROUND_OPENING).toEqual({waves:ref.waves,tilesPerWave:ref.tilesPerWave,doraAndSortMs:ref.doraAndSortMs,operationsMs:ref.operationsMs});for(const total of [13,14])for(const [age,wave]of [[0,4],[299,4],[300,8],[599,8],[600,12],[899,12],[900,14],[1199,14],[1200,14],[1500,14]] as const)expect(openingTileCount(age,total)).toBe(Math.min(wave,total));});
for(const variant of ['sanma','yonma'] as const){
 it('accepts a live lobby start and dealer repeat with different authoritative handId '+variant,()=>{const r=room(variant);expect(acceptedRoundOpening({...r,status:'lobby',game:null,version:3},r,true)).toBe(openingKey(r));const next={...r,version:5,game:{...r.game!,handId:r.game!.handId!+1,honba:1}};expect(acceptedRoundOpening(r,next,true)).toBe(openingKey(next));});
 it('rejects baseline, nonlive, duplicate, changed membership and progressed '+variant,()=>{const r=room(variant),lobby={...r,status:'lobby' as const,game:null,version:3};for(const before of [null,r])expect(acceptedRoundOpening(before,r,true)).toBeNull();expect(acceptedRoundOpening(lobby,r,false)).toBeNull();expect(acceptedRoundOpening(lobby,{...r,id:'other'},true)).toBeNull();expect(acceptedRoundOpening(lobby,{...r,mySeat:1},true)).toBeNull();expect(acceptedRoundOpening(lobby,{...r,game:{...r.game!,players:r.game!.players.map(p=>({...p,discards:p.seat===0?['z2']:[]}))}},true)).toBeNull();});
 it('never interprets a nuki or meld-only position as new dealing '+variant,()=>{const r=room(variant);for(const changes of [{nuki:1},{melds:['p111-']},{riichi:true}])expect(isOpeningGame({...r.game!,players:r.game!.players.map(p=>({...p,...(p.seat===0?changes:{})}))},variant)).toBe(false);});
}

for(const variant of ['sanma','yonma'] as const)it('uses actual private deal order only before live sorting '+variant,()=>{
 const game=physicalEngine(variant,{0:'p987654321s321z2'},'z2').view(0),sorted=game.hand.slice(0,-1);
 expect(openingHand(game,0)).toEqual(game.initialDeal);
 expect(openingHand(game,1199)).not.toEqual(sorted);
 expect(openingHand(game,1200)).toEqual(sorted);
 expect(openingHand(game,null)).toEqual(sorted);
 const original=game.initialDeal!.slice();openingHand(game,0)[0]='z7';expect(game.initialDeal).toEqual(original);
 for(const invalid of [[],Array(13).fill('z7'),original.map(t=>t==='p5'?'p0':t)])expect(openingHand({...game,initialDeal:invalid},0)).toEqual(sorted);
 expect(openingHand({...game,initialDeal:undefined},0)).toEqual(sorted);
});
