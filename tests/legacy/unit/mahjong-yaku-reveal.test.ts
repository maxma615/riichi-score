// @vitest-environment jsdom

import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as timing from '../../../src/online/client/settlement-presentation';
import { acceptedSettlementSounds } from '../../../src/online/client/settlement-sounds';
import { MahjongSettlementPanel } from '../../../src/online/client/mahjong-settlement-panel';
import type { RoomView, Settlement, SettlementFlow } from '../../../src/online/domain/types';

const settlement = {kind:'win',name:'荣和',winnerSeat:0,winMethod:'ron',yaku:Array.from({length:17},(_,i)=>({name:`役${i+1}`,han:1})),han:17,fu:30,points:32000,delta:[32000,-32000,0,0],uraIndicators:[]} as Settlement;
const flow = {id:'result',stage:'detail',detailIndex:0,detailCount:1,elapsedMs:0,oldScores:[25000,25000,25000,25000],newScores:[57000,-7000,25000,25000],delta:settlement.delta} as SettlementFlow;
const players = flow.oldScores.map((score,seat)=>({seat,score,discards:[],melds:[],name:`玩家${seat}`}));
const before = {id:'room',variant:'yonma',mySeat:0,status:'playing',version:10,members:[],game:{gameInstanceId:'match',handId:1,decisionId:'before',players}} as unknown as RoomView;
function room(age=0):RoomView {return {...before,version:11,game:{...before.game!,decisionId:'result',settlement,settlementFlow:{...flow,elapsedMs:age},choices:[{type:'ack',id:'ack'}],doraIndicators:[]}};}
function html(age:number) { const r=room(age);return renderToStaticMarkup(createElement(MahjongSettlementPanel,{game:r.game!,room:r,connected:true,busy:false,onChoice:()=>{}})); }
const miniRequire=createRequire(resolve('miniprogram/utils/online-settlement.js'));
const module={exports:{} as {presentation:(game:unknown,seats:unknown,age:number)=>any}};
vm.runInNewContext(readFileSync(resolve('miniprogram/utils/online-settlement.js'),'utf8'),{module,require:(s:string)=>s==='./online-timing'?timing:miniRequire(s)});

describe('readable sequential win breakdown',()=>{
 it('keeps every row distinct beyond fifteen roles and delays the total until the final row has had time to read',()=>{
  const boundaries=timing.presentationBoundaries(flow,settlement);
  expect(boundaries).toContain(9300);
  expect(boundaries).toContain(9900);
  expect(timing.detailValueAt(settlement)).toBe(10500);
  expect(timing.confirmationAt(flow,settlement)).toBe(11100);
  const early=module.exports.presentation(room(9299).game,players,9299);
  expect(early.yaku.filter((y:any)=>y.visible)).toHaveLength(15);
  expect(early.pointsVisible).toBe(false);
  expect(early.yaku.filter((y:any)=>y.current).map((y:any)=>y.name)).toEqual(['役15']);
  expect(module.exports.presentation(room(9300).game,players,9300).yaku.filter((y:any)=>y.visible)).toHaveLength(16);
  const last=module.exports.presentation(room(9900).game,players,9900);
  expect(last.yaku.filter((y:any)=>y.visible)).toHaveLength(17);
  expect(last.pointsVisible).toBe(false);
  expect(module.exports.presentation(room(10500).game,players,10500).pointsVisible).toBe(true);
  expect(module.exports.presentation(room(10500).game,players,10500).yaku.some((y:any)=>y.current)).toBe(false);
 });
 it('hides total han and fu with the point value until all role rows have appeared on web',()=>{
  expect(html(0)).toMatch(/mahjong-settlement-panel__summary is-pending/);
  expect(html(10500)).toMatch(/mahjong-settlement-panel__summary is-revealed/);
  expect(html(9299)).toMatch(/aria-hidden="true"[^>]*><span>役16/);
  expect(html(9300)).toMatch(/aria-hidden="false"[^>]*><span>役16/);
 });
 it('schedules one audible cue per row and a final total with the same pacing',()=>{
  const cues=acceptedSettlementSounds(before,room());
  expect(cues.filter(c=>c.kind==='yaku')).toHaveLength(17);
  expect(cues.filter(c=>c.kind==='yaku').map(c=>c.atMs)).toEqual([300,900,1500,2100,2700,3300,3900,4500,5100,5700,6300,6900,7500,8100,8700,9300,9900]);
  expect(cues.find(c=>c.kind==='hand-value')?.atMs).toBe(10500);
 });
 it('never reconstructs role audio from snapshots, version gaps, same-phase updates or past cues',()=>{
  const after=room();
  expect(acceptedSettlementSounds(null,after)).toEqual([]);
  expect(acceptedSettlementSounds(before,{...after,version:12})).toEqual([]);
  expect(acceptedSettlementSounds(after,{...after,version:12})).toEqual([]);
  expect(acceptedSettlementSounds(before,room(301)).map(c=>c.atMs)).toEqual([900,1500,2100,2700,3300,3900,4500,5100,5700,6300,6900,7500,8100,8700,9300,9900,10500]);
  expect(acceptedSettlementSounds({...before,game:{...before.game!,handId:2}},after)).toEqual([]);
 });
});
