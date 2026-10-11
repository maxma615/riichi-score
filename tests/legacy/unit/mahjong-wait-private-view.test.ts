import {expect,it} from 'vitest';
import {kakanSoundFixture} from '../fixtures/mahjong-audio-game';
it('returns only the requesting seat ron block through real kan/pass decisions',()=>{
 const game=kakanSoundFixture(true);
 for(let seat=0;seat<4;seat++){const v=game.view(seat);expect(typeof v.ronBlocked).toBe('boolean');expect(v.players.every(p=>!('ronBlocked' in p))).toBe(true)}
 const view=game.view(1),kan=view.choices.find(c=>c.type==='kan')!;expect(kan).toBeTruthy();game.respond(1,view.decisionId,kan.id);
 expect(game.view(2).choices.some(c=>c.type==='ron')).toBe(true);expect(game.view(2).ronBlocked).toBe(false);
 for(let seat=0;seat<4;seat++){const v=game.view(seat),pass=v.choices.find(c=>c.type==='pass');if(pass)game.respond(seat,v.decisionId,pass.id)}
 expect(game.view(2).ronBlocked).toBe(true);expect(game.view(0).ronBlocked).toBe(false);expect(game.view(0).players.every(p=>!('ronBlocked' in p))).toBe(true);
});

import {physicalEngine} from '../fixtures/mahjong-settlement-game';
for(const variant of ['yonma','sanma'] as const)it(`${variant} exposes own first-turn riichi value through native legal decisions only`,()=>{
 const game=physicalEngine(variant,{0:'p123456789s123z2'},'z2');
 expect(game.view(0).ownRiichi).toEqual({han:0,declarationHan:2});
 const v=game.view(0),riichi=v.choices.find(c=>c.type==='riichi')!;expect(riichi).toBeTruthy();game.respond(0,v.decisionId,riichi.id);
 expect(game.view(0).ownRiichi).toEqual({han:2,declarationHan:0});
 for(let seat=1;seat<(variant==='sanma'?3:4);seat++)expect(game.view(seat).ownRiichi?.han).toBe(0);
 expect(game.view(0).players.every(p=>!('ownRiichi' in p)&&!('declarationHan' in p))).toBe(true);
});

for(const variant of ['yonma','sanma'] as const)for(let dealer=0;dealer<(variant==='sanma'?3:4);dealer++)it(`${variant} uses native wind mapping for dealer ${dealer} and ordinary second-turn riichi`,()=>{
 const count=variant==='sanma'?3:4;
 const first=physicalEngine(variant,{[dealer]:'p123456789s123z2'},'z2',dealer);
 expect(first.view(dealer).players.find(p=>p.seat===dealer)?.wind).toBe(0);
 const v=first.view(dealer),r=v.choices.find(c=>c.type==='riichi')!;expect(r).toBeTruthy();first.respond(dealer,v.decisionId,r.id);
 expect(first.view(dealer).ownRiichi).toEqual({han:2,declarationHan:0});
 for(let seat=0;seat<count;seat++)if(seat!==dealer)expect(first.view(seat).ownRiichi?.han).toBe(0);
 const game=physicalEngine(variant,{[dealer]:'p123456789s123z2'},'z2',dealer);
 let turns=0;
 for(let step=0;step<80;step++){
  let acted=false;
  for(let seat=0;seat<count;seat++){
   const own=game.view(seat),cut=own.choices.find(c=>c.type==='discard'&&c.value?.endsWith('_'));
   if(seat===dealer&&cut){
    if(turns++){
     expect(own.ownRiichi).toEqual({han:0,declarationHan:1});
     const riichi=own.choices.find(c=>c.type==='riichi');expect(riichi).toBeTruthy();game.respond(seat,own.decisionId,riichi!.id);
     expect(game.view(seat).ownRiichi).toEqual({han:1,declarationHan:0});return;
    }
   }
   const choice=cut??own.choices.find(c=>c.type==='pass');
   if(choice){game.respond(seat,own.decisionId,choice.id);acted=true;break;}
  }
  expect(acted).toBe(true);
 }
 throw Error('did not reach native second turn');
});

it('sanma north extraction interrupts first-turn double riichi eligibility',()=>{
 const game=physicalEngine('sanma',{0:'p123456789s12z24'},'s3');
 const before=game.view(0),north=before.choices.find(c=>c.type==='nuki');expect(north).toBeTruthy();game.respond(0,before.decisionId,north!.id);
 for(let seat=0;seat<3;seat++){const v=game.view(seat),pass=v.choices.find(c=>c.type==='pass');if(pass)game.respond(seat,v.decisionId,pass.id);}
 const after=game.view(0);expect(after.players[0].nuki).toBe(1);expect(after.choices.some(c=>c.type==='riichi')).toBe(true);expect(after.ownRiichi).toEqual({han:0,declarationHan:1});
});

import {currentWaits,discardWaits} from '../../../src/online/client/discard-waits';
for(const variant of ['yonma','sanma'] as const)it(`${variant} carries actual native double-riichi context into both wait analyses`,()=>{
 const game=physicalEngine(variant,{0:'p1113337770599'},'z7');
 const before=game.view(0),cut=before.choices.find(c=>c.type==='riichi'&&c.value==='z7_');expect(cut).toBeTruthy();
 const preview=discardWaits(before,0,variant,cut!.id);expect(preview.map(w=>w.tile)).toEqual(['p5','p9']);expect(preview.every(w=>w.ronYakuman&&w.tsumoYakuman)).toBe(true);
 game.respond(0,before.decisionId,cut!.id);
 const actual=currentWaits(game.view(0),0,variant);expect(actual.map(w=>w.tile)).toEqual(['p5','p9']);expect(actual.every(w=>w.ronYakuman&&w.tsumoYakuman)).toBe(true);
});
