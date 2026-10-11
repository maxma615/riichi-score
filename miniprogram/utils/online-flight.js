const {
  DiscardMotionTracker,
  acceptedNukiEvent,
  acceptedPublicCallEvent,
  acceptedPendingKakanEvent,
} = require("./online-motion");
const { tile, river } = require("./online");
const FLIGHT_MS = 230; // Same duration as web use-discard-motion / use-nuki-motion.
const angles = { bottom: 0, left: 90, right: -90, top: 180 };
const validRect = (r) =>
  r &&
  ["left", "top", "width", "height"].every((k) => Number.isFinite(r[k])) &&
  r.width > 0 &&
  r.height > 0;
const context = (room) =>
  room?.game
    ? [
        room.id,
        room.mySeat,
        room.version,
        room.game.gameInstanceId,
        room.game.handId,
        room.game.decisionId,
      ].join(":")
    : "";
function pathFor(from, to, fromAngle, toAngle) {
  if (
    !validRect(from) ||
    !validRect(to) ||
    !Number.isFinite(fromAngle) ||
    !Number.isFinite(toAngle)
  )
    return null;
  const sideways = (angle) => Math.abs(angle) % 180 === 90;
  const width = sideways(fromAngle) ? from.height : from.width,
    height = sideways(fromAngle) ? from.width : from.height;
  const targetWidth = sideways(toAngle) ? to.height : to.width,
    targetHeight = sideways(toAngle) ? to.width : to.height;
  const left = from.left + from.width / 2 - width / 2,
    top = from.top + from.height / 2 - height / 2;
  return {
    style: `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`,
    dx: to.left + to.width / 2 - from.left - from.width / 2,
    dy: to.top + to.height / 2 - from.top - from.height / 2,
    sx: targetWidth / width,
    sy: targetHeight / height,
    fromAngle,
    toAngle,
  };
}
class NativeFlights {
  constructor(host, api, timers = { setTimeout, clearTimeout }) {
    this.host = host;
    this.api = api;
    this.timers = timers;
    this.tracker = new DiscardMotionTracker();
    this.epoch = 0;
    this.serial = 0;
  }
  cancel(reset = false) {
    this.epoch++;
    this.serial++;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.plan = null;
    this.sources = null;
    if (reset) this.tracker.reset();
    if (this.host.data.flight || this.host.data.motionTarget)
      this.host.setData({
        flight: null,
        flightAnimation: {},
        motionTarget: "",
      });
  }
  prepare(before, after, live, request) {
    if (!after) {
      this.cancel(true);
      return null;
    }
    if (!live || !this.host.active) {
      this.cancel(true);
      this.tracker.observe(after, { canAnimate: false });
      return null;
    }
    const cached =
      this.sources && this.sources.context === context(before)
        ? this.sources
        : null;
    let intent = null,
      source = null;
    if (cached && request?.decisionId === before?.game?.decisionId) {
      const hand = this.host.data.hand.find(
        (t) => t.physicalKey === request.key && t.choiceId === request.choiceId,
      );
      const c = before.game.choices.find(
        (c) =>
          c.id === request.choiceId && ["discard", "riichi"].includes(c.type),
      );
      source = hand && cached.own[hand.physicalKey];
      if (source && request.shift)
        source = {
          ...source,
          left: source.left + request.shift.x,
          top: source.top + request.shift.y,
        };
      if (c && source)
        intent = {
          roomId: before.id,
          roomVersion: before.version,
          gameInstanceId: before.game.gameInstanceId,
          handId: before.game.handId,
          decisionId: before.game.decisionId,
          seat: before.mySeat,
          choiceId: c.id,
          tileValue: c.value,
          sourceTileId: hand.physicalKey,
          sourceRect: source,
          sourceGeometry: {
            width: source.width,
            height: source.height,
            angle: 0,
            scale: 1,
          },
          environmentEpoch: this.epoch,
        };
    }
    const discarded = this.tracker.observe(after, { canAnimate: true, intent });
    const nuki = acceptedNukiEvent(before, after);
    const call =
      acceptedPublicCallEvent(before, after) ||
      acceptedPendingKakanEvent(before, after);
    let plan = null;
    if (call && cached) {
      const set = require("./online").meld(call.meld);
      const index = set.findIndex((t) =>
        call.kind === "kakan" ? t.added : t.called,
      );
      const targetIndex = index < 0 ? set.findIndex((t) => !t.back) : index;
      const edge =
        this.host.data.seats.find((s) => s.seat === call.seat)?.edge ||
        "bottom";
      const source =
        call.source &&
        cached.rivers[`river-${call.source.seat}-${call.source.index}`];
      plan = {
        id: call.id,
        target: `meld-${call.seat}-${call.index}-${targetIndex}`,
        face: call.tile,
        from: source?.rect,
        fromAngle: source?.angle || 0,
        toAngle:
          angles[edge] +
          (set[targetIndex]?.called || set[targetIndex]?.added ? 90 : 0),
        pulse: !validRect(source?.rect),
      };
    } else if (discarded.flight && cached) {
      const f = discarded.flight,
        event = f.event;
      const seat = this.host.data.seats.find((s) => s.seat === event.seat),
        edge = seat?.edge || "bottom";
      const from = f.source === "own" ? source : cached.opponents[event.seat];
      if (validRect(from))
        plan = {
          id: event.id,
          target: `river-${event.seat}-${event.index}`,
          face: event.tile,
          from,
          fromAngle: f.source === "own" ? 0 : angles[edge],
          toAngle:
            angles[edge] +
            (river(
              after.game.players.find((p) => p.seat === event.seat).discards,
            ).find((t) => t.rawIndex === event.index)?.sideways
              ? 90
              : 0),
        };
    } else if (nuki && cached) {
      const north = this.host.data.hand.filter((t) => t.key === "z4");
      const from =
        nuki.seat === before.mySeat && north.length === 1
          ? cached.own[north[0].physicalKey]
          : null;
      plan = {
        id: nuki.id,
        target: `north-${nuki.seat}-${nuki.index}`,
        face: "z4",
        from,
        fromAngle: 0,
        toAngle:
          angles[
            this.host.data.seats.find((s) => s.seat === nuki.seat)?.edge ||
              "bottom"
          ],
        pulse: !validRect(from),
      };
    }
    if (
      context(before) !== context(after) ||
      discarded.reset ||
      discarded.cancelledEventIds.length
    )
      this.cancel();
    if (!plan || !this.api?.createSelectorQuery || !this.api?.createAnimation)
      return null;
    plan.context = context(after);
    plan.epoch = this.epoch;
    this.plan = plan;
    return plan;
  }
  current(plan) {
    return (
      this.host.active &&
      this.plan === plan &&
      plan.epoch === this.epoch &&
      plan.context === context(this.host.data.room)
    );
  }
  capture() {
    const host = this.host,
      room = host.data.room;
    if (
      !host.active ||
      !room?.game ||
      host.data.openingHolding ||
      !this.api?.createSelectorQuery
    )
      return;
    const serial = ++this.serial,
      key = context(room),
      epoch = this.epoch,
      hand = host.data.hand.slice(),
      seats = host.data.seats.filter((s) => !s.self);
    try {
      const q = this.api.createSelectorQuery().in(host);
      q.selectAll(".hand .tile").boundingClientRect();
      q.selectAll(".opponent .back").boundingClientRect();
      q.selectAll(".river-slot").boundingClientRect();
      q.exec((rects) => {
        if (
          serial !== this.serial ||
          epoch !== this.epoch ||
          key !== context(host.data.room) ||
          !host.active
        )
          return;
        if (
          !Array.isArray(rects?.[0]) ||
          !Array.isArray(rects?.[1]) ||
          rects[0].length !== hand.length
        )
          return;
        const own = {},
          opponents = {},
          rivers = {};
        hand.forEach((t, i) => {
          if (validRect(rects[0][i])) own[t.physicalKey] = rects[0][i];
        });
        let offset = 0;
        for (const seat of seats) {
          const end = offset + seat.hidden.length;
          if (validRect(rects[1][end - 1]))
            opponents[seat.seat] = rects[1][end - 1];
          offset = end;
        }
        if (offset !== rects[1].length) return;
        const cells = host.data.seats.flatMap((s) =>
          s.river.map((t) => ({
            ...t,
            angle: angles[s.edge] + (t.sideways ? 90 : 0),
          })),
        );
        if (!Array.isArray(rects[2]) || rects[2].length !== cells.length)
          return;
        cells.forEach((t, i) => {
          if (validRect(rects[2][i]))
            rivers[t.nodeId] = { rect: rects[2][i], angle: t.angle };
        });
        this.sources = { context: key, own, opponents, rivers };
      });
    } catch (_) {
      this.sources = null;
    }
  }
  schedule(plan) {
    if (!this.current(plan)) return;
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      if (this.current(plan)) {
        this.cancel();
        this.capture();
      }
    }, FLIGHT_MS + 60);
  }
  start(plan) {
    if (!plan || !this.current(plan)) return;
    try {
      const q = this.api.createSelectorQuery().in(this.host);
      q.select("#" + plan.target).boundingClientRect();
      q.exec((rects) => {
        try {
          if (!this.current(plan)) return;
          const to = rects?.[0];
          if (!validRect(to)) {
            this.cancel();
            return;
          }
          if (plan.pulse) {
            this.host.setData(
              {
                motionTarget: plan.target,
                flight: null,
                flightAnimation: {},
              },
              () => this.schedule(plan),
            );
          } else {
            const path = pathFor(plan.from, to, plan.fromAngle, plan.toAngle);
            if (!path) {
              this.cancel();
              return;
            }
            const a = this.api.createAnimation({
              duration: FLIGHT_MS,
              timingFunction: "ease-out",
              transformOrigin: "50% 50% 0",
            });
            a.translate(0, 0)
              .scale(1, 1)
              .rotate(path.fromAngle)
              .step({ duration: 0 });
            const flight = {
              id: plan.id,
              src: tile(plan.face).src,
              style: path.style,
            };
            this.host.setData(
              {
                flight,
                flightAnimation: a.export(),
                motionTarget: plan.target,
              },
              () => {
                if (!this.current(plan)) return;
                try {
                  a.translate(path.dx, path.dy)
                    .scale(path.sx, path.sy)
                    .rotate(path.toAngle)
                    .step({ duration: FLIGHT_MS });
                  this.host.setData({ flightAnimation: a.export() }, () =>
                    this.schedule(plan),
                  );
                } catch (_) {
                  this.cancel();
                }
              },
            );
          }
        } catch (_) {
          this.cancel();
        }
      });
    } catch (_) {
      this.cancel();
    }
  }
}
module.exports = { NativeFlights, pathFor, FLIGHT_MS };
