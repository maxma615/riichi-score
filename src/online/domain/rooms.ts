import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors";
import { RiichiGame } from "./engine";
import { SanmaGame } from "./sanma";
import { SettlementSequenceGame } from "./settlement-sequence";
import type { GameMode, GameVariant, GameView, MahjongCommand, MahjongGame, PlayerIdentity, RoomView } from "./types";

const nonce = z.string().uuid();
const commandSchema = z.discriminatedUnion("action", [
  z.object({ nonce, action: z.literal("create"), mode: z.enum(["east", "hanchan"]), variant: z.enum(["sanma", "yonma"]).optional() }).strict(),
  ...["add-bot", "remove-bot"].map(action => z.object({ nonce, action: z.literal(action as "add-bot" | "remove-bot"), seat: z.number().int().min(0).max(3), roomId: z.string().uuid() }).strict()),
  z.object({ nonce, action: z.literal("fill-bots"), roomId: z.string().uuid() }).strict(),
  z.object({ nonce, action: z.literal("join"), code: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{8}$/) }).strict(),
  z.object({ nonce, action: z.literal("ready"), ready: z.boolean(), roomId: z.string().uuid() }).strict(),
  ...["start", "leave", "finish", "rematch"].map(action => z.object({ nonce, action: z.literal(action as "start" | "leave" | "finish" | "rematch"), roomId: z.string().uuid() }).strict()),
  z.object({ nonce, action: z.literal("respond"), decisionId: z.string().max(80), choiceId: z.string().min(1).max(40), roomId: z.string().uuid() }).strict(),
]);

export function parseMahjongCommand(value: unknown): MahjongCommand {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "invalid_mahjong_command", "牌桌操作无效，请检查房间码或刷新页面");
  return parsed.data as MahjongCommand;
}

type Seat = PlayerIdentity & { kind: "human" | "bot"; seat: number; ready: boolean };
type Room = {
  id: string;
  code: string;
  hostUserId: string;
  variant: GameVariant;
  mode: GameMode;
  status: RoomView["status"];
  version: number;
  members: Seat[];
  game: MahjongGame | null;
  lastActivity: number;
  disconnectedSince: number | null;
  finishedAt: number | null;
};
export type BotDecision = {
  roomId: string;
  version: number;
  decisionId: string;
  seat: number;
  variant: GameVariant;
  view: GameView;
};

export const ROOM_IDLE_MS = 10 * 60_000;

export class RoomStore {
  private rooms = new Map<string, Room>();
  private membership = new Map<string, string>();
  private connections = new Map<string, number>();
  private commands = new Map<string, string>();
  private listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly gameFactory: (variant: GameVariant, mode: GameMode, names: string[]) => RiichiGame | SanmaGame;
  constructor(options: { now?: () => number; gameFactory?: (variant: GameVariant, mode: GameMode, names: string[]) => RiichiGame | SanmaGame } = {}) {
    this.now = options.now ?? Date.now;
    this.gameFactory = options.gameFactory ?? ((variant, mode, names) => variant === "sanma" ? new SanmaGame(mode, names) : new RiichiGame(mode, names));
  }
  get size() { return this.rooms.size; }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed() { for (const listener of this.listeners) listener(); }

  private humanOnline(room: Room) {
    return room.members.some(m => m.kind === "human" && (this.connections.get(m.userId) ?? 0) > 0);
  }

  get hasOnlineBotTable() {
    return [...this.rooms.values()].some(room =>
      room.status === "playing" && this.humanOnline(room)
      && room.members.some(m => m.kind === "bot"));
  }

  botDecisions(): BotDecision[] {
    return [...this.rooms.values()].flatMap(room => {
      if (room.status !== "playing" || !room.game || !this.humanOnline(room)) return [];
      return room.members.filter(m => m.kind === "bot").flatMap(member => {
        const view = room.game!.view(member.seat);
        if (!view.choices.length) return [];
        return [{
          roomId: room.id, version: room.version, decisionId: view.decisionId,
          seat: member.seat, variant: room.variant, view,
        }];
      });
    });
  }

  isBotDecisionCurrent(job: BotDecision) {
    const room = this.rooms.get(job.roomId);
    if (!room || room.version !== job.version || room.status !== "playing"
      || !this.humanOnline(room) || !room.game
      || !room.members.some(m => m.kind === "bot" && m.seat === job.seat)) return false;
    const view = room.game.view(job.seat);
    return view.decisionId === job.decisionId && view.choices.length > 0;
  }

