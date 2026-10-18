import { describe, expect, it } from 'vitest';
import { acceptedSettlementSounds } from '../../../src/online/client/settlement-sounds';
import { NativeSettlementAudio } from '../../../src/online/client/native-settlement-audio';
import type { RoomView } from '../../../src/online/domain/types';
const before={id:'r',variant:'yonma',mySeat:0,status:'playing',version:1,game:{gameInstanceId:'g',handId:1,decisionId:'a',players:[0,1,2,3].map(seat=>({seat}))}} as unknown as RoomView;
const after={...before,version:2,game:{...before.game!,decisionId:'b',settlement:{kind:'win',winnerSeat:0,yaku:[{name:'立直',han:1},{name:'平和',han:1}],points:2000},settlementFlow:{id:'f',stage:'detail',detailIndex:0,detailCount:1,elapsedMs:0,oldScores:[25000,25000,25000,25000],delta:[2000,-2000,0,0],newScores:[27000,23000,25000,25000]}}} as RoomView;
function harness(){
 let now=0,serial=0;const timers=new Map<number,{at:number;run:()=>void}>(),played:string[]=[],destroyed:string[]=[];
 const audio=new NativeSettlementAudio({sources:{yaku:'yaku.wav','hand-value':'value.wav','score-roll':'score.wav'},createInnerAudioContext:()=>({src:'',autoplay:false,loop:false,obeyMuteSwitch:true,volume:1,play(){played.push(this.src);},stop(){},destroy(){destroyed.push(this.src);}}),clock:{now:()=>now,setTimeout:(run,delay)=>{timers.set(++serial,{at:now+delay,run});return serial;},clearTimeout:id=>{timers.delete(id as number);}}});
 return {audio,played,destroyed,timers,tick:(time:number)=>{now=time;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.run();}}};
}
describe('native result audio lifecycle',()=>{
 it('requires a current interaction, follows each shared reveal, and never replays a same-phase update',()=>{
  const h=harness();h.audio.update(before,true,true,true);h.audio.update(after,true,true,true);h.tick(2000);expect(h.played).toEqual([]);
  h.audio.invalidate();h.audio.activateFromGesture();h.audio.update(before,true,true,true);h.audio.update(after,true,true,true);
  h.tick(2300);expect(h.played).toEqual(['yaku.wav']);
  h.audio.update({...after,version:3},true,true,true);
  h.tick(2900);expect(h.played).toEqual(['yaku.wav','yaku.wav']);
  h.tick(3500);expect(h.played).toEqual(['yaku.wav','yaku.wav','value.wav']);
 });
 it.each(['mute','hide','disconnect','dispose'] as const)('cancels every pending cue after %s and leaves resumed snapshots silent',action=>{
  const h=harness();h.audio.activateFromGesture();h.audio.update(before,true,true,true);h.audio.update(after,true,true,true);
  const stale=[...h.timers.values()][0].run;
  if(action==='mute')h.audio.setEnabled(false);
  if(action==='hide')h.audio.invalidate();
  if(action==='disconnect')h.audio.update(after,false,true,true);
  if(action==='dispose')h.audio.dispose();
  expect(h.timers.size).toBe(0);stale();h.tick(4000);expect(h.played).toEqual([]);
  if(action!=='dispose'){h.audio.setEnabled(true);h.audio.update(after,true,true,true);h.tick(5000);expect(h.played).toEqual([]);}
 });
 it('keeps future cues when polling arrives after the first role',()=>{
  const h=harness();h.audio.activateFromGesture();h.audio.update(before,true,true,true);
  h.audio.update({...after,game:{...after.game!,settlementFlow:{...after.game!.settlementFlow!,elapsedMs:500}}},true,true,true);
  expect(h.timers.size).toBe(2);
  h.tick(400);expect(h.played).toEqual(['yaku.wav']);
  h.tick(1000);expect(h.played).toEqual(['yaku.wav','value.wav']);
 });
 it('drops stalled callbacks instead of sounding several old roles together',()=>{
  const h=harness();h.audio.activateFromGesture();h.audio.update(before,true,true,true);h.audio.update(after,true,true,true);
  h.tick(1450);expect(h.played).toEqual([]);
  h.tick(1500);expect(h.played).toEqual(['value.wav']);
  h.audio.dispose();expect(h.destroyed).toEqual(['value.wav']);
 });
 it('cancels queued cues if a version goes backward or a new hand breaks continuity',()=>{
  for(const changed of [{...after,version:1},{...after,version:3,game:{...after.game!,handId:2}}]){
   const h=harness();h.audio.activateFromGesture();h.audio.update(before,true,true,true);h.audio.update(after,true,true,true);h.audio.update(changed,true,true,true);h.tick(1500);expect(h.played).toEqual([]);
  }
 });
});


describe('native live polling continuity',()=>{
 it('accepts only future role cues across normal polling version gaps and keeps them on another same-phase gap',()=>{
  const h=harness();h.audio.activateFromGesture();h.audio.update(before,true,true,false);
  const polled={...after,version:5,game:{...after.game!,settlementFlow:{...after.game!.settlementFlow!,elapsedMs:500}}};
  h.audio.update(polled,true,true,true);
  expect(h.timers.size).toBe(2);
  h.tick(200);h.audio.update({...polled,version:9},true,true,true);
  expect(h.timers.size).toBe(2);
  h.tick(400);expect(h.played).toEqual(['yaku.wav']);
  h.tick(1000);expect(h.played).toEqual(['yaku.wav','value.wav']);
 });
 it('leaves browser version-gap rejection intact while native polling requires increasing versions',()=>{
  const gap={...after,version:5};
  expect(acceptedSettlementSounds(before,gap)).toEqual([]);
  expect(acceptedSettlementSounds(before,gap,{allowVersionGap:true})).toHaveLength(3);
  expect(acceptedSettlementSounds(before,{...gap,version:1},{allowVersionGap:true})).toEqual([]);
 });
 it('treats the first, explicitly non-live and recovered snapshots as silent baselines',()=>{
  for(const reset of ['first','non-live','hide','disconnect']){
   const h=harness();h.audio.activateFromGesture();
   if(reset!=='first')h.audio.update(before,true,true,true);
   if(reset==='hide')h.audio.invalidate();
   if(reset==='disconnect')h.audio.update(before,false,true,true);
   h.audio.update(after,true,true,reset!=='non-live');
   expect(h.timers.size).toBe(0);h.tick(1500);expect(h.played).toEqual([]);
  }
 });
 it('uses a silent baseline after more than five seconds without a successful update',()=>{
  const h=harness();h.audio.activateFromGesture();h.audio.update(before,true,true,true);
  h.tick(5001);h.audio.update(after,true,true,true);
  expect(h.timers.size).toBe(0);h.tick(5301);expect(h.played).toEqual([]);
 });
});
