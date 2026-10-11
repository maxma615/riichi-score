import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RoomStore } from "../../../src/online/domain/rooms";
import type { MahjongCommand } from "../../../src/online/domain/types";
const players = [0,1,2,3,4].map(n => ({ userId: randomUUID(), displayName: `player${n}` }));
type Input = MahjongCommand extends infer C ? C extends {nonce:string} ? Omit<C,"nonce"> : never : never;
const cmd = (input: Input) => ({ ...input, nonce: randomUUID() }) as MahjongCommand;

describe("private ephemeral mahjong rooms", () => {
  it("permits exactly four seats, one room per user and starts only after four ready players", () => {
    const store = new RoomStore();
    const room = store.execute(players[0], cmd({ action: "create", mode: "east" }))!;
    expect(() => store.execute(players[0], cmd({ action: "create", mode: "east" }))).toThrow();
    for (const player of players.slice(1, 4)) store.execute(player, cmd({ action: "join", code: room.code }));
    expect(() => store.execute(players[4], cmd({ action: "join", code: room.code }))).toThrow();
    expect(store.view(players[4].userId)).toBeNull();
    expect(() => store.execute(players[1], cmd({ action: "start", roomId: room.id }))).toThrow();
    expect(() => store.execute(players[0], cmd({ action: "start", roomId: room.id }))).toThrow();
    for (const player of players.slice(0,4)) store.execute(player, cmd({ action: "ready", ready: true, roomId: room.id }));
    expect(store.execute(players[0], cmd({ action: "start", roomId: room.id }))!.status).toBe("playing");
    expect(() => store.execute(players[2], cmd({ action: "leave", roomId: room.id }))).toThrow();
  });
  it("deduplicates a command and refuses the same nonce with different content", () => {
    const store = new RoomStore(), create = cmd({ action: "create", mode: "east" });
    const first = store.execute(players[0], create)!;
    expect(store.execute(players[0], create)!.id).toBe(first.id);
    expect(() => store.execute(players[0], { ...create, action: "leave", roomId: first.id })).toThrow();
    expect(() => store.execute(players[4], cmd({ action: "finish", roomId: first.id }))).toThrow();
    store.execute(players[1], cmd({ action: "join", code: first.code }));
    store.execute(players[0], cmd({ action: "leave", roomId: first.id }));
    expect(store.view(players[1].userId)!.hostUserId).toBe(players[1].userId);
    store.execute(players[1], cmd({ action: "finish", roomId: first.id }));
    expect(store.size).toBe(0);
  });
  it("keeps disconnected seats for ten minutes without poll requests keeping abandoned games alive", () => {
    let now = 1000;
    const store = new RoomStore({ now: () => now });
    store.execute(players[0], cmd({ action: "create", mode: "east" }));
    store.connection(players[0].userId, 1);
    now += 3600000;
    store.sweep(); expect(store.size).toBe(1);
    store.connection(players[0].userId, -1);
    now += 599999;
    store.sweep(); expect(store.view(players[0].userId)).not.toBeNull();
    now++;
    store.sweep(); expect(store.size).toBe(0);
    expect(store.view(players[0].userId)).toBeNull();
  });
  it("cannot replay an old room's finish against a new room even after nonce eviction", () => {
    const store = new RoomStore();
    const old = store.execute(players[0], cmd({ action:"create",mode:"east" }))!;
    const finish = cmd({ action:"finish",roomId:old.id });
    store.execute(players[0],finish);
    const current = store.execute(players[0],cmd({ action:"create",mode:"east" }))!;
    for(let n=0;n<4097;n++) store.execute(players[0],cmd({action:"ready",ready:n%2===0,roomId:current.id}));
    expect(()=>store.execute(players[0],finish)).toThrow();
    expect(store.view(players[0].userId)!.id).toBe(current.id);
  });
});

