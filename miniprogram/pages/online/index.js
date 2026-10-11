const { dropOnTable, touchPoint } = require("../../utils/online-gesture");
const { api, error } = require("../../utils/api");
const { uuid, snapshot, feedback } = require("../../utils/online");
const { presentation } = require("../../utils/online-settlement");
const { presentationBoundaries } = require("../../utils/online-timing");
const {
  acceptedRoundOpening,
  openingKey,
  isUndealtRound,
  ROUND_OPENING,
} = require("../../utils/online-opening");
Page({
  data: {
    room: null,
    game: null,
    variant: "yonma",
    mode: "east",
    code: "",
    busy: false,
    serviceRunning: false,
    seats: [],
    hand: [],
    actions: [],
    selected: -1,
    draggingId: -1,
    dragStyle: "",
    dropTarget: false,
    announcement: null,
    riichiMode: false,
    canRiichi: false,
    openingHolding: false,
    doraVisible: true,
  },
  onShow() {
    this.active = true;
    this.liveReady = false;
    this.setData({ busy: false });
    this.refresh();
    this.timer = setInterval(() => {
      if (!this.data.busy) this.refresh();
    }, 2000);
  },
  onHide() {
    this.touchCancel();
    this.active = false;
    this.setData({ riichiMode: false });
    this.revision = (this.revision || 0) + 1;
    clearInterval(this.timer);
    clearTimeout(this.feedbackTimer);
    clearTimeout(this.resultTimer);
    this.cancelOpening();
    this.openingIntent = null;
    this.drag = null;
    this.setData({ announcement: null, selected: -1, riichiMode: false });
  },
  onResize() {
    this.touchCancel();
    this.cancelOpening();
  },
  onPageScroll() {
    this.touchCancel();
  },
  onUnload() {
    this.onHide();
  },
  async refresh() {
    const revision = (this.revision = (this.revision || 0) + 1);
    try {
      const r = await api("/api/online");
      if (this.active && revision === this.revision) {
        this.accept(r, this.liveReady);
        this.liveReady = true;
      }
    } catch (e) {
      if (this.active && revision === this.revision) error(e);
    }
  },
  accept(r, live = false) {
    const intent = r.room
      ? acceptedRoundOpening(this.data.room, r.room, live)
      : null;
    const run = this.openingRun;
    if (
      run &&
      (!r.room ||
        openingKey(r.room) !== run.key ||
        r.room.game?.decisionId !== run.decision ||
        !isUndealtRound(r.room))
    )
      this.cancelOpening();
    if (intent && !this.openingConsumed?.has(intent)) {
      this.cancelOpening();
      if (!this.openingConsumed || this.openingConsumed.size >= 128)
        this.openingConsumed = new Set();
      this.openingConsumed.add(intent);
      this.openingIntent = intent;
      this.openingRun = {
        key: intent,
        decision: r.room.game.decisionId,
        time: Date.now(),
        age: 0,
      };
    }
    const openingAge = this.openingRun
      ? Math.max(this.openingRun.age, Date.now() - this.openingRun.time)
      : null;
    const previous = this.data.game?.decisionId;
    const announcement = feedback(this.data.game, r.room?.game);
    const sameDecision =
      this.data.room?.id === r.room?.id &&
      previous === r.room?.game?.decisionId;
    const next = snapshot(
      r,
      sameDecision && this.data.riichiMode,
      openingAge,
      this.openingIntent === (r.room && openingKey(r.room)),
    );
    const flow = next.game?.settlementFlow;
    const key =
      next.game && flow && !next.game.ranking
        ? `${flow.id}:${flow.stage}:${flow.detailIndex}`
        : "";
    const time = Date.now(),
      previousAnchor = this.resultAnchor;
    const age =
      previousAnchor?.key === key
        ? Math.max(
            flow?.elapsedMs || 0,
            previousAnchor.age + Math.max(0, time - previousAnchor.time),
            previousAnchor.lastAge || 0,
          )
        : flow?.elapsedMs || 0;
    this.resultAnchor = key ? { key, time, age } : null;
    if (previousAnchor?.key !== key) this.autoPhase = "";
    const result = presentation(next.game, next.seats, age);
    this.setData({
      ...next,
      settlement: result,
      settlementAck: result
        ? next.actions.find((c) => c.type === "ack") || null
        : null,
      actions: result
        ? next.actions.filter((c) => c.type !== "ack")
        : next.actions,
    });
    this.tickResult();
    this.tickOpening();
    if (!r.room?.game) {
      clearTimeout(this.feedbackTimer);
      this.setData({ announcement: null });
    } else if (announcement) {
      clearTimeout(this.feedbackTimer);
      this.setData({
        announcement: {
          ...announcement,
          name:
            this.data.seats.find((p) => p.seat === announcement.seat)?.name ||
            "",
        },
      });
      this.feedbackTimer = setTimeout(() => {
        if (this.active) this.setData({ announcement: null });
      }, 1500);
    }
    if (!sameDecision) {
      this.touchCancel();
      this.setData({ selected: -1 });
    }
  },
  cancelOpening() {
    clearTimeout(this.openingTimer);
    this.openingRun = null;
    if (this.data.room) {
      const next = snapshot(
        { room: this.data.room },
        this.data.riichiMode,
        null,
        this.openingIntent === openingKey(this.data.room),
      );
      this.setData({
        hand: next.hand,
        seats: next.seats,
        openingHolding: false,
        doraVisible: true,
      });
    }
  },
  tickOpening() {
    clearTimeout(this.openingTimer);
    const run = this.openingRun;
    if (!this.active || !run || !this.data.room) return;
    const age = Math.max(run.age, Date.now() - run.time);
    run.age = age;
    const done = age >= ROUND_OPENING.operationsMs;
    const next = snapshot(
      { room: this.data.room },
      false,
      done ? null : age,
      true,
    );
    this.setData({
      hand: next.hand,
      seats: next.seats,
      openingHolding: next.openingHolding,
      doraVisible: next.doraVisible,
    });
    if (done) {
      this.openingRun = null;
      return;
    }
    const deadline = [
      ...ROUND_OPENING.waves.slice(1),
      ROUND_OPENING.doraAndSortMs,
      ROUND_OPENING.operationsMs,
    ].find((v) => v > age);
    this.openingTimer = setTimeout(
      () => {
        if (this.openingRun === run) this.tickOpening();
      },
      Math.max(1, deadline - age),
    );
  },
  tickResult() {
    clearTimeout(this.resultTimer);
    const anchor = this.resultAnchor,
      game = this.data.game;
    if (!this.active || !anchor || !game?.settlement || game.ranking) return;
    const age = Math.max(
      anchor.lastAge || 0,
      anchor.age + Math.max(0, Date.now() - anchor.time),
    );
    anchor.lastAge = age;
    const result = presentation(game, this.data.seats, age);
    this.setData({ settlement: result });
    const key = anchor.key;
    const due =
      age >= result.autoAt && this.data.settlementAck && this.autoPhase !== key;
    if (due && !this.data.busy) {
      this.autoPhase = key;
      this.continueSettlement();
      return;
    }
    const boundaries = [
      result.intro,
      ...presentationBoundaries(game.settlementFlow, game.settlement).map(
        (v) => v + result.intro,
      ),
    ];
    const next = boundaries.find((v) => v > age);
    if (next !== undefined || due)
      this.resultTimer = setTimeout(
        () => {
          if (this.resultAnchor?.key === key) this.tickResult();
        },
        next === undefined ? 250 : Math.max(1, next - age),
      );
  },
  choose(e) {
    if (!this.data.busy)
      this.setData({
        [e.currentTarget.dataset.key]: e.currentTarget.dataset.value,
      });
  },
  code(e) {
    this.setData({ code: e.detail.value.trim().toUpperCase() });
  },
  async send(command) {
    if (this.data.busy) return;
    const body = { ...command };
    if (body.action !== "create" && body.action !== "join")
      body.roomId = this.data.room?.id;
    const key = JSON.stringify(body);
    if (!this.pending || this.pending.key !== key)
      this.pending = { key, body: { ...body, nonce: uuid() } };
    const revision = (this.revision = (this.revision || 0) + 1);
    this.touchCancel();
    this.setData({ busy: true });
    try {
      const r = await api("/api/online", "POST", this.pending.body);
      this.pending = null;
      if (this.active && revision === this.revision) this.accept(r, true);
    } catch (e) {
      if (e.status >= 400 && e.status < 500) this.pending = null;
      if (this.active) error(e);
    } finally {
      if (this.active && revision === this.revision)
        this.setData({ busy: false });
    }
  },
  create() {
    return this.send({
      action: "create",
      variant: this.data.variant,
      mode: this.data.mode,
    });
  },
  join() {
    return this.send({ action: "join", code: this.data.code });
  },
  ready() {
    return this.send({ action: "ready", ready: !this.data.ready });
  },
  fill() {
    return this.send({ action: "fill-bots" });
  },
  start() {
    return this.send({ action: "start" });
  },
  leave() {
    return this.send({ action: "leave" });
  },
  finish() {
    wx.showModal({
      title: "解散牌桌",
      content: "结束当前牌局？",
      success: (r) => {
        if (r.confirm) this.send({ action: "finish" });
      },
    });
  },
  rematch() {
    return this.send({ action: "rematch" });
  },
  respond(e) {
    const choices = this.data.settlementAck
      ? [...this.data.actions, this.data.settlementAck]
      : this.data.actions;
    const choice = choices.find((c) => c.id === e.currentTarget.dataset.id);
    if (choice && !this.data.openingHolding)
      return this.send({
        action: "respond",
        decisionId: this.data.game.decisionId,
        choiceId: choice.id,
      });
  },
  continueSettlement() {
    const c = this.data.settlementAck;
    if (c && this.active && this.data.settlement?.ready && !this.data.busy) {
      this.autoPhase = this.resultAnchor?.key || "";
      return this.respond({ currentTarget: { dataset: { id: c.id } } });
    }
  },
  toggleRiichi() {
    if (
      !this.active ||
      this.data.busy ||
      this.data.openingHolding ||
      !this.data.canRiichi
    )
      return;
    this.touchCancel();
    const next = snapshot(
      { room: this.data.room, serviceRunning: this.data.serviceRunning },
      !this.data.riichiMode,
    );
    this.setData({
      hand: next.hand,
      riichiMode: next.riichiMode,
      selected: -1,
    });
  },
  discard(e) {
    if (!this.active || Date.now() < (this.ignoreTapUntil || 0)) return;
    this.touchCancel();
    const t = this.data.hand[Number(e.currentTarget.dataset.index)];
    if (!t?.choiceId || this.data.busy || this.data.openingHolding) return;
    if (this.data.selected === t.id)
      return this.send({
        action: "respond",
        decisionId: t.decisionId,
        choiceId: t.choiceId,
      });
    this.setData({ selected: t.id });
  },
  touchStart(e) {
    this.touchCancel();
    this.ignoreTapUntil = 0;
    const t = this.data.hand[Number(e.currentTarget.dataset.index)];
    const point = e.touches?.length === 1 && touchPoint(e.touches[0]);
    if (
      this.active &&
      t?.choiceId &&
      !this.data.busy &&
      !this.data.openingHolding &&
      point
    ) {
      this.drag = {
        tile: { ...t },
        start: point,
        finger: e.touches[0].identifier,
        roomId: this.data.room?.id,
        epoch: this.gestureEpoch,
        raised: this.data.selected === t.id,
      };
    }
  },
  touchMove(e) {
    const d = this.drag;
    const finger = e.touches?.length === 1 && e.touches[0];
    const point = finger && touchPoint(finger);
    if (
      !d ||
      !point ||
      finger.identifier !== d.finger ||
      !this.currentDrag(d)
    ) {
      this.touchCancel();
      return;
    }
    if (Math.hypot(point.x - d.start.x, point.y - d.start.y) >= 12) {
      d.moved = true;
      this.ignoreTapUntil = Date.now() + 250;
    }
    d.point = point;
    if (!d.moved) return;
    this.renderDrag(d);
    if (!d.geometryRequested) {
      d.geometryRequested = true;
      this.dropGeometry().then((geometry) => {
        if (this.drag !== d || !this.currentDrag(d)) return;
        d.geometry = geometry;
        this.renderDrag(d);
      });
    }
  },
  renderDrag(d) {
    const dx = Math.round(d.point.x - d.start.x);
    const dy = Math.round(d.point.y - d.start.y) - (d.raised ? 12 : 0);
    const dragStyle = `transform:translate(${dx}px,${dy}px);`;
    const dropTarget =
      d.start.y - d.point.y >= 40 && dropOnTable(d.point, d.geometry);
    if (
      this.data.dragStyle !== dragStyle ||
      this.data.dropTarget !== dropTarget ||
      this.data.draggingId !== d.tile.id
    )
      this.setData({ draggingId: d.tile.id, dragStyle, dropTarget });
  },
  clearDragPreview() {
    if (
      this.data.draggingId !== -1 ||
      this.data.dragStyle ||
      this.data.dropTarget
    )
      this.setData({ draggingId: -1, dragStyle: "", dropTarget: false });
  },
  async touchEnd(e) {
    const d = this.drag;
    this.drag = null;
    this.clearDragPreview();
    const finger = e.changedTouches?.length === 1 && e.changedTouches[0];
    const point = finger && touchPoint(finger);
    if (
      d &&
      (d.moved ||
        (point && Math.hypot(point.x - d.start.x, point.y - d.start.y) >= 12))
    )
      this.ignoreTapUntil = Date.now() + 250;
    if (
      !d ||
      !point ||
      e.touches?.length ||
      finger.identifier !== d.finger ||
      d.start.y - point.y < 40 ||
      !this.currentDrag(d)
    )
      return;
    // Query the current viewport geometry at release; never reuse pre-scroll bounds.
    const geometry = await this.dropGeometry();
    if (!this.currentDrag(d) || !dropOnTable(point, geometry)) return;
    this.setData({ selected: -1 });
    return this.send({
      action: "respond",
      decisionId: d.tile.decisionId,
      choiceId: d.tile.choiceId,
    });
  },
  currentDrag(d) {
    return (
      this.active &&
      !this.data.busy &&
      !this.data.openingHolding &&
      d.epoch === this.gestureEpoch &&
      d.roomId === this.data.room?.id &&
      d.tile.decisionId === this.data.game?.decisionId &&
      this.data.hand.some(
        (t) =>
          t.id === d.tile.id &&
          t.physicalKey === d.tile.physicalKey &&
          t.choiceId === d.tile.choiceId &&
          t.decisionId === d.tile.decisionId,
      )
    );
  },
  dropGeometry() {
    return new Promise((resolve) => {
      try {
        const q = wx.createSelectorQuery().in(this);
        q.select(".table").boundingClientRect();
        q.selectAll(".drag-exclusion").boundingClientRect();
        q.exec((rects) =>
          resolve(rects ? { table: rects[0], excluded: rects[1] } : null),
        );
      } catch (_) {
        resolve(null);
      }
    });
  },
  touchCancel() {
    this.gestureEpoch = (this.gestureEpoch || 0) + 1;
    this.drag = null;
    this.clearDragPreview();
  },
  onShareAppMessage() {
    return {
      title: "来一场日本麻将",
      path: "/pages/online/index?code=" + (this.data.room?.code || ""),
    };
  },
  onLoad(o) {
    if (o.code) this.setData({ code: o.code });
  },
});
