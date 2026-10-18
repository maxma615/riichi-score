import { describe, expect, it } from 'vitest';
import { physicalEngine } from '../fixtures/mahjong-settlement-game';
import { kakanSoundFixture } from '../fixtures/mahjong-audio-game';
import type { RoomView, GameVariant } from '../../../src/online/domain/types';

import { table3dLayout as layout } from '../../../src/online/client/table3d-layout';

function room(variant: GameVariant = 'yonma', ownSeat = 0): RoomView {
  return { id: 'physical-room', code: 'ABCDEFGH', hostUserId: 'A', variant, mode: 'east', status: 'playing', version: 1, mySeat: ownSeat, members: [], game: physicalEngine(variant, {0:'p123456789s123z2'}, 'z2').view(ownSeat) };
}
function isolated(seat = 1, variant: GameVariant = 'yonma') {
  const r = room(variant);
  r.game!.players = r.game!.players.filter(p => p.seat === seat).map(p => ({...p, handCount: 0, discards: [], melds: []}));
  return r;
}
// Tests use the same documented XYZ Euler convention as Three's mesh.rotation.
function rotated(v: number[], [x,y,z]: number[]) {
  const a = [v[0]*Math.cos(z)-v[1]*Math.sin(z), v[0]*Math.sin(z)+v[1]*Math.cos(z), v[2]];
  const b = [a[0]*Math.cos(y)+a[2]*Math.sin(y), a[1], -a[0]*Math.sin(y)+a[2]*Math.cos(y)];
  return [b[0], b[1]*Math.cos(x)-b[2]*Math.sin(x), b[1]*Math.sin(x)+b[2]*Math.cos(x)];
}
function bounds(piece: ReturnType<typeof layout>[number]) {
  const vertices = [-.475,.475].flatMap(x => [-.675,.675].flatMap(y => [-.3,.3].map(z => rotated([x,y,z],piece.rotation).map((n,i)=>n+piece.position[i]))));
  return [0,1,2].map(i => [Math.min(...vertices.map(v=>v[i])),Math.max(...vertices.map(v=>v[i]))]);
}

