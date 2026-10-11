import { describe, expect, it } from "vitest";
import { SanmaGame } from "../../../src/online/domain/sanma";
import { SanmaWall, sanmaTiles } from "../../../src/online/domain/sanma-wall";
import Majiang from "@kobalab/majiang-core";
import { sanmaPayment, tenpaiPayment, scoreSanma } from "../../../src/online/domain/sanma-scoring";

const names = ["A", "B", "C"];
describe("genuine three-seat Sanma", () => {
  it("publishes an opaque game identity and advances its hand identity after settlement", () => {
    const game = new SanmaGame("east", names, fixture({ 0: "p123456789s123z2" }, ["z2"]));
    const opening = game.view(0);
    expect(opening.gameInstanceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(opening.handId).toBe(1);
    expect(opening.choices.some(choice => choice.type === "tsumo")).toBe(true);
    game.respond(0, opening.decisionId, "tsumo");
    for (const seat of [0, 1, 2]) {
      const view = game.view(seat);
      game.respond(seat, view.decisionId, "ack");
    }
    const nextHand = game.view(0);
    expect(nextHand.gameInstanceId).toBe(opening.gameInstanceId);
    expect(nextHand.handId).toBe(2);
  });

  it("uses exactly 108 physical tiles and a 14-tile dead wall", () => {
    const tiles = sanmaTiles();
    expect(tiles).toHaveLength(108);
    expect(tiles.filter(p => /^m[02-8]$/.test(p))).toEqual([]);
    expect(tiles.filter(p => p === "p0")).toHaveLength(1);
    expect(tiles.filter(p => p === "s0")).toHaveLength(1);
    const wall = new SanmaWall(tiles);
    expect(wall.remaining).toBe(94);
    expect(() => new SanmaWall([...tiles.slice(1), "p0"])).toThrow();
  });
  it("deals only three real seats and refuses fabricated/stale decisions", () => {
    const game = new SanmaGame("east", names, { dealer: 1 });
    expect([0,1,2].map(s => game.view(s).hand.length).sort()).toEqual([13,13,14]);
    const v = game.view(1);
    expect(v.remainingTiles).toBe(54);
    expect(v.players.map(p => p.score)).toEqual([35000,35000,35000]);
    expect(v.players.map(p => p.wind).sort()).toEqual([0,1,2]);
    expect(Object.keys(v.players[1]).sort()).toEqual(["discards","handCount","hasDrawnTile","melds","nuki","riichi","score","seat","wind"]);
    expect(() => game.view(3)).toThrow();
    expect(() => game.respond(0, v.decisionId, "discard:z1")).toThrow();
    expect(() => game.respond(1, v.decisionId, "chi:p123-")).toThrow();
    game.respond(1,v.decisionId,v.choices.find(c => c.type === "discard")!.id);
    expect(() => game.respond(1,v.decisionId,"discard:z1")).toThrow();
  });
  it("calculates three-player mangan, honba and noten payments", () => {
    expect(sanmaPayment({base:2000,winner:1,dealer:0})).toEqual([-4000,6000,-2000]);
    expect(sanmaPayment({base:2000,winner:0,dealer:0,honba:2,sticks:1})).toEqual([9400,-4200,-4200]);
    expect(sanmaPayment({base:2000,winner:1,dealer:0,loser:2,honba:2})).toEqual([0,8400,-8400]);
    expect(tenpaiPayment([1])).toEqual([-1500,3000,-1500]);
    expect(tenpaiPayment([0,2])).toEqual([1500,-3000,1500]);
    expect(tenpaiPayment([])).toEqual([0,0,0]);
    expect(tenpaiPayment([0,1,2])).toEqual([0,0,0]);
  });
  it.each(["east", "hanchan"] as const)("plays a full %s through actual settlements and ranking", mode => {
    const game = new SanmaGame(mode,names,{dealer:0,wallFactory:()=>new SanmaWall(sanmaTiles())});
    const rounds = new Set<string>();
    for(let move=0;move<6000&&!game.view(0).ranking;move++) {
      const v=game.view(0); rounds.add(`${v.roundWind}:${v.roundNumber}`);
      expect(v.players.reduce((s,p)=>s+p.score,0)+v.riichiSticks*1000).toBe(105000);
      let acted=false;
      for(let seat=0;seat<3;seat++) {
        const own=game.view(seat);
        expect(own.choices.some(c=>c.type==="chi")).toBe(false);
        const choice=own.choices.find(c=>c.type==="pass")??own.choices.find(c=>c.type==="discard")??own.choices.find(c=>c.type==="ack");
        if(choice) {game.respond(seat,own.decisionId,choice.id);acted=true;}
      }
      expect(acted).toBe(true);
    }
    expect(game.view(0).ranking).toHaveLength(3);
    expect(rounds.size).toBe(mode==="east"?3:6);
    expect(game.view(0).players.reduce((s,p)=>s+p.score,0)).toBe(105000);
  });
});

function tiles(encoded:string) {return [...encoded.matchAll(/([mpsz])(\d+)/g)].flatMap(m=>[...m[2]].map(n=>m[1]+n));}
function fixture(hands:Record<number,string>,draws:string[],reserve:string[]=[],indicators:string[]=[]) {
  return {dealer:0,wallFactory:()=>{
    const available=sanmaTiles();
    const take=(tile:string)=>{const i=available.indexOf(tile);if(i<0)throw new Error(`Impossible fixture: ${tile}`);available.splice(i,1);return tile;};
    const dealt=[0,1,2].map(s=>hands[s]?tiles(hands[s]).map(take):[]);
    const drawn=draws.map(take),replacement=reserve.map(take),indicator=indicators.map(take);
    for(const hand of dealt){if(!hand.length)hand.push(...available.splice(0,13));expect(hand).toHaveLength(13);}
    replacement.push(...available.splice(0,4-replacement.length));indicator.push(...available.splice(0,10-indicator.length));
    return new SanmaWall([...dealt.flat(),...drawn,...available,...replacement,...indicator]);
  }};
}
function act(game:SanmaGame,seat:number,id:string) {const v=game.view(seat);game.respond(seat,v.decisionId,id);}
function passAll(game:SanmaGame) {for(let s=0;s<3;s++)if(game.view(s).choices.some(c=>c.type==="pass"))act(game,s,"pass");}

function screenshotCase() {
  const hands = {
    0: "m199p6789s123z123",
    1: "p23345s456678z44",
    2: "m119p23789s246z12"
  };
  const available = sanmaTiles();
  const take = (tile: string) => {
    const index = available.indexOf(tile);
    if (index < 0) throw new Error(`Impossible screenshot fixture tile: ${tile}`);
    return available.splice(index, 1)[0];
  };
  for (const hand of [hands[0], hands[1], hands[2]]) for (const tile of tiles(hand)) take(tile);
  const reserve = ["z5", "z5", "z6", "z6"];
  reserve.forEach(take);
  const indicators = ["z5"];
  indicators.forEach(take);
  const draws = [take("m1")];
  for (let i = 0; i < 28; i++) {
    const index = available.findIndex(tile => tile !== "p1" && tile !== "p4");
    if (index < 0) throw new Error("Not enough safe fixture draws");
    draws.push(available.splice(index, 1)[0]);
  }
  draws.push(take("p1"));
  return { hands, draws, reserve, indicators };
}

describe("Sanma special rules with physical fixtures",()=>{
  it("draws all eight replacements without ever consuming any indicator or duplicating a tile",()=>{
    const ordered=sanmaTiles(),wall=new SanmaWall(ordered),dealt=Array.from({length:40},()=>wall.draw());
    const indicatorSlots=ordered.slice(98),replacement:string[]=[];
    for(let i=0;i<8;i++)replacement.push(wall.replace(i<4));
    expect(wall.canReplace).toBe(false);expect(wall.canKan).toBe(false);
    expect(wall.dora).toEqual(indicatorSlots.filter((_,i)=>i%2===0));
    expect(wall.ura).toEqual(indicatorSlots.filter((_,i)=>i%2===1));
    expect(wall.remaining).toBe(46);
    const remaining=Array.from({length:wall.remaining},()=>wall.draw());
    // Four final reserve tiles were refilled from the live tail and stay dead.
    const deadReserve=ordered.slice(86,90).reverse();
    expect([...dealt,...replacement,...remaining,...indicatorSlots,...deadReserve].sort()).toEqual(ordered.sort());
    expect(()=>wall.replace(false)).toThrow();
  });
  it("keeps completed open kans separate from revealed Dora/Ura and reserves the fifth Kan boundary",()=>{
    const ordered=sanmaTiles(),wall=new SanmaWall(ordered),dealt=Array.from({length:40},()=>wall.draw()),replacement:string[]=[];
    const indicatorSlots=ordered.slice(98);
    for(let kan=0;kan<4;kan++) {
      if(kan)wall.revealPendingKanDora();
      replacement.push(wall.replace(true,false));
      expect(wall.dora).toEqual(indicatorSlots.filter((_,i)=>i%2===0).slice(0,kan+1));
      expect(wall.ura).toEqual(indicatorSlots.filter((_,i)=>i%2===1).slice(0,kan+1));
    }
    expect(wall.canKan).toBe(false);
    expect(wall.canReplace).toBe(true);
    expect(wall.dora).toHaveLength(4);
    wall.revealPendingKanDora();
    expect(wall.dora).toEqual(indicatorSlots.filter((_,i)=>i%2===0));
    expect(wall.ura).toEqual(indicatorSlots.filter((_,i)=>i%2===1));
    replacement.push(...Array.from({length:4},()=>wall.replace(false)));
    expect(wall.canReplace).toBe(false);
    const remaining=Array.from({length:wall.remaining},()=>wall.draw());
    const deadReserve=ordered.slice(86,90).reverse();
    expect([...dealt,...replacement,...remaining,...indicatorSlots,...deadReserve].sort()).toEqual(ordered.sort());
  });
  it("allows a last-live open-kan replacement, then blocks draws and waits to expose its indicator",()=>{
    const ordered=sanmaTiles(),wall=new SanmaWall(ordered);
    for(let i=0;i<93;i++)wall.draw();
    expect(wall.remaining).toBe(1);expect(wall.canKan).toBe(true);
    expect(wall.replace(true,false)).toBe(ordered[94]);
    expect(wall.remaining).toBe(0);expect(wall.canReplace).toBe(false);expect(wall.canKan).toBe(false);
    expect(wall.dora).toEqual([ordered[98]]);expect(wall.ura).toEqual([ordered[99]]);
    expect(()=>wall.draw()).toThrow("Live wall exhausted");
    wall.revealPendingKanDora();
    expect(wall.dora).toEqual([ordered[98],ordered[100]]);
    expect(wall.ura).toEqual([ordered[99],ordered[101]]);
  });
  it("offers North extraction with no new dora and scores its replacement without restoring first-turn status",()=>{
    const game=new SanmaGame("east",names,fixture({0:"p123456789s123z2"},["z4"],["z2"]));
    const before=game.view(0);expect(before.choices.some(c=>c.type==="nuki")).toBe(true);
    act(game,0,"nuki");passAll(game);
    const v=game.view(0);expect(v.players[0].nuki).toBe(1);expect(v.hand).toHaveLength(14);
    expect(v.remainingTiles).toBe(53);expect(v.doraIndicators).toEqual(before.doraIndicators);
    expect(v.choices.some(c=>c.type==="tsumo")).toBe(true);
    expect([0,1,2].map(seat=>game.view(seat).settlement)).toEqual([null,null,null]);
    act(game,0,"tsumo");
    const settlement=game.view(0).settlement!;
    expect(settlement).toMatchObject({kind:"win",winnerSeat:0,winMethod:"tsumo",winningTile:"z2"});
    expect(settlement).toMatchObject({fu:30,han:6,points:12000,delta:[12000,-6000,-6000]});
    expect(settlement.delta.reduce((sum,points)=>sum+points,0)).toBe(0);
    const settlementViews=[0,1,2].map(seat=>game.view(seat));
    expect(settlementViews.every(view=>view.settlement?.hand===settlement.hand)).toBe(true);
    expect(settlementViews.map(view=>view.settlement?.winMethod)).toEqual(["tsumo","tsumo","tsumo"]);
    const yaku=settlement.yaku.map(y=>y.name);
    expect(yaku).toContain("抜きドラ");expect(yaku).toContain("嶺上開花");expect(yaku).not.toContain("天和");
  });
  it("awards rinshan only for a winning North replacement, including an open hand whose only yaku is rinshan",()=>{
    const options=fixture({0:"m11p12s123456z77z4"},["s9","m1","z1","z2","p2"],["p3"]);
    const game=new SanmaGame("east",names,options);
    act(game,0,"discard:s9_");
    act(game,1,"discard:m1_");
    const pon=game.view(0).choices.find(choice=>choice.type==="pon");
    expect(pon).toBeDefined();act(game,0,pon!.id);passAll(game);
    act(game,0,"discard:p2");passAll(game);
    act(game,1,"discard:z1_");passAll(game);
    act(game,2,"discard:z2_");passAll(game);
    expect(game.view(0).drawnTile).toBe("p2");
    expect(game.view(0).choices.some(choice=>choice.type==="tsumo")).toBe(false);
    act(game,0,"nuki");passAll(game);

    const replacement=game.view(0);
    expect(replacement.phase).toBe("nukizimo");
    expect(replacement.drawnTile).toBe("p3");
    expect(replacement.choices.some(choice=>choice.type==="tsumo")).toBe(true);
    act(game,0,"tsumo");
    const settlement=game.view(0).settlement!;
    expect(settlement).toMatchObject({fu:30,han:2,points:2000,delta:[2000,-1000,-1000]});
    expect(settlement.delta.reduce((sum,points)=>sum+points,0)).toBe(0);
    expect(settlement.yaku.map(yaku=>yaku.name)).toContain("嶺上開花");
    expect(settlement.yaku.map(yaku=>yaku.name).filter(name=>name!=="抜きドラ"&&name!=="ドラ")).toEqual(["嶺上開花"]);

    const ordinary=new SanmaGame("east",names,fixture({0:"m11p12s123456z77z4"},["s9","m1","z1","z2","p3"]));
    act(ordinary,0,"discard:s9_");act(ordinary,1,"discard:m1_");
    const ordinaryPon=ordinary.view(0).choices.find(choice=>choice.type==="pon")!;
    act(ordinary,0,ordinaryPon.id);passAll(ordinary);
    act(ordinary,0,"discard:z4");passAll(ordinary);
    act(ordinary,1,"discard:z1_");passAll(ordinary);
    act(ordinary,2,"discard:z2_");passAll(ordinary);
    expect(ordinary.view(0).drawnTile).toBe("p3");
    expect(ordinary.view(0).phase).toBe("zimo");
    expect(ordinary.view(0).choices.some(choice=>choice.type==="tsumo")).toBe(false);
  });
  it("publishes a shared draw flag for a real replacement draw and clears it on discard",()=>{
    const game=new SanmaGame("east",names,fixture({0:"p123456789s123z2"},["z4"],["z2"]));
    const openingViews=[0,1,2].map(seat=>game.view(seat));
    expect(openingViews[0].drawnTile).toBe("z4");
    expect(openingViews.map(view=>view.players.map(player=>player.hasDrawnTile))).toEqual([[true,false,false],[true,false,false],[true,false,false]]);
    expect(openingViews.every(view=>view.players.every(player=>typeof player.hasDrawnTile==="boolean"))).toBe(true);
    expect(JSON.stringify(openingViews.map(view=>view.players)).includes("z4")).toBe(false);

    act(game,0,"nuki");passAll(game);
    const replacementViews=[0,1,2].map(seat=>game.view(seat));
    expect(replacementViews[0].drawnTile).toBe("z2");
    expect(replacementViews.map(view=>view.players.map(player=>player.hasDrawnTile))).toEqual([[true,false,false],[true,false,false],[true,false,false]]);
    expect(JSON.stringify(replacementViews.map(view=>view.players)).includes("z2")).toBe(false);

    const replacement=replacementViews[0],discard=replacement.choices.find(choice=>choice.type==="discard");
    expect(discard).toBeDefined();
    game.respond(0,replacement.decisionId,discard!.id);
    const afterDiscardViews=[0,1,2].map(seat=>game.view(seat));
    expect(afterDiscardViews.every(view=>view.players.find(player=>player.seat===0)?.hasDrawnTile===false)).toBe(true);
    expect(afterDiscardViews.map(view=>view.players.map(player=>player.hasDrawnTile))).toEqual([0,1,2].map(()=>afterDiscardViews[0].players.map(player=>player.hasDrawnTile)));
  });
  it("allows ordinary north robbery without adding chankan, and passed ron causes temporary furiten",()=>{
    const options=fixture({0:"m19p222s444z11444",1:"p123456789s123z4"},["s8"],["s9","s7"]);
    const game=new SanmaGame("east",names,options);
    act(game,0,"nuki");expect(game.view(1).choices.some(c=>c.type==="ron")).toBe(true);
    act(game,1,"ron");passAll(game);
    const settlement=game.view(1).settlement!;
    expect(settlement).toMatchObject({kind:"win",winnerSeat:1,winMethod:"ron",winningTile:"z4"});
    expect([0,1,2].map(seat=>game.view(seat).settlement?.winMethod)).toEqual(["ron","ron","ron"]);
    expect(settlement.yaku.map(y=>y.name)).not.toContain("槍槓");
    expect(settlement.yaku.map(y=>y.name)).not.toContain("嶺上開花");
    const passed=new SanmaGame("east",names,options);act(passed,0,"nuki");passAll(passed);
    expect(passed.view(1).ronBlocked).toBe(true);expect(passed.view(0).ronBlocked).toBe(false);
    expect(passed.view(0).players.every(player=>!("ronBlocked" in player))).toBe(true);
    act(passed,0,"nuki");
    expect(passed.view(1).choices.some(c=>c.type==="ron")).toBe(false);
    expect(passed.view(0).players[0].nuki).toBe(2);
  });
  it("permits only kokushi to rob a closed kan",()=>{
    const game=new SanmaGame("east",names,fixture({0:"m111p234s234z1234",1:"m9p19s19z11234567"},["m1"]));
    act(game,0,"kan:m1111");expect(game.view(1).choices.some(c=>c.type==="ron")).toBe(true);
    act(game,1,"ron");passAll(game);
    expect(game.view(1).settlement!.yaku.map(y=>y.name)).toContain("国士無双");
    const normal=new SanmaGame("east",names,fixture({0:"p444s234z1234567",1:"p23s123456789z22"},["p4"]));
    act(normal,0,"kan:p4444");expect(normal.view(1).choices.some(c=>c.type==="ron")).toBe(false);
    const afterKan=normal.view(0);
    expect(afterKan.phase).toBe("gangzimo");expect(afterKan.doraIndicators).toHaveLength(2);
    const kanViews=[0,1,2].map(seat=>normal.view(seat));
    expect(afterKan.drawnTile).toEqual(expect.any(String));
    expect(kanViews.map(view=>view.players.map(player=>player.hasDrawnTile))).toEqual([[true,false,false],[true,false,false],[true,false,false]]);
    expect(kanViews.map(view=>view.drawnTile)).toEqual([afterKan.drawnTile,null,null]);
    expect(kanViews.every(view=>view.players.every(player=>typeof player.hasDrawnTile==="boolean"))).toBe(true);
    expect(JSON.stringify(kanViews.map(view=>view.players))).not.toContain(afterKan.drawnTile!);
  });
  it("offers kokushi robbery of a north extraction",()=>{
    const game=new SanmaGame("east",names,fixture({1:"m19p19s19z1123567"},["z4"]));
    act(game,0,"nuki");expect(game.view(1).choices.some(c=>c.type==="ron")).toBe(true);
    act(game,1,"ron");passAll(game);
    expect(game.view(0).settlement!.yaku.map(y=>y.name)).toContain("国士無双");
  });
  it("collects riichi deposit only after the declaration discard survives and allows only drawn north afterward",()=>{
    const game=new SanmaGame("east",names,fixture({0:"p123456789s123z4"},["m1","z1","z2","s8","z5","z6","z4"],["s9"]));
    act(game,0,"riichi:m1_");passAll(game);
    expect(game.view(0).riichiSticks).toBe(1);expect(game.view(0).players[0].score).toBe(34000);
    for(let s=1;s<=2;s++){const v=game.view(s);act(game,s,v.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"))!.id);passAll(game);}
    expect(game.view(0).drawnTile).toBe("s8");expect(game.view(0).choices.some(c=>c.type==="nuki")).toBe(false);
    act(game,0,"discard:s8_");passAll(game);
    for(let s=1;s<=2;s++){const v=game.view(s);act(game,s,v.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"))!.id);passAll(game);}
    expect(game.view(0).drawnTile).toBe("z4");expect(game.view(0).choices.some(c=>c.type==="nuki")).toBe(true);
    act(game,0,"nuki");passAll(game);
    expect(game.view(0).hand.filter(t=>t==="z4")).toHaveLength(1);
    expect(game.view(0).choices.filter(c=>c.type==="discard").map(c=>c.value)).toEqual(["s9_"]);
  });
  it("settles both ron replies in discard-distance order",()=>{
    const game=new SanmaGame("east",names,fixture({1:"p123456789s123z2",2:"p123456789s123z2"},["z2"]));
    act(game,0,"discard:z2_");act(game,2,"ron");act(game,1,"ron");
    expect(game.view(0).settlement!.winnerSeat).toBe(1);
    expect(game.view(0).settlement).toMatchObject({winMethod:"ron",winningTile:"z2"});
    const delta=game.view(0).settlement!.delta;
    for(let s=0;s<3;s++)act(game,s,"ack");
    expect(game.view(0).settlement!.winnerSeat).toBe(2);
    expect(game.view(0).settlement).toMatchObject({winMethod:"ron",winningTile:"z2"});
    expect(game.view(0).players.map(p=>p.score)).toEqual(delta.map(x=>35000+x));
    expect(game.view(0).settlement!.delta).toHaveLength(3);
    expect(game.view(0).settlement!.delta.reduce((s,n)=>s+n,0)).toBe(0);
  });
});

describe("Sanma score boundaries and late-hand rules",()=>{
  it("offers closed tsumo for the reported South-seat hand at 25 tiles and scores pinfu",()=>{
    const { hands, draws, reserve, indicators } = screenshotCase();
    const game = new SanmaGame("east", names, {
      dealer: 0,
      wallFactory: () => fixture(hands, draws, reserve, indicators).wallFactory()
    });

    // The dealer discards the first m1; West can pon it, moving the later
    // South turn to exactly 25 live tiles while leaving South's hand untouched.
    act(game, 0, "discard:m1_");
    expect(game.view(2).choices.some(choice => choice.id === "pon:m111+")).toBe(true);
    act(game, 2, "pon:m111+");
    const caller = game.view(2);
    expect(caller.drawnTile).toBeNull();
    expect(caller.players[2].hasDrawnTile).toBe(false);
    const callViews=[0,1,2].map(seat=>game.view(seat));
    expect(callViews.map(view=>view.players.map(player=>player.hasDrawnTile))).toEqual([[false,false,false],[false,false,false],[false,false,false]]);
    const callDiscard = caller.choices.find(choice => choice.type === "discard")!;
    game.respond(2, caller.decisionId, callDiscard.id);
    passAll(game);

    let reached = false;
    for (let step = 0; step < 100; step++) {
      const south = game.view(1);
      if (south.turnSeat === 1 && south.remainingTiles === 25 && south.drawnTile === "p1") {
        reached = true;
        break;
      }
      const responder = [0, 1, 2].find(seat => game.view(seat).choices.some(choice => choice.type === "pass"));
      if (responder !== undefined) {
        act(game, responder, "pass");
        continue;
      }
      const actor = south.turnSeat;
      const current = game.view(actor);
      const discard = current.choices.find(choice => choice.type === "discard" && choice.value?.endsWith("_"))
        ?? current.choices.find(choice => choice.type === "discard");
      expect(discard, `seat ${actor} should have a legal discard`).toBeDefined();
      game.respond(actor, current.decisionId, discard!.id);
    }

    expect(reached).toBe(true);
    const south = game.view(1);
    expect(south.hand.slice().sort()).toEqual(tiles("p123345s456678z44").sort());
    expect(south.players[1]).toMatchObject({ wind: 1, score: 35000, riichi: false, nuki: 0, melds: [] });
    expect(south.remainingTiles).toBe(25);
    expect(south.choices.some(choice => choice.type === "tsumo")).toBe(true);

    game.respond(1, south.decisionId, "tsumo");
    const settlement = game.view(1).settlement!;
    expect(settlement.yaku.map(yaku => yaku.name)).toEqual(expect.arrayContaining(["門前清自摸和", "平和"]));
    expect(settlement.fu).toBe(20);
    expect(settlement.han).toBe(2);
  });

  it("offers and accepts a legal riichi discard from the same closed tenpai shape",()=>{
    const game = new SanmaGame("east", names, fixture({ 1: "p23345s456678z44" }, ["z1", "s1"]));
    act(game, 0, "discard:z1_");
    passAll(game);

    const south = game.view(1);
    expect(south.drawnTile).toBe("s1");
    expect(south.choices.some(choice => choice.id === "riichi:s1_")).toBe(true);
    game.respond(1, south.decisionId, "riichi:s1_");
    passAll(game);
    expect(game.view(1).players[1].riichi).toBe(true);
    expect(game.view(1).riichiSticks).toBe(1);
  });

  it("counts one/nine man dora and extracted North dora but cannot win on nuki bonuses alone",()=>{
    const hand=Majiang.Shoupai.fromString("m999p123456s789z11");
    const score=scoreSanma(hand,null,{menfeng:1,baopai:["m1","z3"],nuki:2})!;
    expect(score.yaku.find(y=>y.name==="ドラ")?.fanshu).toBe(3);
    expect(score.yaku.find(y=>y.name==="抜きドラ")?.fanshu).toBe(4);
    const one=Majiang.Shoupai.fromString("m111p123456s789z22");
    expect(scoreSanma(one,null,{menfeng:1,baopai:["m9"]})!.yaku.find(y=>y.name==="ドラ")?.fanshu).toBe(3);
    const noYaku=Majiang.Shoupai.fromString("p234678s456z4,p111+");
    expect(scoreSanma(noYaku,"z4-",{menfeng:1,nuki:4,baopai:["z3"]})).toBeNull();
  });
  it("uses the responsible three-seat payer for yakuman, including ron split and independent extra yakuman",()=>{
    expect(sanmaPayment({base:8000,winner:1,dealer:0,pao:[{seat:2,base:8000}]})).toEqual([0,32000,-32000]);
    expect(sanmaPayment({base:8000,winner:1,dealer:0,loser:0,pao:[{seat:2,base:8000}]})).toEqual([-16000,32000,-16000]);
    expect(sanmaPayment({base:16000,winner:1,dealer:0,pao:[{seat:2,base:8000}]})).toEqual([-16000,56000,-40000]);
    const hand=Majiang.Shoupai.fromString("p123z11,z555+,z666-,z777+");
    const result=scoreSanma(hand,null,{menfeng:1})!;
    expect(result.yaku.find(y=>y.name==="大三元")?.baojia).toBe("+");
  });
  it("continues for one player's four kans and aborts only after fourth-kan discard when several players have kans",()=>{
    const solo=new SanmaGame("east",names,fixture({0:"p111222333444z1"},["p1"],["p2","p3","p4","z2"]));
    for(const meld of ["p1111","p2222","p3333","p4444"]){act(solo,0,"kan:"+meld);passAll(solo);}
    expect(solo.view(0).players[0].melds).toHaveLength(4);
    expect(solo.view(0).doraIndicators).toHaveLength(5);
    act(solo,0,"discard:z2_");passAll(solo);
    expect(solo.view(0).settlement).toBeNull();expect(solo.view(0).turnSeat).toBe(1);
    const split=new SanmaGame("east",names,fixture({0:"p111222s123z1122",1:"s777888z3455667"},["p1","s7"],["p2","s4","s8","s9"]));
    for(const meld of ["p1111","p2222"]){act(split,0,"kan:"+meld);passAll(split);}
    act(split,0,"discard:s4_");passAll(split);
    for(const meld of ["s7777","s8888"]){act(split,1,"kan:"+meld);passAll(split);}
    expect(split.view(1).settlement).toBeNull();act(split,1,"discard:s9_");passAll(split);
    expect(split.view(0).settlement!.name).toBe("四開槓");
    expect(split.view(0).settlement!.delta).toEqual([0,0,0]);
  });
  it("withholds daiminkan Dora through a replacement tsumo, then reveals it before discard reactions",()=>{
    const options=fixture({0:"p111p234s123s45z77"},["s9","p1"],["s6"],["z1","z2","p3","p2"]);
    const game=new SanmaGame("east",names,options);
    act(game,0,"discard:s9_");act(game,1,"discard:p1_");
    const kan=game.view(0).choices.find(choice=>choice.type==="kan");
    expect(kan).toBeDefined();act(game,0,kan!.id);passAll(game);

    const replacement=game.view(0);
    expect(replacement.phase).toBe("gangzimo");
    expect(replacement.drawnTile).toBe("s6");
    expect(replacement.doraIndicators).toEqual(["z1"]);
    expect(replacement.choices.some(choice=>choice.type==="tsumo")).toBe(true);
    act(game,0,"tsumo");
    const win=game.view(0).settlement!;
    expect(win.yaku.map(yaku=>yaku.name)).toContain("嶺上開花");
    expect(win.yaku.map(yaku=>yaku.name)).not.toContain("ドラ");
    expect(win.han).toBe(1);

    const discarding=new SanmaGame("east",names,options);
    act(discarding,0,"discard:s9_");act(discarding,1,"discard:p1_");
    const secondKan=discarding.view(0).choices.find(choice=>choice.type==="kan")!;
    act(discarding,0,secondKan.id);passAll(discarding);
    expect(discarding.view(0).doraIndicators).toEqual(["z1"]);
    const discard=discarding.view(0).choices.find(choice=>choice.type==="discard")!;
    act(discarding,0,discard.id);
    expect(discarding.view(1).doraIndicators).toEqual(["z1","p3"]);
  });
  it("disallows extraction and kan when no legal replacement remains",()=>{
    const wall=new SanmaWall(sanmaTiles());
    while(wall.remaining)wall.draw();
    expect(wall.canReplace).toBe(false);expect(wall.canKan).toBe(false);
  });
  it("awards three-seat nagashi mangan and carries riichi sticks on exhaustive draws",()=>{
    const hand0="m19p19s19z1234567";
    const pool=sanmaTiles();for(const t of tiles(hand0))pool.splice(pool.indexOf(t),1);
    const terminals=pool.filter(t=>/^z|^[mps][19]$/.test(t));
    // Seat zero receives only terminals/honors. Others deliberately put one
    // simple tile in their rivers, making only seat zero eligible for nagashi.
    const drawOrder:string[]=[];
    for(let i=0;i<18;i++)drawOrder.push(terminals[i]);
    const game=new SanmaGame("east",names,fixture({0:hand0},[]));
    // A separate physically constructed wall gives each dealer draw a terminal.
    const available=sanmaTiles();const take=(t:string)=>{const i=available.indexOf(t);if(i<0)throw new Error(t);available.splice(i,1);return t;};
    const h0=tiles(hand0).map(take),dealerDraws=drawOrder.map(take);
    const h1=available.splice(0,13),h2=available.splice(0,13),draws:string[]=[];
    for(let i=0;i<18;i++){draws.push(dealerDraws[i],...available.splice(0,2));}
    const ordered=[...h0,...h1,...h2,...draws,...available];
    const actual=new SanmaGame("east",names,{dealer:0,wallFactory:()=>new SanmaWall(ordered)});
    for(let i=0;i<200&&!actual.view(0).settlement;i++) {
      for(let s=0;s<3;s++) {
        const v=actual.view(s),c=v.choices.find(c=>c.type==="pass")??v.choices.find(c=>c.type==="discard"&&(s===0?true:!/^([mps][19]|z)/.test(c.value!)))??v.choices.find(c=>c.type==="discard");
        if(c)act(actual,s,c.id);
      }
    }
    expect(actual.view(0).settlement!.name).toBe("流し満貫");
    expect(actual.view(0).settlement!.delta).toEqual([8000,-4000,-4000]);
    expect(game.view(0).choices.some(c=>c.type==="abort")).toBe(true);
  });
});

describe("Sanma furiten, deposits and responsibility through real actions",()=>{
  it("rejects ron on every wait when one wait is already in the player's river",()=>{
    const game=new SanmaGame("east",names,fixture({0:"p23s123456789z22"},["p1","p4"]));
    act(game,0,"discard:p1_");passAll(game);act(game,1,"discard:p4_");
    expect(game.view(0).choices.some(c=>c.type==="ron")).toBe(false);
  });
  it("keeps passed-ron furiten after a riichi player's own next draw",()=>{
    const game=new SanmaGame("east",names,fixture({0:"p123456789s123z4",1:"m19p222s444z11444"},["m1","s8","s7","z2","s6"],["s9","s5"]));
    act(game,0,"riichi:m1_");passAll(game);act(game,1,"nuki");
    expect(game.view(0).choices.some(c=>c.type==="ron")).toBe(true);passAll(game);
    act(game,1,"discard:s9_");passAll(game);act(game,2,"discard:s7_");passAll(game);
    expect(game.view(0).drawnTile).toBe("z2");act(game,0,"discard:z2_");passAll(game);
    act(game,1,"nuki");expect(game.view(0).choices.some(c=>c.type==="ron")).toBe(false);
  });
  it("allows a wait-preserving riichi closed kan and rejects one which changes the wait set",()=>{
    const safe=new SanmaGame("east",names,fixture({0:"p111s123456789z1"},["m1","z2","z3","p1"]));
    act(safe,0,"riichi:m1_");passAll(safe);
    for(const s of [1,2]){const v=safe.view(s);act(safe,s,v.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"))!.id);passAll(safe);}
    expect(safe.view(0).choices.some(c=>c.id==="kan:p1111")).toBe(true);
    const changed=new SanmaGame("east",names,fixture({0:"p1112345678999"},["z1","z2","z3","p1"]));
    act(changed,0,"riichi:z1_");passAll(changed);
    for(const s of [1,2]){const v=changed.view(s);act(changed,s,v.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"))!.id);passAll(changed);}
    expect(changed.view(0).choices.some(c=>c.type==="kan")).toBe(false);
  });
  it("gives existing riichi sticks only to the nearest of two ron winners",()=>{
    const game=new SanmaGame("east",names,fixture({0:"p123s123456789z2",1:"p123s123456789z2",2:"p123s123456789z2"},["m1","z2"]));
    act(game,0,"riichi:m1_");passAll(game);expect(game.view(0).riichiSticks).toBe(1);
    act(game,1,"discard:z2_");act(game,0,"ron");act(game,2,"ron");
    const first=game.view(0).settlement!;expect(first.winnerSeat).toBe(2);expect(first.delta.reduce((s,v)=>s+v,0)).toBe(1000);
    for(let s=0;s<3;s++)act(game,s,"ack");
    const second=game.view(0).settlement!;expect(second.winnerSeat).toBe(0);expect(second.delta.reduce((s,v)=>s+v,0)).toBe(0);
    expect(game.view(0).players.reduce((s,p)=>s+p.score,0)+game.view(0).riichiSticks*1000).toBe(105000);
  });
  it("maps the third dragon caller to the real liable seat on a tsumo",()=>{
    const game=new SanmaGame("east",names,fixture({1:"p123s99z11556677"},["z5","z6","z7","s8","s7","p3"]));
    act(game,0,"discard:z5_");act(game,1,"pon:z555-");passAll(game);
    act(game,1,"discard:s9");passAll(game);act(game,2,"discard:z6_");act(game,1,"pon:z666+");passAll(game);
    act(game,1,"discard:s9");passAll(game);act(game,2,"discard:z7_");act(game,1,"pon:z777+");passAll(game);
    act(game,1,"discard:p3");passAll(game);act(game,2,"discard:s8_");passAll(game);act(game,0,"discard:s7_");passAll(game);
    expect(game.view(1).choices.some(c=>c.type==="tsumo")).toBe(true);act(game,1,"tsumo");
    expect(game.view(0).settlement!.delta).toEqual([0,32000,-32000]);
  });
  it("retains an unclaimed riichi stick across a draw and awards it to first place at match end",()=>{
    const first=fixture({0:"p123s123456789z2"},["m1"]);let hands=0;
    const game=new SanmaGame("east",names,{dealer:0,wallFactory:()=>hands++===0?first.wallFactory():new SanmaWall(sanmaTiles())});
    act(game,0,"riichi:m1_");passAll(game);
    let sawCarried=false;
    for(let step=0;step<6000&&!game.view(0).ranking;step++) {
      if(hands>1&&game.view(0).riichiSticks===1)sawCarried=true;
      for(let s=0;s<3;s++) {
        const v=game.view(s),c=v.choices.find(c=>c.type==="pass")??v.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"))??v.choices.find(c=>c.type==="discard")??v.choices.find(c=>c.type==="ack");
        if(c)act(game,s,c.id);
      }
      expect(game.view(0).players.reduce((sum,p)=>sum+p.score,0)+game.view(0).riichiSticks*1000).toBe(105000);
    }
    expect(sawCarried).toBe(true);expect(game.view(0).ranking).toHaveLength(3);expect(game.view(0).riichiSticks).toBe(0);
  });
});

it("uses only two honba shares on liable tsumo, also when extra yakuman has ordinary payers",()=>{
  expect(sanmaPayment({base:8000,winner:1,dealer:0,honba:2,pao:[{seat:2,base:8000}]})).toEqual([0,32400,-32400]);
  expect(sanmaPayment({base:8000,winner:0,dealer:0,honba:2,pao:[{seat:2,base:8000}]})).toEqual([48400,0,-48400]);
  expect(sanmaPayment({base:16000,winner:1,dealer:0,honba:2,pao:[{seat:2,base:8000}]})).toEqual([-16200,56400,-40200]);
  expect(sanmaPayment({base:16000,winner:0,dealer:0,honba:2,pao:[{seat:2,base:8000}]})).toEqual([80400,-16200,-64200]);
});

it("settles a real dealer heavenly hand with exactly two tsumo payers",()=>{
  const game=new SanmaGame("east",names,fixture({0:"p123456789s123z2"},["z2"]));
  act(game,0,"tsumo");expect(game.view(0).settlement!.yaku.map(y=>y.name)).toContain("天和");
  expect(game.view(0).settlement!.points).toBe(32000);
  expect(game.view(0).settlement!.delta).toEqual([32000,-16000,-16000]);
  for(let s=0;s<3;s++)act(game,s,"ack");
  expect(game.view(0).players.map(p=>p.score)).toEqual([67000,19000,19000]);
  expect(game.view(0).honba).toBe(1);expect(game.view(0).roundNumber).toBe(1);
});

it("does not charge a riichi declaration discard that another player immediately wins",()=>{
  const game=new SanmaGame("east",names,fixture({0:"p123456789s123z4",1:"p123456789s123z2"},["z2"]));
  act(game,0,"riichi:z2_");act(game,1,"ron");passAll(game);
  expect(game.view(0).riichiSticks).toBe(0);expect(game.view(0).players[0].score).toBe(35000);
  expect(game.view(0).settlement!.delta.reduce((s,n)=>s+n,0)).toBe(0);
});

it("returns detached three-player public DTOs without concealed opponent hands or wall internals",()=>{
  const game=new SanmaGame("east",names,{dealer:0}),v=game.view(0),copy=structuredClone(v);
  expect(Object.keys(v.players[1]).sort()).toEqual(["discards","handCount","hasDrawnTile","melds","nuki","riichi","score","seat","wind"]);
  expect(JSON.stringify(v)).not.toMatch(/_bingpai|_pai|wallFactory|reserve/);
  v.hand.length=0;v.players[1].discards.push("z7");v.doraIndicators.length=0;v.choices.length=0;
  expect(game.view(0)).toEqual(copy);
  const another=new SanmaGame("east",names,{dealer:0});expect(another.view(0).decisionId).not.toBe(copy.decisionId);
});

it("clears temporary north-pass furiten on the next own draw for a non-riichi player",()=>{
  const game=new SanmaGame("east",names,fixture({0:"m19p222s444z11444",1:"p123456789s123z4"},["s8","s7","z2","z3"],["s9","s6","s5"]));
  act(game,0,"nuki");passAll(game);act(game,0,"nuki");passAll(game);
  act(game,0,"discard:s6_");passAll(game);act(game,1,"discard:s7_");passAll(game);act(game,2,"discard:z2_");passAll(game);
  act(game,0,"nuki");expect(game.view(1).choices.some(c=>c.type==="ron")).toBe(true);
});

it("omits nuki on the final live-wall North and supports nine-terminals abort without penalties",()=>{
  const game=new SanmaGame("east",names,{dealer:0,wallFactory:()=>new SanmaWall(sanmaTiles())});
  for(let step=0;step<200&&game.view(0).remainingTiles>0;step++)for(let s=0;s<3;s++) {
    if(!game.view(0).remainingTiles)break;
    const v=game.view(s),choice=v.choices.find(c=>c.type==="pass")??v.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"));
    if(choice)act(game,s,choice.id);
  }
  const last=game.view(game.view(0).turnSeat);expect(last.remainingTiles).toBe(0);expect(last.drawnTile).toBe("z4");
  expect(last.choices.some(c=>c.type==="nuki"||c.type==="kan"||c.type==="riichi")).toBe(false);
  const aborted=new SanmaGame("east",names,fixture({0:"m19p19s19z1234567"},["z1"]));
  act(aborted,0,"abort");expect(aborted.view(0).settlement!.name).toBe("九種九牌");expect(aborted.view(0).settlement!.delta).toEqual([0,0,0]);
  for(let s=0;s<3;s++)act(aborted,s,"ack");expect(aborted.view(0).roundNumber).toBe(1);expect(aborted.view(0).honba).toBe(1);
});

it("offers a real added kan after pon and gives its robber the chankan yaku",()=>{
  const game=new SanmaGame("east",names,fixture({1:"p11s123456789z22",2:"p23s123456789z44"},["p1","z3","z4","p1"]));
  const before=game.view(0).doraIndicators;
  act(game,0,"discard:p1_");act(game,1,"pon:p111-");passAll(game);
  act(game,1,"discard:s9");passAll(game);act(game,2,"discard:z3_");passAll(game);act(game,0,"discard:z4_");passAll(game);
  expect(game.view(1).choices.some(c=>c.id==="kan:p111-1")).toBe(true);
  act(game,1,"kan:p111-1");expect(game.view(2).choices.some(c=>c.type==="ron")).toBe(true);
  expect(game.view(2).doraIndicators).toEqual(before);
  act(game,2,"ron");passAll(game);
  expect(game.view(0).settlement).toMatchObject({winnerSeat:2,winMethod:"ron",winningTile:"p1"});
  expect(game.view(0).settlement!.yaku.map(y=>y.name)).toContain("槍槓");
  expect(game.view(0).doraIndicators).toEqual(before);
});

it("defers a successful added-kan indicator until discard",()=>{
  const simple=new SanmaGame("east",names,fixture(
    {1:"p11s123456789z22",2:"m19p9s123456z1234"},
    ["p1","z3","z4","p1"],[],["z1","z2","p3","p2"]
  ));
  act(simple,0,"discard:p1_");act(simple,1,"pon:p111-");passAll(simple);
  act(simple,1,"discard:s9");passAll(simple);act(simple,2,"discard:z3_");passAll(simple);act(simple,0,"discard:z4_");passAll(simple);
  const kakan=simple.view(1).choices.find(choice=>choice.type==="kan")!;
  act(simple,1,kakan.id);passAll(simple);
  expect(simple.view(1).phase).toBe("gangzimo");
  expect(simple.view(1).doraIndicators).toEqual(["z1"]);
  const afterReplacement=simple.view(1).choices.find(choice=>choice.type==="discard")!;
  act(simple,1,afterReplacement.id);
  expect(simple.view(0).doraIndicators).toEqual(["z1","p3"]);
});

it("reveals an earlier pending open-kan indicator before a later added kan can be robbed",()=>{
  const chained=new SanmaGame("east",names,fixture(
    {0:"p11p222s123456z77",1:"m19p9s123456z2345",2:"m19p9s19z11234567"},
    ["s9","p1","z1","p2"],["p1"],["z1","z2","z6","z3"]
  ));
  act(chained,0,"discard:s9_");act(chained,1,"discard:p1_");
  const pon=chained.view(0).choices.find(choice=>choice.type==="pon")!;
  act(chained,0,pon.id);passAll(chained);
  act(chained,0,"discard:z7");passAll(chained);
  act(chained,1,"discard:z1_");passAll(chained);
  expect(chained.view(2).drawnTile).toBe("p2");act(chained,2,"discard:p2_");
  const daiminkan=chained.view(0).choices.find(choice=>choice.type==="kan")!;
  act(chained,0,daiminkan.id);passAll(chained);
  expect(chained.view(0).phase).toBe("gangzimo");
  expect(chained.view(0).drawnTile).toBe("p1");
  expect(chained.view(0).doraIndicators).toEqual(["z1"]);
  const nextKan=chained.view(0).choices.find(choice=>choice.type==="kan")!;
  act(chained,0,nextKan.id);
  expect(chained.view(2).choices.some(choice=>choice.type==="ron")).toBe(true);
  expect(chained.view(2).doraIndicators).toEqual(["z1","z6"]);
  act(chained,2,"ron");passAll(chained);
  expect(chained.view(2).settlement!.yaku.map(yaku=>yaku.name)).toContain("国士無双");
  expect(chained.view(2).settlement!.yaku.map(yaku=>yaku.name)).not.toContain("槍槓");
  expect(chained.view(2).doraIndicators).toEqual(["z1","z6"]);
});


describe("published sanma ron counters", () => {
  it.each([
    [{base:2000,winner:0,dealer:0,loser:1}, [12000,-12000,0]],
    [{base:2000,winner:0,dealer:0,loser:1,honba:2,sticks:1}, [13400,-12400,0]],
    [{base:2000,winner:1,dealer:0,loser:2}, [0,8000,-8000]],
    [{base:2000,winner:1,dealer:0,loser:2,honba:2}, [0,8400,-8400]],
    [{base:8000,winner:1,dealer:0,loser:0,honba:2,sticks:1,pao:[{seat:2,base:8000}]}, [-16400,33400,-16000]],
  ])("keeps exact rounded payment and deposit conservation for %j", (payment, expected) => {
    const delta = sanmaPayment(payment);
    expect(delta).toEqual(expected);
    expect(delta.reduce((sum, value) => sum + value, 0)).toBe(("sticks" in payment ? payment.sticks : 0) * 1000);
  });

  it("keeps child ron hand value separate from seeded prior counters and pot", () => {
    const game = new SanmaGame("east", names, fixture({1:"p123456s123z5552"},["z2"],[],["m1","m1"]));
    // Valid previous-hand bookkeeping is seeded, not generated by earlier games.
    const bookkeeping = game as unknown as {honba:number;sticks:number;scores:number[]};
    bookkeeping.honba=2; bookkeeping.sticks=1; bookkeeping.scores[2]-=1000;
    const before=game.view(0).players.map(player=>player.score);
    expect(before).toEqual([35000,35000,34000]);
    act(game,0,"discard:z2_"); act(game,1,"ron"); passAll(game);
    const settlement=game.view(0).settlement!;
    expect(settlement).toMatchObject({winnerSeat:1,winMethod:"ron",fu:50,han:1,points:1600,delta:[-2000,3000,0]});
    for(const seat of [0,1,2]) act(game,seat,"ack");
    expect(game.view(0).players.map(player=>player.score)).toEqual([33000,38000,34000]);
    expect(game.view(0).players.reduce((sum,player)=>sum+player.score,0)).toBe(105000);
  });
});
