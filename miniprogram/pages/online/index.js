const { api, error } = require("../../utils/api");
const { uuid, snapshot, feedback } = require("../../utils/online");
const { presentation } = require("../../utils/online-settlement");
const { presentationBoundaries } = require("../../utils/online-timing");
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
    announcement: null,
    riichiMode: false,
    canRiichi: false,
  },
  onShow() {
    this.active = true;
    this.setData({ busy: false });
    this.refresh();
    this.timer = setInterval(() => {
      if (!this.data.busy) this.refresh();
    }, 2000);
  },
  onHide() {
    this.active = false;
    this.revision = (this.revision || 0) + 1;
    clearInterval(this.timer);
    clearTimeout(this.feedbackTimer);
    clearTimeout(this.resultTimer);
    this.drag = null;
    this.setData({ announcement: null, selected: -1, riichiMode: false });
  },
  onUnload() {
    this.onHide();
  },
  async refresh() {
    const revision = (this.revision = (this.revision || 0) + 1);
    try {
      const r = await api("/api/online");
      if (this.active && revision === this.revision) this.accept(r);
    } catch (e) {
      if (this.active && revision === this.revision) error(e);
    }
  },
  accept(r) {
    const previous = this.data.game?.decisionId;
    const announcement = feedback(this.data.game, r.room?.game);
    const sameDecision =
      this.data.room?.id === r.room?.id &&
      previous === r.room?.game?.decisionId;
    const next = snapshot(r, sameDecision && this.data.riichiMode);
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
    if (previous !== this.data.game?.decisionId) {
      this.drag = null;
      this.setData({ selected: -1 });
    }
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
    this.setData({ busy: true });
    try {
      const r = await api("/api/online", "POST", this.pending.body);
      this.pending = null;
      if (this.active && revision === this.revision) this.accept(r);
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
    if (choice)
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
    if (!this.active || this.data.busy || !this.data.canRiichi) return;
    this.drag = null;
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
    const t = this.data.hand[Number(e.currentTarget.dataset.index)];
    if (!t?.choiceId || this.data.busy) return;
    if (this.data.selected === t.id)
      return this.send({
        action: "respond",
        decisionId: t.decisionId,
        choiceId: t.choiceId,
      });
    this.setData({ selected: t.id });
  },
  touchStart(e) {
    const t = this.data.hand[Number(e.currentTarget.dataset.index)];
    this.drag =
      t?.choiceId && !this.data.busy && e.touches?.length === 1
        ? { tile: t, y: e.touches[0].clientY }
        : null;
  },
  touchEnd(e) {
    const d = this.drag;
    this.drag = null;
    if (
      d &&
      !this.data.busy &&
      e.changedTouches?.length === 1 &&
      e.changedTouches[0].clientY < d.y - 40 &&
      d.tile.decisionId === this.data.game?.decisionId
    ) {
      this.setData({ selected: -1 });
      return this.send({
        action: "respond",
        decisionId: d.tile.decisionId,
        choiceId: d.tile.choiceId,
      });
    }
  },
  touchCancel() {
    this.drag = null;
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