describe('physical table world layout', () => {
  it.each(['sanma','yonma'] as const)('keeps actual engine opponent hands private and standing around each %s edge', variant => {
    const r=room(variant), pieces=layout(r,0), hands=pieces.filter(p=>p.kind==='concealed');
    expect(hands).toHaveLength(variant==='sanma'?26:39);
    expect(hands.every(p=>p.seat!==0 && p.faceDown && p.value===undefined)).toBe(true);
    for(const p of hands){expect(p.position[1]).toBe(.675);expect(bounds(p)[1][0]).toBeCloseTo(0);}
    const east=hands.find(p=>p.seat===1)!;
    expect(east.position[0]).toBe(13);expect(rotated([0,0,1],east.rotation)).toEqual([1,0,expect.closeTo(0)]);
    const west=hands.find(p=>p.seat===(variant==='sanma'?2:3))!;
    expect(west.position[0]).toBe(-13);expect(rotated([0,0,1],west.rotation)).toEqual([-1,0,expect.closeTo(0)]);
    if(variant==='yonma'){const north=hands.find(p=>p.seat===2)!;expect(north.position[2]).toBe(-10.5);expect(rotated([0,0,1],north.rotation)).toEqual([expect.closeTo(0),0,-1]);}
  });
  it('rotates relative seats for a different owner and leaves own interactive rack to the DOM',()=>{
    const r=room('yonma',2),pieces=layout(r,2);
    expect(pieces.filter(p=>p.kind==='concealed')).toHaveLength(40);
    expect(pieces.some(p=>p.kind==='concealed'&&p.seat===2)).toBe(false);
    expect(pieces.find(p=>p.seat===3)!.position[0]).toBe(13);
    expect(pieces.find(p=>p.seat===0)!.position[2]).toBe(-10.5);
  });
  it('reveals four-tile dealing waves without changing the eventual rack coordinates',()=>{
    const r=room(),full=layout(r,0);
    for(const [age,count]of [[0,12],[299,12],[300,24],[600,36],[900,39]] as const){
      const dealing=layout(r,0,{openingAge:age});expect(dealing).toHaveLength(count);
      for(const p of dealing)expect(p.position).toEqual(full.find(q=>q.id===p.id)!.position);
    }
  });
  it('keeps a drawn tile physically separate from the thirteen closed tiles',()=>{
    const r=room('yonma',1),hand=layout(r,1).filter(p=>p.seat===0&&p.kind==='concealed');
    expect(hand).toHaveLength(14);
    const along=hand.map(p=>-p.position[2]);
    expect(Math.abs(along[13]-along[12])).toBeGreaterThan(Math.abs(along[12]-along[11])+.15);
  });
  it('places claimed riichi on the next visible tile and preserves event identities during flight',()=>{
    const r=isolated(0);r.game!.players[0].discards=['p1','p2*+','p3-','p4','p5','p6','p7','p8','p9'];
    const pieces=layout(r,0),river=pieces.filter(p=>p.kind==='river');
    expect(river.map(p=>p.value)).toEqual(['p1','p4','p5','p6','p7','p8','p9']);
    expect(river[1].rotation[2]-river[0].rotation[2]).toBeCloseTo(Math.PI/2);
    expect(river[2].rotation[2]).toBe(river[0].rotation[2]);
    expect(river.slice(0,6).every(p=>p.position[2]===river[0].position[2])).toBe(true);
    expect(river[6].position[2]).toBeGreaterThan(river[0].position[2]);
    expect(river[1].eventId).toBe(`discard:physical-room:${r.game!.gameInstanceId}:1:0:3`);
    const hidden=layout(r,0,{hiddenEventIds:new Set([river[1].eventId!])});
    expect(hidden).toHaveLength(6);
    for(const p of hidden)expect(p.position).toEqual(river.find(q=>q.id===p.id)!.position);
    for(const p of river){expect(rotated([0,0,1],p.rotation)[1]).toBeCloseTo(1);expect(bounds(p)[1][0]).toBeCloseTo(0);}
    expect(bounds(river[0])[0][1]).toBeLessThanOrEqual(bounds(river[1])[0][0]);
  });
  it('renders real engine closed kan as exactly four physical pieces with two orange backs up',()=>{
    const game=physicalEngine('yonma',{0:'p111s123456789z1'},'p1');
    const v=game.view(0);game.respond(0,v.decisionId,'kan:p1111');
    const r=room();r.game=game.view(1);const pieces=layout(r,1).filter(p=>p.seat===0);
    expect(pieces.filter(p=>p.kind==='concealed')).toHaveLength(11);
    const kan=pieces.filter(p=>p.kind==='meld');expect(kan).toHaveLength(4);
    expect(kan.filter(p=>p.faceDown)).toHaveLength(2);
    expect(kan.filter(p=>!p.faceDown).map(p=>p.value)).toEqual(['p1','p1']);
    for(const p of kan){expect(bounds(p)[1][0]).toBeCloseTo(0);expect(rotated([0,0,1],p.rotation)[1]).toBeCloseTo(p.faceDown?-1:1);}
  });
  it('stacks the real engine added-kan fourth tile above its original called tile',()=>{
    const game=kakanSoundFixture(false),v=game.view(1),kan=v.choices.find(c=>c.type==='kan')!;
    expect(kan).toBeDefined();game.respond(1,v.decisionId,kan.id);
    const r=room();r.game=game.view(0);const tiles=layout(r,0).filter(p=>p.seat===1&&p.kind==='meld');
    expect(tiles).toHaveLength(4);const top=tiles.find(p=>p.position[1]>.6)!;
    expect(top.position[1]).toBeCloseTo(.9);
    const below=tiles.find(p=>p.id!==top.id&&p.position[0]===top.position[0]&&p.position[2]===top.position[2])!;
    expect(below).toBeDefined();expect(below.rotation).toEqual(top.rotation);expect(top.position[1]-below.position[1]).toBeCloseTo(.6);
  });
  it.each(['p123-','p111+','p1111=','p505-5'])('keeps every public physical tile for %s and lays the called tile sideways', meld=>{
    const r=isolated();r.game!.players[0].melds=[meld];const pieces=layout(r,0);
    expect(pieces).toHaveLength(meld==='p123-'||meld==='p111+'?3:4);
    expect(pieces.every(p=>p.kind==='meld'&&!p.faceDown)).toBe(true);
    expect(pieces.some(p=>Math.abs(rotated([1,0,0],p.rotation)[0])>.99)).toBe(true);
    for(const p of pieces)expect(rotated([0,0,1],p.rotation)[1]).toBeCloseTo(1);
    if(meld==='p505-5')expect(pieces.filter(p=>p.value==='p0')).toHaveLength(1);
  });
  it('fits four kans plus remaining concealed tiles along a shared edge without overlapping',()=>{
    const r=isolated();r.game!.players[0].handCount=2;r.game!.players[0].melds=['p1111+','p2222=','s3333-','s4444'];
    const pieces=layout(r,0);expect(pieces).toHaveLength(18);
    for(const p of pieces){const b=bounds(p);expect(b[0][0]).toBeGreaterThan(-17);expect(b[0][1]).toBeLessThan(17);expect(b[2][0]).toBeGreaterThan(-13);expect(b[2][1]).toBeLessThan(13);}
    const along=pieces.map(p=>bounds(p)[2]).sort((a,b)=>a[0]-b[0]);
    for(let i=1;i<along.length;i++)expect(along[i][0]).toBeGreaterThanOrEqual(along[i-1][1]-.00001);
  });
  it('renders at most four real North pieces on the owner side and outside the rack footprint',()=>{
    const r=isolated(0,'sanma');r.game!.players[0].nuki=4;
    const pieces=layout(r,0);expect(pieces).toHaveLength(4);expect(pieces.map(p=>p.value)).toEqual(['z4','z4','z4','z4']);
    for(const p of pieces){expect(p.kind).toBe('nuki');expect(rotated([0,0,1],p.rotation)[1]).toBeCloseTo(1);expect(bounds(p)[1][0]).toBeCloseTo(0);expect(p.position[2]).toBeGreaterThan(7);expect(p.position[2]).toBeLessThan(10);}
  });
  it('decodes public red-five closed tiles without duplicating encoded melds or keeping hidden backs',()=>{
    const r=isolated();r.game!.players[0].handCount=10;r.game!.players[0].melds=['s111-'];
    const pieces=layout(r,0,{revealedHands:[{seat:1,hand:'p123405789z2,s111-'}]});
    const revealed=pieces.filter(p=>p.kind==='revealed');expect(revealed.map(p=>p.value)).toEqual(['p1','p2','p3','p4','p0','p5','p7','p8','p9','z2']);
    expect(pieces.some(p=>p.kind==='concealed')).toBe(false);expect(pieces.filter(p=>p.kind==='meld')).toHaveLength(3);
    for(const p of revealed){expect(p.faceDown).toBe(false);expect(rotated([0,0,1],p.rotation)[1]).toBeCloseTo(1);}
  });
  it('has no pieces before a game exists',()=>{const r=room();r.game=null;expect(layout(r,0)).toEqual([]);});
});
