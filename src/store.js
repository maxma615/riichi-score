import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { defaults, settle, integer } from "./scoring.js";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const hash = (s) => createHash("sha256").update(s).digest("hex");
export function nickname(s) {
  if (typeof s !== "string" || s.trim().length < 1 || s.trim().length > 24)
    throw new HttpError(400, "昵称需为1–24个字");
  return s.trim();
}
export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,id TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS commands (room TEXT NOT NULL,nonce TEXT NOT NULL, PRIMARY KEY(room,nonce));",
    );
  }
  close() {
    this.db.close();
  }
  identity(token) {
    return token
      ? this.db
          .prepare("SELECT id,name FROM sessions WHERE token=? AND expires>?")
          .get(hash(token), Date.now())
      : null;
  }
  session(name) {
    name = nickname(name);
    const token = randomBytes(32).toString("hex"),
      id = randomUUID();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(hash(token), id, name, Date.now() + 90 * 86400000);
    return { token, id, name };
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  raw(id) {
    const row = this.db.prepare("SELECT state FROM rooms WHERE id=?").get(id);
    if (!row) throw new HttpError(404, "牌桌不存在");
    return JSON.parse(row.state);
  }
  save(s) {
    this.db
      .prepare("UPDATE rooms SET state=? WHERE id=?")
      .run(JSON.stringify(s), s.id);
  }
  member(s, u) {
    if (!u || !s.members.some((m) => m?.id === u.id))
      throw new HttpError(403, "请通过邀请加入这张牌桌");
  }
  public(s, u) {
    this.member(s, u);
    return {
      ...s,
      owner: undefined,
      members: s.members.map((m) => (m ? { name: m.name } : null)),
      isOwner: s.owner === u.id,
      mySeat: s.members.findIndex((m) => m?.id === u.id),
    };
  }
  get(id, u) {
    return this.public(this.raw(id), u);
  }
  list(u) {
    return this.db
      .prepare("SELECT state FROM rooms ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.state))
      .filter((s) => s.members.some((m) => m?.id === u.id))
      .slice(0, 30)
      .map((s) => ({
        id: s.id,
        players: s.rules.players,
        hand: s.hand,
        finished: s.finished,
        names: s.members.map((m) => m?.name ?? "空位"),
      }));
  }
  create(u, { players = 4, kiriage = false, kazoe = true } = {}) {
    if (typeof kiriage !== "boolean" || typeof kazoe !== "boolean")
      throw new HttpError(400, "规则设置无效");
    const rules = { ...defaults(players), kiriage, kazoe };
    const s = {
      id: randomUUID(),
      code: randomBytes(16).toString("hex"),
      owner: u.id,
      rules,
      version: 1,
      members: Array(players).fill(null),
      scores: Array(players).fill(rules.start),
      dealer: 0,
      hand: 0,
      honba: 0,
      pot: 0,
      history: [],
      finished: false,
    };
    s.members[0] = { id: u.id, name: u.name };
    this.db
      .prepare("INSERT INTO rooms VALUES(?,?,?)")
      .run(s.id, s.code, JSON.stringify(s));
    return this.public(s, u);
  }
  join(u, code, seat) {
    if (typeof code !== "string" || !/^[a-f0-9]{32}$/.test(code))
      throw new HttpError(400, "邀请代码无效");
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT id FROM rooms WHERE code=?")
        .get(code);
      if (!row) throw new HttpError(404, "邀请不存在");
      const s = this.raw(row.id);
      if (s.members.some((m) => m?.id === u.id)) return this.public(s, u);
      integer(seat, 0, s.rules.players - 1, "座位");
      if (s.finished) throw new HttpError(409, "牌局已结束");
      if (s.members[seat]) throw new HttpError(409, "座位已被占用");
      s.members[seat] = { id: u.id, name: u.name };
      s.version++;
      this.save(s);
      return this.public(s, u);
    });
  }
  command(u, id, input) {
    return this.transaction(() => {
      let s = this.raw(id);
      this.member(s, u);
      if (s.owner !== u.id) throw new HttpError(403, "只有桌主可以记分");
      if (
        typeof input.nonce !== "string" ||
        !/^[a-zA-Z0-9-]{8,80}$/.test(input.nonce)
      )
        throw new HttpError(400, "提交编号无效");
      if (
        this.db
          .prepare("SELECT 1 FROM commands WHERE room=? AND nonce=?")
          .get(id, input.nonce)
      )
        return this.public(s, u);
      if (input.version !== s.version)
        throw new HttpError(409, "牌桌已更新，请刷新后再提交");
      if (input.action === "undo") {
        const last = s.history.pop();
        if (!last) throw new HttpError(409, "没有可撤回的记录");
        Object.assign(s, last.before);
        s.finished = false;
      } else if (input.action === "finish") {
        if (s.finished) throw new HttpError(409, "牌局已结束");
        s.history.push({
          before: this.snapshot(s),
          kind: "finish",
          description: "结束牌局",
          delta: Array(s.rules.players).fill(0),
          createdAt: new Date().toISOString(),
          hand: s.hand,
          honba: s.honba,
        });
        s.finished = true;
      } else if (input.action === "record") {
        if (s.finished) throw new HttpError(409, "牌局已结束");
        if (s.members.some((m) => !m))
          throw new HttpError(409, "请先为所有座位添加成员");
        const before = this.snapshot(s),
          { next, delta, description } = settle(s, input.event);
        s = next;
        s.history.push({
          before,
          kind: input.event.kind,
          event: input.event,
          description,
          delta,
          createdAt: new Date().toISOString(),
          hand: before.hand,
          honba: before.honba,
        });
      } else if (input.action === "add-player") {
        if (s.history.length) throw new HttpError(409, "开始记分后不能改座位");
        integer(input.seat, 0, s.rules.players - 1, "座位");
        if (s.members[input.seat]) throw new HttpError(409, "座位已被占用");
        s.members[input.seat] = {
          id: randomUUID(),
          name: nickname(input.name),
        };
      } else throw new HttpError(400, "操作无效");
      s.version++;
      this.save(s);
      this.db.prepare("INSERT INTO commands VALUES(?,?)").run(id, input.nonce);
      return this.public(s, u);
    });
  }
  snapshot(s) {
    return {
      scores: [...s.scores],
      dealer: s.dealer,
      hand: s.hand,
      honba: s.honba,
      pot: s.pot,
      finished: s.finished,
    };
  }
}