describe("computer seats", () => {
  it("supports two humans and one computer in a genuine three seat room", () => {
    const store = new RoomStore();
    const room = store.execute(players[0], cmd({ action: "create", mode: "east", variant: "sanma" }))!;
    store.execute(players[1], cmd({ action: "join", code: room.code }));
    for (const action of ["fill-bots", "remove-bot", "add-bot"] as const) {
      const input = action === "fill-bots" ? { action, roomId: room.id } : { action, seat: 2, roomId: room.id };
      expect(() => store.execute(players[1], cmd(input))).toThrow("只有房主");
    }
    expect(() => store.execute(players[0], cmd({ action: "add-bot", seat: 3, roomId: room.id }))).toThrow();
    expect(() => store.execute(players[0], cmd({ action: "remove-bot", seat: 1, roomId: room.id }))).toThrow();
    store.execute(players[0], cmd({ action: "fill-bots", roomId: room.id }));
    expect(store.view(players[0].userId)!.members.map(m => m.kind)).toEqual(["human", "human", "bot"]);
    expect(() => store.execute(players[2], cmd({ action: "join", code: room.code }))).toThrow();
    for (const player of players.slice(0, 2)) store.execute(player, cmd({ action: "ready", ready: true, roomId: room.id }));
    const started = store.execute(players[0], cmd({ action: "start", roomId: room.id }))!;
    expect(started.variant).toBe("sanma");
    expect(started.game!.players).toHaveLength(3);
    for (const action of ["fill-bots", "remove-bot", "add-bot"] as const) {
      const input = action === "fill-bots" ? { action, roomId: room.id } : { action, seat: 2, roomId: room.id };
      expect(() => store.execute(players[0], cmd(input))).toThrow("只能在大厅");
    }
  });

  it("reserves bot identities internally, removes them and cannot leave an all-computer room", () => {
    const store = new RoomStore();
    const room = store.execute(players[0], cmd({ action: "create", mode: "east" }))!;
    expect(room.variant).toBe("yonma");
    const add = cmd({ action: "add-bot", seat: 1, roomId: room.id });
    const added = store.execute(players[0], add)!;
    expect(store.execute(players[0], add)!.members).toEqual(added.members);
    store.execute(players[0], cmd({ action: "fill-bots", roomId: room.id }));
    const bot = store.view(players[0].userId)!.members[1];
    expect(bot.userId).toMatch(/^bot:/);
    expect(bot.ready).toBe(true);
    expect(() => store.execute(bot, cmd({ action: "ready", ready: false, roomId: room.id }))).toThrow();
    expect(() => store.execute(bot, cmd({ action: "create", mode: "east" }))).toThrow();
    expect(store.view(bot.userId)).toBeNull();
    store.connection(bot.userId, 1);
    expect(store.view(players[0].userId)!.members[1].connected).toBe(false);
    store.execute(players[0], cmd({ action: "remove-bot", seat: 1, roomId: room.id }));
    store.execute(players[1], cmd({ action: "join", code: room.code }));
    store.execute(players[0], cmd({ action: "leave", roomId: room.id }));
    expect(store.view(players[1].userId)!.hostUserId).toBe(players[1].userId);
    store.execute(players[1], cmd({ action: "leave", roomId: room.id }));
    expect(store.size).toBe(0);
  });

  it("only offers internal computer actions while humans are online and rejects stale, illegal or wrong-seat replies", () => {
    let now = 1000;
    const store = new RoomStore({ now: () => now });
    const room = store.execute(players[0], cmd({ action: "create", mode: "east", variant: "sanma" }))!;
    store.execute(players[0], cmd({ action: "fill-bots", roomId: room.id }));
    store.execute(players[0], cmd({ action: "ready", ready: true, roomId: room.id }));
    store.execute(players[0], cmd({ action: "start", roomId: room.id }));
    expect(store.botDecisions()).toEqual([]);
    store.connection(players[0].userId, 1);
    for (let i = 0; i < 20 && !store.botDecisions().length; i++) {
      const view = store.view(players[0].userId)!.game!;
      store.execute(players[0], cmd({ action: "respond", roomId: room.id, decisionId: view.decisionId, choiceId: view.choices[0].id }));
    }
    const job = store.botDecisions()[0];
    expect(job).toBeDefined();
    expect(store.respondBot({ ...job, seat: 0 }, job.view.choices[0].id)).toBe(false);
    expect(store.respondBot({ ...job, version: job.version - 1 }, job.view.choices[0].id)).toBe(false);
    expect(store.respondBot(job, "made-up-choice")).toBe(false);
    expect(store.respondBot(job, job.view.choices[0].id)).toBe(true);
    expect(store.respondBot(job, job.view.choices[0].id)).toBe(false);
    store.connection(players[0].userId, -1);
    expect(store.botDecisions()).toEqual([]);
    now += 600000;
    store.sweep();
    expect(store.size).toBe(0);
  });
});
