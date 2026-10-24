import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { monthlyStats } from "./stats.js";
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
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS wechat_sessions(token TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS wechat_accounts(appid TEXT NOT NULL,openid TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(appid,openid)); INSERT OR IGNORE INTO profiles SELECT id,name,'' FROM sessions;",
    );
  }
  profile(id) {
    return this.db
      .prepare("SELECT id,name,avatar FROM profiles WHERE id=?")
      .get(id);
  }
  updateProfile(u, name, avatar) {
    name = nickname(name);
    return this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM profiles WHERE name=? AND id<>? LIMIT 1").get(name, u.id))
        throw new HttpError(409, "这个用户名已被使用，请换一个名字");
      const old = this.profile(u.id);
      this.db.prepare("INSERT INTO profiles(id,name,avatar) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar")
        .run(u.id, name, avatar ?? old?.avatar ?? "");
      return this.profile(u.id);
    });
  }
  wechatSession(appId, openid) {
    return this.transaction(() => {
      let bind = this.db
        .prepare("SELECT id FROM wechat_accounts WHERE appid=? AND openid=?")
        .get(appId, openid);
      if (!bind) {
        bind = { id: randomUUID() };
        this.db
          .prepare("INSERT INTO wechat_accounts VALUES(?,?,?)")
          .run(appId, openid, bind.id);
        this.db
          .prepare("INSERT INTO profiles VALUES(?,?,?)")
          .run(bind.id, "牌友", "");
      }
      const p = this.profile(bind.id),
        token = randomBytes(32).toString("hex");
      this.db
        .prepare("INSERT INTO sessions(token,id,name,expires) VALUES(?,?,?,?)")
        .run(hash(token), p.id, p.name, Date.now() + 30 * 86400000);
      this.db.prepare("INSERT INTO wechat_sessions VALUES(?)").run(hash(token));
      return { ...p, token };
    });
  }
  invitation(code) {
    if (!/^[a-f0-9]{32}$/.test(code ?? ""))
      throw new HttpError(400, "邀请无效");
    const row = this.db.prepare("SELECT id FROM rooms WHERE code=?").get(code);
    if (!row) throw new HttpError(404, "牌桌不存在");
    const s = this.raw(row.id);
    return {
      players: s.rules.players,
      finished: s.finished,
      seats: s.members.map((m, seat) => ({
        seat,
        occupied: !!m,
        name: m ? (this.profile(m.id)?.name ?? m.name) : "空位",
        avatar: m ? (this.profile(m.id)?.avatar ?? "") : "",
      })),
    };
  }
  stats(u, month) {
    return monthlyStats(
      this.db
        .prepare("SELECT state FROM rooms")
        .all()
        .map((r) => JSON.parse(r.state)),
      u.id,
      month,
      (id) => this.profile(id),
    );
  }
  close() {
    this.db.close();
  }
  identity(token) {
    return token
      ? this.db
          .prepare(
            "SELECT s.id,COALESCE(p.name,s.name) AS name,COALESCE(p.avatar,'') AS avatar,CASE WHEN w.token IS NULL THEN 'web' ELSE 'wechat' END AS channel FROM sessions s LEFT JOIN profiles p ON p.id=s.id LEFT JOIN wechat_sessions w ON w.token=s.token WHERE s.token=? AND expires>?",
          )
          .get(hash(token), Date.now())
      : null;
  }
  session(name) {
    name = nickname(name);
    return this.transaction(() => {
      const matches = this.db.prepare("SELECT id FROM profiles WHERE name=? LIMIT 2").all(name);
      if (matches.length > 1)
        throw new HttpError(409, "历史账号存在同名，请在原浏览器修改名字后再登录");
      const id = matches[0]?.id ?? randomUUID();
      if (!matches.length) this.db.prepare("INSERT INTO profiles VALUES(?,?,?)").run(id, name, "");
      const token = randomBytes(32).toString("hex");
      this.db.prepare("INSERT INTO sessions(token,id,name,expires) VALUES(?,?,?,?)")
        .run(hash(token), id, name, Date.now() + 90 * 86400000);
      return { token, id, name };
    });
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
      members: s.members.map((m) =>
        m
          ? {
              name: this.profile(m.id)?.name ?? m.name,
              avatar: this.profile(m.id)?.avatar ?? "",
            }
          : null,
      ),
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
      .map((s) => ({
        id: s.id,
        players: s.rules.players,
        hand: s.hand,
        finished: s.finished,
        scores: [...s.scores],
        mySeat: s.members.findIndex(m => m?.id === u.id),
        net: s.scores[s.members.findIndex(m => m?.id === u.id)] - s.rules.start,
        hands: s.history.filter(h => h.kind !== "finish").length,
        updatedAt: s.history.at(-1)?.createdAt ?? s.createdAt ?? null,
        names: s.members.map((m) =>
          m ? this.profile(m.id)?.name ?? m.name : "空位",
        ),
      }));
  }
  create(u, { players = 4, kiriage = false, kazoe = true, chooseDealer = false, rounds = 2 } = {}) {
    if (typeof kiriage !== "boolean" || typeof kazoe !== "boolean")
      throw new HttpError(400, "规则设置无效");
    integer(rounds, 1, 2, "场长");
    const rules = { ...defaults(players), kiriage, kazoe, rounds };
    const s = {
      id: randomUUID(),
      code: randomBytes(16).toString("hex"),
      owner: u.id,
      createdAt: new Date().toISOString(),
      rules,
      version: 1,
      members: Array(players).fill(null),
      scores: Array(players).fill(rules.start),
      dealer: 0,
      dealerSelected: !chooseDealer,
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
      if (seat === undefined) seat = s.members.findIndex(m => !m);
      if (seat < 0) throw new HttpError(409, "牌桌已满");
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
        return input.action === "rematch" && s.nextRoomId ? this.get(s.nextRoomId, u) : this.public(s, u);
      if(input.action === "rematch" && s.nextRoomId && this.db.prepare("SELECT 1 FROM rooms WHERE id=?").get(s.nextRoomId)) return this.get(s.nextRoomId,u);
      if (input.version !== s.version)
        throw new HttpError(409, "牌桌已更新，请刷新后再提交");
      if (input.action === "delete") {
        this.db.prepare("DELETE FROM commands WHERE room=?").run(id);
        this.db.prepare("DELETE FROM rooms WHERE id=?").run(id);
        return {id, deleted:true};
      }
      if(input.action === "rematch") {
        if(!s.finished) throw new HttpError(409,"请先结束当前牌局");
        const created=this.create(u,{...s.rules,chooseDealer:true});
        const next=this.raw(created.id);
        next.members=structuredClone(s.members);next.rules={...structuredClone(s.rules),rounds:s.rules.rounds??2};
        this.save(next);s.nextRoomId=next.id;
      } else if(input.action === "set-length") {
        if(s.finished || s.history.length) throw new HttpError(409,"开始记分后不能更改场长");
        integer(input.rounds,1,2,"场长");s.rules.rounds=input.rounds;
      } else if(input.action === "remove-player") {
        if(s.finished || s.history.length) throw new HttpError(409,"开始记分后不能更换玩家");
        integer(input.seat,0,s.rules.players-1,"座位");
        if(s.members[input.seat]?.id===u.id) throw new HttpError(400,"请由另一位玩家更换你的座位成员");
        s.members[input.seat]=null;s.dealerSelected=false;
      } else if (input.action === "reorder") {
        if(s.finished || s.history.length) throw new HttpError(409,"开始记分后不能调整座位");
        const order=input.order;
        if(!Array.isArray(order)||order.length!==s.rules.players||new Set(order).size!==order.length||order.some(i=>!Number.isInteger(i)||i<0||i>=s.rules.players)) throw new HttpError(400,"座位顺序无效");
        s.members=order.map(i=>s.members[i]);s.scores=order.map(i=>s.scores[i]);
        s.dealer=0;s.dealerSelected=false;
      } else if (input.action === "undo") {
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
        if (s.dealerSelected === false) throw new HttpError(409, "请先选择起庄玩家");
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
      } else if (input.action === "set-dealer") {
        if (s.finished || s.history.length) throw new HttpError(409, "开始记分后不能更改起庄玩家");
        integer(input.seat, 0, s.rules.players - 1, "座位");
        if (s.members.some(m => !m)) throw new HttpError(409, "请先为所有座位添加成员");
        // 起庄玩家为东家；按原座位顺序整体旋转，账号和点数始终对应。
        s.members = [...s.members.slice(input.seat), ...s.members.slice(0, input.seat)];
        s.scores = [...s.scores.slice(input.seat), ...s.scores.slice(0, input.seat)];
        s.dealer = 0;
        s.dealerSelected = true;
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
      return input.action === "rematch" ? this.get(s.nextRoomId,u) : this.public(s, u);
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
