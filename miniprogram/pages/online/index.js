const { api, error } = require("../../utils/api");
const { uuid, snapshot, feedback } = require("../../utils/online");
const { presentation } = require("../../utils/online-settlement");
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
    this.drag = null;
    this.setData({ announcement: null });
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
    const next = snapshot(r);
    const result = presentation(next.game, next.seats);
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
    if (previous !== this.data.game?.decisionId) this.setData({ selected: -1 });
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
    if (c) return this.respond({ currentTarget: { dataset: { id: c.id } } });
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