  respondBot(job: BotDecision, choiceId: string) {
    if (!this.isBotDecisionCurrent(job)) return false;
    const room = this.rooms.get(job.roomId)!;
    if (!room.game!.view(job.seat).choices.some(c => c.id === choiceId)) return false;
    room.game!.respond(job.seat, job.decisionId, choiceId);
    this.updateFinished(room, job.seat);
    room.version++;
    // Computer activity never extends the human offline grace period.
    this.changed();
    return true;
  }

  private updateFinished(room: Room, seat: number) {
    if (room.game?.view(seat).ranking) {
      room.status = "finished";
      room.finishedAt ??= this.now();
    }
  }

  connection(userId: string, delta: number) {
    if (userId.startsWith("bot:")) return;
    const n = Math.max(0, (this.connections.get(userId) ?? 0) + delta);
    if (n) this.connections.set(userId, n); else this.connections.delete(userId);
    const room = this.ownRoom(userId);
    if (room) this.updateDisconnected(room);
    this.changed();
  }

  private updateDisconnected(room: Room) {
    if (this.humanOnline(room)) room.disconnectedSince = null;
    else room.disconnectedSince ??= this.now();
  }

  private ownRoom(userId: string) { return this.rooms.get(this.membership.get(userId) ?? ""); }
  private removeRoom(room: Room) {
    this.rooms.delete(room.id);
    room.members.forEach(m => this.membership.delete(m.userId));
    this.changed();
  }

  sweep(now = this.now()) {
    for (const room of this.rooms.values()) {
      if (room.disconnectedSince !== null && now - Math.max(room.lastActivity, room.disconnectedSince) >= ROOM_IDLE_MS) this.removeRoom(room);
    }
  }

  view(userId: string): RoomView | null {
    const room = this.ownRoom(userId);
    const me = room?.members.find(m => m.userId === userId);
    if (!room || !me) return null;
    const game = room.game?.view(me.seat) ?? null;
    if (game && game.ranking && room.status === "finished" && room.finishedAt !== null) {
      game.rankingFlow = { id: game.gameInstanceId ?? room.id, elapsedMs: Math.max(0, this.now() - room.finishedAt) };
    }
    return {
      id: room.id, code: room.code, hostUserId: room.hostUserId, variant: room.variant, mode: room.mode, status: room.status,
      version: room.version, mySeat: me.seat,
      members: room.members.map(m => ({ ...m, connected: m.kind === "human" && (this.connections.get(m.userId) ?? 0) > 0 })),
      game,
    };
  }

  execute(player: PlayerIdentity, input: MahjongCommand): RoomView | null {
    if (player.userId.startsWith("bot:")) throw new AppError(403, "human_required", "电脑不能登录或提交玩家请求");
    const command = parseMahjongCommand(input);
    this.sweep();
    const key = player.userId + ":" + command.nonce;
    const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const seen = this.commands.get(key);
    if (seen) {
      if (seen !== hash) throw new AppError(409, "nonce_reused", "这个请求编号已用于其他操作");
      return this.view(player.userId);
    }
    this.apply(player, command);
    this.changed();
    this.commands.set(key, hash);
    if (this.commands.size > 4096) this.commands.delete(this.commands.keys().next().value!);
    return this.view(player.userId);
  }

