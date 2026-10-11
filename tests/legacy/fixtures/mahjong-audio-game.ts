import assert from 'node:assert/strict';
import Majiang from '@kobalab/majiang-core';
import {RiichiGame} from '../../../src/online/domain/engine';
export function kakanSoundFixture(waiting:boolean|'double'=true){
 const hands=['p1s123456789z123','p11s123456789z45',waiting?'m123s123p23z11122':'m123456789s123z4',waiting==='double'?'m456s789p23z33344':'m111222333s456z5'];
 const game=new RiichiGame('east',['A','B','C','D'],{dealer:0,wallFactory:rule=>{
  const wall=new Majiang.Shan(rule),physical=wall._pai.slice(),available=physical.slice();
  const take=(t:string)=>{const i=available.indexOf(t);assert(i>=0);return available.splice(i,1)[0];};
  const dealt=hands.map(h=>[...h.matchAll(/([mpsz])(\d+)/g)].flatMap(m=>[...m[2]].map(n=>take(m[1]+n))));
  assert(dealt.every(h=>h.length===13));
  const sequence=['p9','m9','m8','m7','p1'].map(take),dora=take('z6'),ura=take('z6');
  wall._pai=[...available.slice(0,4),dora,...available.slice(4,8),ura,...available.slice(8),...sequence.reverse(),...dealt.flat().reverse()];
  assert.deepEqual(wall._pai.slice().sort(),physical.sort());wall._baopai=[dora];wall._fubaopai=[ura];return wall;
 }});
 const choose=(seat:number,type:string,pick?:(v:string|undefined)=>boolean)=>{const v=game.view(seat),c=v.choices.find(c=>c.type===type&&(!pick||pick(c.value)))!;assert(c);game.respond(seat,v.decisionId,c.id);};
 const passAll=()=>{for(let n=0;n<20;n++){let passed=false;for(let seat=0;seat<4;seat++){const v=game.view(seat),c=v.choices.find(c=>c.type==='pass');if(c){game.respond(seat,v.decisionId,c.id);passed=true;}}if(!passed)return;}throw Error('Unbounded native reactions');};
 choose(0,'discard',v=>v==='p1');choose(1,'pon');passAll();choose(1,'discard');passAll();
 for(const seat of [2,3,0]){assert.equal(game.view(seat).turnSeat,seat);choose(seat,'discard',v=>!!v?.endsWith('_'));passAll();}
 return game;
}
