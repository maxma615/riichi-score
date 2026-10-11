import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  NativeFlights,
  pathFor,
  FLIGHT_MS,
} = require("../miniprogram/utils/online-flight");
const { snapshot, tile } = require("../miniprogram/utils/online");
mkdirSync(".local/test-data", { recursive: true });
const compiled = path.resolve(
  `.local/test-data/native-flight-${process.pid}.mjs`,
);
await build({
  entryPoints: ["tests/online-interaction-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: compiled,
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
const { scenario } = await import(pathToFileURL(compiled));
after(() => rmSync(compiled, { force: true }));
const target = { left: 300, top: 200, width: 24, height: 34 };
function harness(room, riichi = false) {
  const queued = [],
    timers = new Map(),
    steps = [],
    updates = [];
  let nextId = 0;
  const host = {
    active: true,
    data: {
      ...snapshot({ room }, riichi),
      flight: null,
      flightAnimation: {},
      motionTarget: "",
    },
    setData(v, done) {
      updates.push(v);
      Object.assign(this.data, v);
      done?.();
    },
  };
  const api = {
    createSelectorQuery() {
      const selectors = [];
      return {
        in(owner) {
          assert.equal(owner, host);
          return this;
        },
        select(s) {
          selectors.push(s);
          return this;
        },
        selectAll(s) {
          selectors.push(s);
          return this;
        },
        boundingClientRect() {
          return this;
        },
        exec(cb) {
          queued.push({ selectors, cb });
        },
      };
    },
    createAnimation(options) {
      assert.equal(options.duration, FLIGHT_MS);
      let frame = {},
        batch = [];
      return {
        translate(x, y) {
          frame.translate = [x, y];
          return this;
        },
        scale(x, y) {
          frame.scale = [x, y];
          return this;
        },
        rotate(angle) {
          frame.angle = angle;
          return this;
        },
        step(options) {
          batch.push({ ...frame, duration: options.duration });
          frame = {};
          return this;
        },
        export() {
          const result = { actions: batch };
          steps.push(...batch);
          batch = [];
          return result;
        },
      };
    },
  };
  const flights = new NativeFlights(host, api, {
    setTimeout(fn, ms) {
      assert.equal(ms, FLIGHT_MS + 60);
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  function capture() {
    flights.capture();
    const q = queued.shift();
    assert.deepEqual(q.selectors, [
      ".hand .tile",
      ".opponent .back",
      ".river-slot",
    ]);
    q.cb([
      host.data.hand.map((t, i) => ({
        left: 30 + i * 44,
        top: 500,
        width: 42,
        height: 60,
      })),
      host.data.seats
        .filter((s) => !s.self)
        .flatMap((s) =>
          s.hidden.map((_, i) => ({
            left: 100 + s.seat * 60,
            top: 60 + i * 3,
            width: 20,
            height: 30,
          })),
        ),
      host.data.seats.flatMap((s) =>
        s.river.map((t, i) => ({
          left: 200 + s.seat * 20,
          top: 160 + i * 26,
          width: t.sideways ? 25 : 17,
          height: t.sideways ? 17 : 25,
        })),
      ),
    ]);
  }
  function render(room, plan) {
    host.setData(snapshot({ room }));
    flights.start(plan);
  }
  function destination() {
    const q = queued.shift();
    assert.deepEqual(q.selectors, ["#" + flights.plan.target]);
    q.cb([target]);
  }
  function finish() {
    assert.equal(timers.size, 1);
    const [id, fn] = timers.entries().next().value;
    timers.delete(id);
    fn();
  }
  flights.prepare(null, room, false);
  capture();
  return {
    host,
    flights,
    queued,
    timers,
    steps,
    updates,
    capture,
    render,
    destination,
    finish,
  };
}

test("原生实体牌路径按测量中心和方向缩放，拒绝无效尺寸", () => {
  const p = pathFor(
    { left: 10, top: 20, width: 30, height: 20 },
    { left: 100, top: 150, width: 60, height: 40 },
    90,
    90,
  );
  assert.deepEqual(p, {
    style: "left:15px;top:15px;width:20px;height:30px;",
    dx: 105,
    dy: 140,
    sx: 2,
    sy: 2,
    fromAngle: 90,
    toAngle: 90,
  });
  assert.equal(pathFor({ ...target, width: 0 }, target, 0, 0), null);
  assert.equal(pathFor({ ...target, left: NaN }, target, 0, 0), null);
});

test("真实立直从选中的物理牌飞到实际牌河槽，完成后无残留影子和重复播放", () => {
  const f = scenario("riichi", false),
    before = f.view(),
    h = harness(before, true);
  const c = before.game.choices.find((c) => c.type === "riichi"),
    t = h.host.data.hand.find((t) => t.choiceId === c.id);
  assert.ok(t);
  const after = f.choose({ id: c.id, decisionId: before.game.decisionId });
  const plan = h.flights.prepare(before, after, true, {
    key: t.physicalKey,
    choiceId: c.id,
    decisionId: before.game.decisionId,
    shift: { x: 15, y: -40 },
  });
  assert.ok(plan);
  assert.equal(plan.toAngle, 90);
  assert.match(plan.id, /^discard:/);
  assert.equal(plan.from.left, 30 + t.id * 44 + 15);
  assert.equal(plan.from.top, 460);
  h.render(after, plan);
  h.destination();
  assert.equal(h.host.data.flight.src, tile(c.value).src);
  assert.equal(h.host.data.motionTarget, "river-0-0");
  assert.deepEqual(
    h.steps.map((s) => s.duration),
    [0, 230],
  );
  assert.equal(h.timers.size, 1);
  assert.equal(h.flights.prepare(after, after, true), null);
  assert.equal(h.timers.size, 1);
  h.finish();
  assert.equal(h.host.data.flight, null);
  assert.equal(h.host.data.motionTarget, "");
  assert.equal(h.timers.size, 0);
  assert.equal(h.flights.prepare(after, after, true), null);
});

test("真实对手切牌仅使用公共弃牌和牌背位置；断续快照不补演", () => {
  const f = scenario("riichi", false),
    initial = f.view();
  const c = initial.game.choices.find(
    (c) => c.type === "discard" && c.value === "z3_",
  );
  f.choose({ id: c.id, decisionId: initial.game.decisionId });
  for (let s = 1; s < 4; s++)
    if (f.viewFor(s).game.choices.some((c) => c.type === "pass"))
      f.act(s, "pass");
  const before = f.view();
  assert.equal(before.game.turnSeat, 1);
  const h = harness(before),
    cut = f.viewFor(1).game.choices.find((c) => c.type === "discard");
  const after = f.act(1, "discard", cut.value),
    plan = h.flights.prepare(before, after, true);
  assert.ok(plan);
  assert.equal(plan.target, "river-1-0");
  assert.equal(plan.fromAngle, -90);
  h.render(after, plan);
  h.destination();
  assert.equal(h.host.data.flight.src, tile(cut.value).src);
  h.flights.cancel();
  assert.equal(h.host.data.flight, null);
  assert.equal(h.timers.size, 0);
  const gap = scenario("riichi", false),
    old = gap.view(),
    g = harness(old);
  const discard = old.game.choices.find((c) => c.type === "discard");
  gap.choose({ id: discard.id, decisionId: old.game.decisionId });
  for (let s = 1; s < 4; s++)
    if (gap.viewFor(s).game.choices.some((c) => c.type === "pass"))
      gap.act(s, "pass");
  if (gap.view().version === old.version + 1) {
    const turn = gap.view().game.turnSeat,
      next = gap.viewFor(turn).game.choices.find((c) => c.type === "discard");
    assert.ok(next);
    gap.act(turn, "discard", next.value);
  }
  const newer = gap.view();
  assert.ok(newer.version > old.version + 1);
  assert.equal(g.flights.prepare(old, newer, true), null);
});

test("真实拔北飞到保留的北牌槽，多张北不猜来源，改为到达强调", () => {
  for (const name of ["nuki", "nuki-double"]) {
    const f = scenario(name, false),
      before = f.view(),
      h = harness(before);
    const c = before.game.choices.find((c) => c.type === "nuki");
    assert.ok(c);
    const after = f.choose({ id: c.id, decisionId: before.game.decisionId });
    const plan = h.flights.prepare(before, after, true);
    assert.ok(plan);
    assert.equal(plan.target, "north-0-0");
    assert.equal(plan.pulse, name === "nuki-double");
    h.render(after, plan);
    h.destination();
    assert.equal(h.host.data.game.players.find((p) => p.seat === 0).nuki, 1);
    assert.equal(h.host.data.seats[0].north.length, 1);
    assert.equal(h.host.data.motionTarget, "north-0-0");
    assert.equal(Boolean(h.host.data.flight), name === "nuki");
    if (name === "nuki") assert.match(h.host.data.flight.src, /Pei.png$/);
    h.finish();
    assert.equal(h.host.data.flight, null);
    assert.equal(h.host.data.motionTarget, "");
  }
});

test("迟到的目标测量在后台／旋转／换局／重连后不隐藏或复活旧牌", () => {
  for (const change of ["hide", "resize", "new-hand", "baseline"]) {
    const f = scenario("nuki", false),
      before = f.view(),
      h = harness(before),
      c = before.game.choices.find((c) => c.type === "nuki");
    const after = f.choose({ id: c.id, decisionId: before.game.decisionId }),
      plan = h.flights.prepare(before, after, true);
    h.render(after, plan);
    const late = h.queued.shift();
    if (change === "hide") {
      h.host.active = false;
      h.flights.cancel(true);
    }
    if (change === "resize") h.flights.cancel();
    if (change === "new-hand") {
      h.host.setData({
        room: {
          ...after,
          game: { ...after.game, handId: after.game.handId + 1 },
        },
      });
      h.flights.cancel();
    }
    if (change === "baseline") h.flights.prepare(after, after, false);
    late.cb([target]);
    assert.equal(h.host.data.flight, null);
    assert.equal(h.host.data.motionTarget, "");
    assert.equal(h.timers.size, 0);
  }
});

test("目标消失或原生动画API异常时保留实体牌，不留下隐藏目标或计时器", () => {
  for (const mode of ["missing", "error"]) {
    const f = scenario("nuki", false),
      before = f.view(),
      h = harness(before),
      c = before.game.choices.find((c) => c.type === "nuki");
    const after = f.choose({ id: c.id, decisionId: before.game.decisionId }),
      plan = h.flights.prepare(before, after, true);
    if (mode === "error")
      h.flights.api.createAnimation = () => {
        throw Error("animation unavailable");
      };
    h.render(after, plan);
    const q = h.queued.shift();
    assert.doesNotThrow(() => q.cb(mode === "missing" ? [null] : [target]));
    assert.equal(h.host.data.motionTarget, "");
    assert.equal(h.host.data.flight, null);
    assert.equal(h.timers.size, 0);
    assert.equal(h.host.data.seats[0].north.length, 1);
  }
});

test("真实吃碰明杠从被鸣走的牌河飞到对应横牌；暗杠与加杠强调实际牌体", () => {
  for (const name of ["chi", "pon", "daiminkan", "ankan", "kakan"]) {
    const f = scenario(name, false);
    let before = f.view(),
      h = harness(before);
    const type = ["ankan", "kakan", "daiminkan"].includes(name) ? "kan" : name;
    const c = before.game.choices.find((c) => c.type === type);
    assert.ok(c, name);
    let after = f.choose({ id: c.id, decisionId: before.game.decisionId });
    let plan = h.flights.prepare(before, after, true);
    for (let seat = 0; !plan && seat < 4; seat++) {
      if (f.viewFor(seat).game.choices.some((c) => c.type === "pass")) {
        h.host.setData(snapshot({ room: after }));
        h.capture();
        before = after;
        after = f.act(seat, "pass");
        plan = h.flights.prepare(before, after, true);
      }
    }
    assert.ok(plan, name);
    assert.match(plan.target, /^meld-/);
    h.render(after, plan);
    h.destination();
    const set = h.host.data.seats.find((s) => s.seat === after.game.turnSeat)
      .melds[0];
    const dest = set.find((t) => t.nodeId === plan.target);
    assert.ok(dest);
    if (["chi", "pon", "daiminkan"].includes(name)) {
      assert.ok(dest.called);
      assert.equal(plan.pulse, false);
      assert.equal(h.host.data.flight.src, dest.src);
      assert.equal(h.host.data.seats[0].river.length, 0);
    } else {
      assert.equal(plan.pulse, true);
      assert.equal(h.host.data.flight, null);
      if (name === "ankan") assert.equal(set.filter((t) => t.back).length, 2);
      else assert.ok(dest.added);
    }
    h.finish();
    assert.equal(h.host.data.motionTarget, "");
    assert.equal(h.timers.size, 0);
  }
});

test("两端副露解析同源：鸣牌来源、赤五、加杠叠放和无效编码", () => {
  const { meld } = require("../miniprogram/utils/online");
  for (const [marker, index] of [
    ["-", 0],
    ["=", 1],
    ["+", 2],
  ]) {
    const pon = meld(`p550${marker}`);
    assert.equal(
      pon.findIndex((t) => t.called),
      index,
    );
    assert.equal(pon[index].key, "p0");
    const kan = meld(`p550${marker}5`);
    assert.equal(
      kan.findIndex((t) => t.called),
      index,
    );
    assert.equal(kan[3].stackStyle, `left:${index * 18}px;`);
    assert.ok(kan[3].added);
  }
  const chi = meld("m34-5");
  assert.deepEqual(
    chi.map((t) => t.key),
    ["m4", "m3", "m5"],
  );
  assert.ok(chi[0].called);
  const concealed = meld("p5550");
  assert.deepEqual(
    concealed.map((t) => t.back),
    [true, false, false, true],
  );
  assert.equal(concealed[1].key, "p0");
  for (const bad of ["p12+", "z123-", "p005+", "m135-"])
    assert.deepEqual(meld(bad), []);
});

test("旁观座位的鸣牌路径跟随各家的桌边方向，沿用公开牌河而非手牌", () => {
  const f = scenario("pon", false), before = f.viewFor(2), h = harness(before);
  const own = f.view(), c = own.game.choices.find(c => c.type === 'pon');
  f.choose({id:c.id,decisionId:own.game.decisionId});
  const after = f.viewFor(2), plan = h.flights.prepare(before,after,true);
  assert.ok(plan);assert.equal(plan.fromAngle,180);assert.equal(plan.toAngle,180);
  assert.equal(plan.target,'meld-1-0-0');assert.equal(plan.pulse,false);
  h.render(after,plan);h.destination();
  assert.equal(h.host.data.flight.src,tile('p1').src);
  assert.equal(h.host.data.seats.find(s=>s.seat===1).edge,'left');
  h.flights.cancel();assert.equal(h.timers.size,0);assert.equal(h.host.data.motionTarget,'');
});