  private apply(player: PlayerIdentity, command: MahjongCommand) {
    let room = this.ownRoom(player.userId);
    if (command.action === "create") {
      if (room) throw new AppError(409, "already_seated", "请先离开当前牌桌");
      if (this.rooms.size >= 8) throw new AppError(429, "rooms_full", "当前牌桌已满，请稍后再创建");
      let code: string;
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(""); } while ([...this.rooms.values()].some(r => r.code === code));
      room = { id: randomUUID(), code, hostUserId: player.userId, variant: command.variant ?? "yonma", mode: command.mode, status: "lobby", version: 1, members: [{ ...player, kind: "human", seat: 0, ready: false }], game: null, lastActivity: this.now(), disconnectedSince: null, finishedAt: null };
      this.rooms.set(room.id, room);
      this.membership.set(player.userId, room.id);
      this.updateDisconnected(room);
      return;
    }
    if (command.action === "join") {
      if (room) throw new AppError(409, "already_seated", "请先离开当前牌桌");
      room = [...this.rooms.values()].find(r => r.code === command.code);
      if (!room) throw new AppError(404, "room_missing", "牌桌不存在或已结束");
      if (room.status !== "lobby" || room.members.length >= (room.variant === "sanma" ? 3 : 4)) throw new AppError(409, "room_unavailable", "牌桌已满或已经开局");
      const seat = Array.from({ length: room.variant === "sanma" ? 3 : 4 }, (_, n) => n).find(n => !room!.members.some(m => m.seat === n))!;
      room.members.push({ ...player, kind: "human", seat, ready: false });
      room.members.sort((a, b) => a.seat - b.seat);
      this.membership.set(player.userId, room.id);
      this.updateDisconnected(room);
    } else {
      if (!room) throw new AppError(409, "seat_required", "你没有当前牌桌，请创建或加入一桌");
      if (room.id !== command.roomId) throw new AppError(409, "room_changed", "牌桌已改变，请按当前牌桌操作");
      const member = room.members.find(m => m.userId === player.userId)!;
      if (["start", "finish", "rematch", "add-bot", "remove-bot", "fill-bots"].includes(command.action) && room.hostUserId !== player.userId) throw new AppError(403, "host_required", "只有房主可以执行这个操作");
      switch (command.action) {
        case "add-bot":
        case "remove-bot":
        case "fill-bots": {
          if (room.status !== "lobby") throw new AppError(409, "game_in_progress", "只能在大厅调整电脑席位");
          const capacity = room.variant === "sanma" ? 3 : 4;
          if (command.action !== "fill-bots" && command.seat >= capacity) throw new AppError(400, "invalid_seat", "席位不存在");
          if (command.action === "remove-bot") {
            if (!room.members.some(m => m.seat === command.seat && m.kind === "bot")) throw new AppError(409, "bot_required", "只能移除电脑席位");
            room.members = room.members.filter(m => m.seat !== command.seat);
          } else {
            const seats = command.action === "add-bot"
              ? [command.seat]
              : Array.from({ length: capacity }, (_, n) => n)
                .filter(n => !room!.members.some(m => m.seat === n));
            for (const seat of seats) {
              if (room.members.some(m => m.seat === seat)) throw new AppError(409, "seat_taken", "席位已有人");
              room.members.push({
                userId: `bot:${randomUUID()}`, displayName: `电脑 ${seat + 1}`,
                kind: "bot", seat, ready: true,
              });
            }
            room.members.sort((a, b) => a.seat - b.seat);
          }
          break;
        }
        case "ready":
          if (room.status !== "lobby") throw new AppError(409, "game_in_progress", "当前不在准备阶段");
          member.ready = command.ready; break;
        case "start":
          if (room.status !== "lobby" || room.members.length !== (room.variant === "sanma" ? 3 : 4) || !room.members.every(m => m.ready)) throw new AppError(409, "all_ready_required", "需要席位补齐且全部真人准备");
          room.game = new SettlementSequenceGame(this.gameFactory(room.variant, room.mode, room.members.map(m => m.displayName)), room.variant === "sanma" ? 3 : 4, { now: this.now });
          room.status = "playing"; room.finishedAt = null; break;
        case "respond":
          if (room.status !== "playing" || !room.game) throw new AppError(409, "no_active_game", "当前没有进行中的对局");
          room.game.respond(member.seat, command.decisionId, command.choiceId);
          this.updateFinished(room, member.seat);
          break;
        case "leave":
          if (room.status === "playing") throw new AppError(409, "game_in_progress", "正在对局，短暂离线会保留你的座位；需要结束请由房主解散");
          room.members = room.members.filter(m => m.userId !== player.userId);
          this.membership.delete(player.userId);
          if (!room.members.some(m => m.kind === "human")) { this.removeRoom(room); return; }
          if (room.hostUserId === player.userId) room.hostUserId = room.members.find(m => m.kind === "human")!.userId;
          this.updateDisconnected(room); break;
        case "finish": this.removeRoom(room); return;
        case "rematch":
          if (room.status !== "finished") throw new AppError(409, "game_not_finished", "请先完成当前对局");
          room.game = null; room.status = "lobby"; room.finishedAt = null;
          room.members.forEach(m => { m.ready = m.kind === "bot"; }); break;
      }
    }
    room.version++;
    room.lastActivity = this.now();
  }
}
