import { describe, expect, it } from "vitest";
import { RiichiGame } from "../../../src/online/domain/engine";
import Majiang from "@kobalab/majiang-core";

function fixture(hands: Record<number, string>, drawn: string, dealer = 0) {
  return { dealer, wallFactory: (rule: ConstructorParameters<typeof Majiang.Shan>[0]) => {
    const wall = new Majiang.Shan(rule), available = wall._pai.slice();
    const take = (tile: string) => { const i = available.indexOf(tile); if (i < 0) throw new Error("Impossible test tile"); available.splice(i,1); return tile; };
    const dealt: string[][] = [[],[],[],[]];
    for (const [seat, encoded] of Object.entries(hands)) {
      dealt[Number(seat)] = [...encoded.matchAll(/([mpsz])(\d+)/g)].flatMap(m => [...m[2]].map(n => take(m[1]+n)));
      if (dealt[Number(seat)].length !== 13) throw new Error("Test hand must have 13 tiles");
    }
    take(drawn);
    for(let seat=0;seat<4;seat++) if(!dealt[seat].length) dealt[seat]=available.splice(0,13);
    const dealOrder = Array.from({ length: 4 }, (_, wind) => dealt[(dealer + wind) % 4]);
    wall._pai=[...available,...[...dealOrder.flat(),drawn].reverse()];
    wall._baopai=[wall._pai[4]]; wall._fubaopai=[wall._pai[9]];
    return wall;
  } };
}

