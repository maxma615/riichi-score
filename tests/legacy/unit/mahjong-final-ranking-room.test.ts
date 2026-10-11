import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { RoomStore } from "../../../src/online/domain/rooms";
import type { MahjongCommand } from "../../../src/online/domain/types";
import { drawEngine } from "../fixtures/mahjong-draw-game";

type Input = MahjongCommand extends infer C ? C extends {nonce:string} ? Omit<C,"nonce"> : never : never;
for (const variant of ["sanma", "yonma"] as const) for (const lastBot of [false,true]) it(`${variant} ${lastBot?"bot":"human"} final ranking clock starts only after native final ACK and survives reconnect`, () => {
  const count=variant==="sanma"?3:4;
  let now=1000;
  const store=new RoomStore({now:()=>now,gameFactory:v=>drawEngine(v,[],{hands:["m19p369s369z14577","m19p147s258z13566","m19p258s147z23477","m2346p3468s2468z3"]})});
  const people=Array.from({length:count},(_,i)=>({userId:randomUUID(),displayName:`P${i}`}));
  const send=(seat:number,input:Input)=>store.execute(people[seat],{...input,nonce:randomUUID()} as MahjongCommand);
  const room=send(0,{action:"create",mode:"east",variant})!;
  for(let seat=1;seat<count-(lastBot?1:0);seat++)send(seat,{action:"join",code:room.code});
  if(lastBot)send(0,{action:"fill-bots",roomId:room.id});
  store.connection(people[0].userId,1);
  for(let seat=0;seat<count-(lastBot?1:0);seat++)send(seat,{action:"ready",roomId:room.id,ready:true});
  send(0,{action:"start",roomId:room.id});
  const view=(seat=0)=>store.view(people[seat].userId)!;
  for(let step=0;step<3000 && view().status!=="finished";step++) {
    expect(view().game?.rankingFlow).toBeUndefined();
    let acted=false;
    for(let seat=0;seat<count;seat++) {
      const bot=lastBot&&seat===count-1?store.botDecisions().find(job=>job.seat===seat):undefined;
      if(lastBot&&seat===count-1&&!bot)continue;
      const game=bot?.view??view(seat).game!;
      const choice=game.choices.find(c=>c.type==="ack")??game.choices.find(c=>c.type==="pass")??game.choices.find(c=>c.type==="discard"&&c.value?.endsWith("_"));
      if(choice){now++;if(bot){expect(store.respondBot(bot,choice.id)).toBe(true);}else send(seat,{action:"respond",roomId:room.id,decisionId:game.decisionId,choiceId:choice.id});acted=true;break;}
    }
    expect(acted).toBe(true);
  }
  expect(view().status).toBe("finished");
  const final=view().game!;
  expect(final.ranking).toHaveLength(count);
  expect(final.rankingFlow).toEqual({id:final.gameInstanceId,elapsedMs:0});
  const scores=final.ranking;
  now+=6000;store.connection(people[0].userId,1);store.connection(people[0].userId,-1);store.connection(people[0].userId,1);
  expect(view().game!.rankingFlow?.elapsedMs).toBe(6000);
  expect(view().game!.ranking).toEqual(scores);
  send(count-(lastBot?2:1),{action:"leave",roomId:room.id});
  expect(view().game!.rankingFlow?.elapsedMs).toBe(6000);
  send(0,{action:"rematch",roomId:room.id});
  expect(view().game).toBeNull();
});