describe("riichi authoritative game", () => {
  it("publishes an opaque game identity and advances its hand identity after settlement", () => {
    const game = new RiichiGame("east", ["A", "B", "C", "D"], fixture({ 0: "m123p123s123z1112" }, "z2"));
    const opening = game.view(0);
    expect(opening.gameInstanceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(opening.handId).toBe(1);
    game.respond(0, opening.decisionId, "tsumo");
    for (const seat of [0, 1, 2, 3]) {
      const view = game.view(seat);
      game.respond(seat, view.decisionId, "ack");
    }
    const nextHand = game.view(0);
    expect(nextHand.gameInstanceId).toBe(opening.gameInstanceId);
    expect(nextHand.handId).toBe(2);
  });

  it("deals four real hands but never exposes another player's concealed tiles or the wall", () => {
    const game = new RiichiGame("east", ["A", "B", "C", "D"]);
    const views = [0, 1, 2, 3].map(seat => game.view(seat));
    expect(views.map(v => v.hand.length).sort()).toEqual([13, 13, 13, 14]);
    expect(views[0].remainingTiles).toBe(69);
    for (const v of views) {
      expect(v.players).toHaveLength(4);
      expect(Object.keys(v.players[0]).sort()).toEqual(["discards", "handCount", "hasDrawnTile", "melds", "riichi", "score", "seat", "wind"]);
      expect(JSON.stringify(v)).not.toContain('"_pai"');
      expect(v.players.map(p => p.score)).toEqual([25000, 25000, 25000, 25000]);
    }
  });
  it("publishes an opaque draw flag to every viewer across a real draw, discard and chi", () => {
    const game = new RiichiGame("east", ["A", "B", "C", "D"], fixture({
      0: "m123p345s123z1112",
      1: "m456p12s456789z23",
      2: "m789p789s789z4567",
      3: "m111p222s333z5567",
    }, "p9"));
    const seats = [0, 1, 2, 3];
    const opening = seats.map(seat => game.view(seat));
    expect(opening.map(view => view.players.map(player => player.hasDrawnTile))).toEqual(
      seats.map(() => [true, false, false, false]),
    );
    expect(opening.map(view => view.drawnTile)).toEqual(["p9", null, null, null]);
    for (const view of opening) {
      expect(view.players.every(player => typeof player.hasDrawnTile === "boolean")).toBe(true);
      expect(view.players.every(player => !("drawnTile" in player) && !("hand" in player))).toBe(true);
      expect(JSON.stringify(view.players)).not.toContain("p9");
    }

    const dealer = game.view(0);
    const discard = dealer.choices.find(choice => choice.type === "discard" && choice.value === "p3");
    expect(discard).toBeDefined();
    game.respond(0, dealer.decisionId, discard!.id);
    const afterDiscard = seats.map(seat => game.view(seat));
    expect(afterDiscard.map(view => view.players.map(player => player.hasDrawnTile))).toEqual(
      seats.map(() => [false, false, false, false]),
    );

    const chiView = game.view(1);
    const chi = chiView.choices.find(choice => choice.type === "chi");
    expect(chi).toBeDefined();
    game.respond(1, chiView.decisionId, chi!.id);
    const afterChi = seats.map(seat => game.view(seat));
    expect(afterChi.map(view => view.players.map(player => player.hasDrawnTile))).toEqual(
      seats.map(() => [false, false, false, false]),
    );
    expect(afterChi[1].drawnTile).toBeNull();

    const callerDiscardView = game.view(1);
    const callerDiscard = callerDiscardView.choices.find(choice => choice.type === "discard");
    expect(callerDiscard).toBeDefined();
    game.respond(1, callerDiscardView.decisionId, callerDiscard!.id);
    const afterCallerDiscard = seats.map(seat => game.view(seat));
    const sharedFlags = afterCallerDiscard[0].players.map(player => player.hasDrawnTile);
    expect(sharedFlags[1]).toBe(false);
    expect(afterCallerDiscard.map(view => view.players.map(player => player.hasDrawnTile))).toEqual(
      seats.map(() => sharedFlags),
    );
  });
  it("rejects non-turn, fabricated and stale choices without advancing the game", () => {
    const game = new RiichiGame("east", ["A", "B", "C", "D"]);
    const view = game.view(0), actor = view.turnSeat, own = game.view(actor);
    expect(() => game.respond((actor + 1) % 4, own.decisionId, "discard:m1")).toThrow();
    expect(() => game.respond(actor, own.decisionId, "discard:z8")).toThrow();
    expect(game.view(actor)).toEqual(own);
    const choice = own.choices.find(c => c.type === "discard")!;
    game.respond(actor, own.decisionId, choice.id);
    expect(game.view(actor).players.find(p => p.seat === actor)!.discards).toHaveLength(1);
    expect(() => game.respond(actor, own.decisionId, choice.id)).toThrow();
  });
  it("plays a complete east round with real draws, furiten, call passes and settlements", () => {
    const game = new RiichiGame("east", ["A", "B", "C", "D"]);
    let settlements = 0;
    for (let steps = 0; steps < 4000; steps++) {
      if (game.view(0).ranking) break;
      let acted = false;
      for (let seat = 0; seat < 4; seat++) {
        const v = game.view(seat);
        const choice = v.choices.find(c => c.type === "pass") ?? v.choices.find(c => c.type === "discard") ?? v.choices.find(c => c.type === "ack");
        if (!choice) continue;
        if (choice.type === "ack" && seat === 0) settlements++;
        game.respond(seat, v.decisionId, choice.id);
        acted = true;
      }
      expect(acted).toBe(true);
    }
    const final = game.view(0);
    expect(final.ranking).toHaveLength(4);
    expect(settlements).toBeGreaterThanOrEqual(4);
    expect(final.players.reduce((sum, p) => sum + p.score, 0)).toBe(100000);
  });
  it("offers a real legal riichi discard and collects exactly one 1000-point deposit", () => {
    const game = new RiichiGame("east", ["A","B","C","D"],fixture({0:"m123p123s123z1112"},"p9"));
    const before=game.view(0), riichi=before.choices.find(c=>c.type==="riichi"&&c.value==="p9_")!;
    expect(riichi).toBeDefined();
    game.respond(0,before.decisionId,riichi.id);
    for(let seat=1;seat<4;seat++) {const v=game.view(seat), pass=v.choices.find(c=>c.type==="pass");if(pass)game.respond(seat,v.decisionId,pass.id);}
    const after=game.view(0);
    expect(after.players.find(p=>p.seat===0)!.riichi).toBe(true);
    expect(after.players.find(p=>p.seat===0)!.score).toBe(24000);
    expect(after.riichiSticks).toBe(1);
    expect(after.players.reduce((sum,p)=>sum+p.score,0)+1000*after.riichiSticks).toBe(100000);
  });
  it("maps real tsumo and riichi choices to the right player through every dealer rotation", () => {
    for (const dealer of [0, 1, 2, 3]) {
      const winning = new RiichiGame("east", ["A", "B", "C", "D"], fixture({ [dealer]: "m123p123s123z1112" }, "z2", dealer));
      const tsumoView = winning.view(dealer);
      expect(tsumoView.turnSeat).toBe(dealer);
      expect(tsumoView.choices.some(choice => choice.type === "tsumo")).toBe(true);
      expect([0, 1, 2, 3].map(seat => winning.view(seat).settlement)).toEqual([null, null, null, null]);
      for (const seat of [0, 1, 2, 3].filter(seat => seat !== dealer)) {
        expect(winning.view(seat).choices).toEqual([]);
      }
      winning.respond(dealer, tsumoView.decisionId, "tsumo");
      const settlement = winning.view(dealer).settlement!;
      expect(settlement.winnerSeat).toBe(dealer);
      expect(settlement).toMatchObject({ winMethod: "tsumo", winningTile: "z2" });
      const settlementViews = [0, 1, 2, 3].map(seat => winning.view(seat));
      expect(settlementViews.map(view => view.settlement?.winMethod)).toEqual(["tsumo", "tsumo", "tsumo", "tsumo"]);
      expect(settlementViews.every(view => view.settlement?.hand === settlement.hand)).toBe(true);

      const declaring = new RiichiGame("east", ["A", "B", "C", "D"], fixture({ [dealer]: "m123p123s123z1112" }, "p9", dealer));
      const riichiView = declaring.view(dealer);
      expect(riichiView.choices.some(choice => choice.type === "riichi" && choice.value === "p9_")).toBe(true);
      declaring.respond(dealer, riichiView.decisionId, "riichi:p9_");
      for (const seat of [0, 1, 2, 3]) {
        const view = declaring.view(seat);
        const pass = view.choices.find(choice => choice.type === "pass");
        if (pass) declaring.respond(seat, view.decisionId, pass.id);
      }
      expect(declaring.view(dealer).players.find(player => player.seat === dealer)?.riichi).toBe(true);
      expect(declaring.view(dealer).riichiSticks).toBe(1);
    }
  });
  it("settles a dealer heavenly-hand tsumo using the actual core's yakuman scoring", () => {
    const game=new RiichiGame("east",["A","B","C","D"],fixture({0:"m123p123s123z1112"},"z2"));
    const v=game.view(0), tsumo=v.choices.find(c=>c.type==="tsumo")!;
    expect(tsumo).toBeDefined(); game.respond(0,v.decisionId,tsumo.id);
    const settlement=game.view(0).settlement!;
    expect(settlement.kind).toBe("win"); expect(settlement.points).toBe(48000);
    expect(settlement.delta).toEqual([48000,-16000,-16000,-16000]);
    expect(settlement.yaku.some(y=>y.name==="天和")).toBe(true);
    for(let seat=0;seat<4;seat++){const view=game.view(seat);game.respond(seat,view.decisionId,"ack");}
    expect(game.view(0).players.find(p=>p.seat===0)!.score).toBe(73000);
  });
  it("offers another player's ron after a discard and prioritizes the winning reply", () => {
    const game=new RiichiGame("east",["A","B","C","D"],fixture({1:"m123p123s123z1112"},"z2"));
    const first=game.view(0); game.respond(0,first.decisionId,"discard:z2_");
    const second=game.view(1); expect(second.choices.some(c=>c.type==="ron")).toBe(true);
    game.respond(1,second.decisionId,"ron");
    for(let seat=2;seat<4;seat++){const v=game.view(seat);if(v.choices.some(c=>c.type==="pass"))game.respond(seat,v.decisionId,"pass");}
    const settlement=game.view(1).settlement!;
    expect(settlement.winnerSeat).toBe(1);
    expect(settlement).toMatchObject({ winMethod: "ron", winningTile: "z2" });
    expect(settlement.delta.reduce((s,n)=>s+n,0)).toBe(0);
  });
  it("shows a red-five open winning hand only after its real ron settlement", () => {
    const game=new RiichiGame("east",["A","B","C","D"],fixture({
      0:"m456p123s456z2345",
      1:"m123s123z111p1p059",
      2:"m789p167s789z2345",
      3:"m456p123s456z3467",
    },"p5"));
    const opening=game.view(0);
    expect(opening.settlement).toBeNull();
    expect(opening.hand).not.toContain("p0");
    expect(opening.players.every(player => !("hand" in player) && !("drawnTile" in player))).toBe(true);
    game.respond(0,opening.decisionId,opening.choices.find(choice=>choice.type==="discard"&&choice.value?.startsWith("p5"))!.id);
    for(const seat of [2,3]) {
      const view=game.view(seat),pass=view.choices.find(choice=>choice.type==="pass");
      if(pass)game.respond(seat,view.decisionId,pass.id);
    }
    const ponView=game.view(1),pon=ponView.choices.find(choice=>choice.type==="pon"&&choice.value?.includes("0"));
    expect(pon).toBeDefined();game.respond(1,ponView.decisionId,pon!.id);
    const openView=game.view(1);
    expect(openView.players[1].melds.some(meld=>meld.includes("0"))).toBe(true);
    expect(openView.settlement).toBeNull();
    game.respond(1,openView.decisionId,openView.choices.find(choice=>choice.type==="discard"&&choice.value?.startsWith("p9"))!.id);
    for(const seat of [0,2,3]) {
      const view=game.view(seat),pass=view.choices.find(choice=>choice.type==="pass");
      if(pass)game.respond(seat,view.decisionId,pass.id);
    }
    const next=game.view(2);
    const ronTile=next.choices.find(choice=>choice.type==="discard"&&choice.value?.startsWith("p1"));
    expect(ronTile).toBeDefined();game.respond(2,next.decisionId,ronTile!.id);
    const ronView=game.view(1),ron=ronView.choices.find(choice=>choice.type==="ron");
    expect(ron).toBeDefined();
    const beforeSettlement=game.view(0);
    expect(beforeSettlement.settlement).toBeNull();
    // s1 may legitimately be the public dora indicator; inspect private-hand
    // fields instead of treating an arbitrary tile code anywhere as a leak.
    expect(beforeSettlement.hand).not.toContain("s1");
    expect(beforeSettlement.players.every(player => !("hand" in player) && !("drawnTile" in player))).toBe(true);
    game.respond(1,ronView.decisionId,ron!.id);
    for(const seat of [0,2,3]) {
      const view=game.view(seat),pass=view.choices.find(choice=>choice.type==="pass");
      if(pass)game.respond(seat,view.decisionId,pass.id);
    }
    const settlement=game.view(0).settlement!;
    expect(settlement).toMatchObject({kind:"win",winnerSeat:1,winMethod:"ron",winningTile:"p1"});
    expect(settlement.hand).toContain("p505-");
    expect(settlement.hand).toContain("s1");
    const settledViews=[0,1,2,3].map(seat=>game.view(seat));
    expect(settledViews.every(view=>view.settlement?.hand===settlement.hand)).toBe(true);
    expect(settledViews.map(view=>view.settlement?.winMethod)).toEqual(["ron","ron","ron","ron"]);
  });
  it("resolves an ankan with a replacement draw and another dora indicator", () => {
    const game=new RiichiGame("east",["A","B","C","D"],fixture({0:"m111234p456s789z1"},"m1"));
    const v=game.view(0); expect(v.choices.some(c=>c.id==="kan:m1111")).toBe(true);
    game.respond(0,v.decisionId,"kan:m1111");
    const after=game.view(0);
    expect(after.phase).toBe("gangzimo"); expect(after.doraIndicators).toHaveLength(2);
    expect(after.remainingTiles).toBe(68); expect(after.hand).toHaveLength(11);
    expect(after.players.find(p=>p.seat===0)!.melds).toEqual(["m1111"]);
    const views=[0,1,2,3].map(seat=>game.view(seat));
    expect(after.drawnTile).toEqual(expect.any(String));
    expect(views.map(view=>view.players.map(player=>player.hasDrawnTile))).toEqual(
      [0,1,2,3].map(()=>[true,false,false,false]),
    );
    expect(views.map(view=>view.drawnTile)).toEqual([after.drawnTile,null,null,null]);
    expect(views.every(view=>view.players.every(player=>typeof player.hasDrawnTile==="boolean"))).toBe(true);
    expect(JSON.stringify(views.map(view=>view.players))).not.toContain(after.drawnTile!);
  });
});
