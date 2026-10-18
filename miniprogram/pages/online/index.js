const { automaticChoice, automaticOff, automaticChoiceDelay } = require('../../utils/online-automatic');
const { NativeSettlementAudio } = require('../../utils/online-settlement-audio');
const { NativeFlights } = require("../../utils/online-flight");
const { dropOnTable, touchPoint } = require("../../utils/online-gesture");
const { horizontalInsets } = require("../../utils/online-safe-area");
const { api, error } = require("../../utils/api");
const { uuid, snapshot, feedback, callArt } = require("../../utils/online");
const { presentation } = require("../../utils/online-settlement");
const { presentationBoundaries } = require("../../utils/online-timing");
const { rankingBoundaries, rankingReadyAt } = require("../../utils/online-ranking-timing");
const { rankingPresentation } = require("../../utils/online-ranking");
const {
  acceptedRoundOpening,
  openingKey,
  isUndealtRound,
  ROUND_OPENING,
} = require("../../utils/online-opening");
const automaticDecisionKey = room => JSON.stringify([room?.id, room?.mySeat, room?.game?.gameInstanceId, room?.game?.handId, room?.game?.decisionId]);
Page({
  data: {
    soundEnabled: true,
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
    flight: null,
    flightAnimation: {},
    motionTarget: "",
    announcement: null,
    riichiMode: false,
    canRiichi: false,
    openingHolding: false,
    doraVisible: true,
    ownMeldCount: 0,
    ranking: null,
    safeInsets: { left: 0, right: 0 },
  },
  onShow() {
    this.active = true;
    this.liveReady = false;
    this.setData({ busy: false });
    this.tickRanking();
    this.updateSafeArea();
    this.refresh();
    this.timer = setInterval(() => {
      if (!this.data.busy) this.refresh();
    }, 2000);
  },
  onHide() {
    this.flights?.cancel(true);
    this.touchCancel();
    this.active = false;
    this.cancelAutomatic();
    this.clearAutomaticRetry();
    this.resultAudio?.invalidate();
    if (this.resultAnchor) this.resultAnchor.baselineAge = Infinity;
    this.setData({ riichiMode: false });
    this.revision = (this.revision || 0) + 1;
    clearInterval(this.timer);
    clearTimeout(this.feedbackTimer);
    clearTimeout(this.resultTimer);
    clearTimeout(this.rankingTimer);
    this.cancelOpening();
    this.openingIntent = null;
    this.drag = null;
    this.setData({ announcement: null, selected: -1, riichiMode: false });
  },
  onResize(event) {
    this.resultAudio?.invalidate();
    this.updateSafeArea(event?.size);
    this.flights?.cancel();
    this.touchCancel();
    this.cancelOpening();
  },
  updateSafeArea(size) {
    if (typeof wx === "undefined") return;
    const info = typeof wx.getWindowInfo === "function"
      ? wx.getWindowInfo()
      : typeof wx.getSystemInfoSync === "function" ? wx.getSystemInfoSync() : null;
    if (!info) return;
    const revision = this.safeRevision = (this.safeRevision || 0) + 1;
    const apply = (width) => {
      if (this.active && revision === this.safeRevision)
        this.setData({ safeInsets: horizontalInsets(info, width) });
    };
    if (Number.isFinite(size?.windowWidth)) apply(size.windowWidth);
    else if (typeof wx.createSelectorQuery === "function")
      wx.createSelectorQuery().in(this).select(".online")
        .boundingClientRect((rect) => apply(rect?.width)).exec();
  },
  onPageScroll() {
    this.flights?.cancel();
    this.touchCancel();
  },
  onUnload() {
    this.onHide();
    this.resultAudio?.dispose();
  },
  async refresh() {
    const revision = (this.revision = (this.revision || 0) + 1);
    try {
      const r = await api("/api/online");
      if (this.active && revision === this.revision) {
        this.confirmAutomaticRetry(r.room);
        this.accept(r, this.liveReady);
        this.liveReady = true;
      }
    } catch (e) {
      if (this.active && revision === this.revision) { this.cancelAutomatic(); this.resultAudio?.invalidate(); this.liveReady = false; error(e); }
    }
  },
  nativeFlights() {
    if (!this.flights)
      this.flights = new NativeFlights(
        this,
        typeof wx === "undefined" ? null : wx,
      );
    return this.flights;
  },
  accept(r, live = false) {
    this.nativeAudio()?.update(r.room, true, this.active, live);
    const flights = this.nativeFlights();
    const flightPlan = flights.prepare(
      this.data.room,
      r.room,
      live,
      this.motionRequest,
    );
    this.motionRequest = null;
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
    const announcement =
      r.room?.game?.settlementFlow && r.room.game.settlement
        ? null
        : feedback(this.data.game, r.room?.game);
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
    const baselineAge =
      previousAnchor?.key === key
        ? (previousAnchor.baselineAge ?? previousAnchor.age)
        : age;
    this.resultAnchor = key ? { key, time, age, baselineAge } : null;
    if (previousAnchor?.key !== key) this.autoPhase = "";
    const result = presentation(next.game, next.seats, age, baselineAge);
    this.setData(
      {
        ...next,
        settlement: result,
        settlementAck: result
          ? next.actions.find((c) => c.type === "ack") || null
          : null,
        actions: result
          ? next.actions.filter((c) => c.type !== "ack")
          : next.actions,
      },
      () => {
        flights.start(flightPlan);
        flights.capture();
      },
    );
    this.tickResult();
    this.acceptRanking();
    this.tickOpening();
    if (
      !r.room?.game ||
      (r.room.game.settlementFlow && r.room.game.settlement)
    ) {
      clearTimeout(this.feedbackTimer);
      this.setData({ announcement: null });
    } else if (announcement) {
      clearTimeout(this.feedbackTimer);
      this.setData({
        announcement: {
          ...announcement,
          art: callArt(announcement.text),
          name:
            this.data.seats.find((p) => p.seat === announcement.seat)?.name ||
            "",
        },
      });
      this.feedbackTimer = setTimeout(() => {
        if (this.active) this.setData({ announcement: null });
      }, 1500);
    }
    this.scheduleAutomatic();
    if (!sameDecision) {
      this.touchCancel();
      this.setData({ selected: -1 });
    }
  },
  nativeAudio() {
    if (!this.resultAudio && typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function')
      this.resultAudio = new NativeSettlementAudio({
        sources: { yaku: '/assets/audio/yaku.wav', 'hand-value': '/assets/audio/hand-value.wav', 'score-roll': '/assets/audio/score-roll.wav' },
        createInnerAudioContext: () => wx.createInnerAudioContext(),
      });
    return this.resultAudio;
  },
  activateSound() { this.nativeAudio()?.activateFromGesture(); },
  toggleSound() {
    const enabled = !this.data.soundEnabled;
    this.setData({ soundEnabled: enabled });
    this.nativeAudio()?.setEnabled(enabled);
    this.activateSound();
  },
  cancelAutomatic() {
    clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.autoGeneration = (this.autoGeneration || 0) + 1;
  },
  clearAutomaticRetry() {
    const retry = this.autoRetry;
    if (!retry) return;
    this.autoConsumed = retry.key;
    if (this.pending === retry.pending) this.pending = null;
    this.autoRetry = null;
  },
  confirmAutomaticRetry(room) {
    const retry = this.autoRetry;
    if (!retry) return;
    const choice = room?.status === 'playing' && room.game ? automaticChoice(room.game, automaticOff) : null;
    if (automaticDecisionKey(room) !== retry.key || choice?.id !== retry.choiceId || this.pending !== retry.pending) {
      this.clearAutomaticRetry();
      return;
    }
    // A failed POST is ambiguous. Only a fresh successful GET may release one
    // retry, with the same nonce, and at most two retries for this decision.
    if (retry.waiting && retry.attempts < 3) {
      retry.waiting = false;
      this.autoConsumed = null;
    }
  },
  scheduleAutomatic() {
    this.cancelAutomatic();
    const room = this.data.room, game = room?.game;
    const key = automaticDecisionKey(room);
    if (this.autoRetry && this.autoRetry.key !== key) this.clearAutomaticRetry();
    if (!this.active || this.data.busy || this.data.openingHolding || room?.status !== 'playing' || !game) return;
    if (this.autoConsumed === key) return;
    const choice = automaticChoice(game, automaticOff);
    if (!choice) return;
    const generation = this.autoGeneration;
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      const current = this.data.room, next = current?.game;
      if (generation !== this.autoGeneration || !this.active || this.data.busy || this.data.openingHolding || current?.status !== 'playing' || !next || this.autoConsumed === key) return;
      if (automaticDecisionKey(current) !== key || automaticChoice(next, automaticOff)?.id !== choice.id) return;
      this.autoConsumed = key;
      const retry = this.autoRetry || (this.autoRetry = { key, choiceId: choice.id, attempts: 0 });
      retry.attempts++;
      this.send({ action: 'respond', decisionId: next.decisionId, choiceId: choice.id }, retry);
    }, automaticChoiceDelay(choice));
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
    this.setData(
      {
        hand: next.hand,
        seats: next.seats,
        openingHolding: next.openingHolding,
        doraVisible: next.doraVisible,
      },
      () => {
        if (done) this.flights?.capture();
      },
    );
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
    const result = presentation(
      game,
      this.data.seats,
      age,
      anchor.baselineAge ?? anchor.age,
    );
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
  acceptRanking() {
    const game = this.data.game;
    if (!game?.ranking) {
      clearTimeout(this.rankingTimer);
      this.rankingAnchor = null;
      this.setData({ ranking: null });
      return;
    }
    const key = `${this.data.room.id}:${game.rankingFlow?.id || game.gameInstanceId || "legacy"}`;
    const time = Date.now(), previous = this.rankingAnchor;
    const serverAge = game.rankingFlow?.elapsedMs ?? rankingReadyAt(game.ranking.length);
    const age = previous?.key === key
      ? Math.max(serverAge, previous.lastAge || 0, previous.age + Math.max(0, time - previous.time))
      : serverAge;
    this.rankingAnchor = { key, time, age };
    this.tickRanking();
  },
  tickRanking() {
    clearTimeout(this.rankingTimer);
    const anchor = this.rankingAnchor, game = this.data.game;
    if (!this.active || !anchor || !game?.ranking) return;
    const age = Math.max(anchor.lastAge || 0, anchor.age + Math.max(0, Date.now() - anchor.time));
    anchor.lastAge = age;
    this.setData({ ranking: rankingPresentation(game, this.data.seats, this.data.room.mySeat, age) });
    const next = rankingBoundaries(game.ranking.length).find((boundary) => boundary > age);
    if (next !== undefined)
      this.rankingTimer = setTimeout(() => {
        if (this.rankingAnchor?.key === anchor.key) this.tickRanking();
      }, Math.max(1, next - age));
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
  async send(command, automatic = null) {
    this.cancelAutomatic();
    if (this.data.busy) return;
    if (!automatic && this.autoRetry) {
      this.autoConsumed = this.autoRetry.key;
      this.autoRetry = null;
    }
    const body = { ...command };
    if (body.action !== "create" && body.action !== "join")
      body.roomId = this.data.room?.id;
    const key = JSON.stringify(body);
    if (!this.pending || this.pending.key !== key)
      this.pending = { key, body: { ...body, nonce: uuid() } };
    const request = this.pending;
    if (automatic) automatic.pending = request;
    const revision = (this.revision = (this.revision || 0) + 1);
    this.motionRequest =
      command.action === "respond" && this.chosenMotion
        ? {
            ...this.chosenMotion,
            decisionId: command.decisionId,
            choiceId: command.choiceId,
          }
        : null;
    this.chosenMotion = null;
    this.touchCancel();
    this.setData({ busy: true });
    try {
      const r = await api("/api/online", "POST", request.body);
      if (this.pending === request) this.pending = null;
      if (this.autoRetry === automatic) this.autoRetry = null;
      if (this.active && revision === this.revision) this.accept(r, true);
    } catch (e) {
      if (e.status >= 400 && e.status < 500) {
        if (this.pending === request) this.pending = null;
        if (this.autoRetry === automatic) this.autoRetry = null;
      } else if (automatic && this.autoRetry === automatic && this.pending === request) automatic.waiting = true;
      if (this.active) error(e);
    } finally {
      if (this.active && revision === this.revision)
        { this.setData({ busy: false }); this.scheduleAutomatic(); }
    }
  },
  create() {
    this.activateSound();
    return this.send({
      action: "create",
      variant: this.data.variant,
      mode: this.data.mode,
    });
  },
  join() {
    this.activateSound();
    return this.send({ action: "join", code: this.data.code });
  },
  ready() {
    this.activateSound();
    return this.send({ action: "ready", ready: !this.data.ready });
  },
  fill() {
    this.activateSound();
    return this.send({ action: "fill-bots" });
  },
  start() {
    this.activateSound();
    return this.send({ action: "start" });
  },
  leave() {
    if (this.data.game?.ranking && !this.data.ranking?.ready) return;
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
    if (this.data.game?.ranking && !this.data.ranking?.ready) return;
    return this.send({ action: "rematch" });
  },
  respond(e) {
    if (e?.type) this.activateSound();
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
    this.setData(
      {
        hand: next.hand,
        riichiMode: next.riichiMode,
        selected: -1,
      },
      () => this.flights?.capture(),
    );
  },
  discard(e) {
    if (e?.type) this.activateSound();
    if (!this.active || Date.now() < (this.ignoreTapUntil || 0)) return;
    this.touchCancel();
    const t = this.data.hand[Number(e.currentTarget.dataset.index)];
    if (!t?.choiceId || this.data.busy || this.data.openingHolding) return;
    if (this.data.selected === t.id) {
      this.chosenMotion = { key: t.physicalKey };
      return this.send({
        action: "respond",
        decisionId: t.decisionId,
        choiceId: t.choiceId,
      });
    }
    this.setData({ selected: t.id }, () => this.flights?.capture());
  },
  touchStart(e) {
    if (e?.type) this.activateSound();
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
    this.chosenMotion = {
      key: d.tile.physicalKey,
      shift: { x: point.x - d.start.x, y: point.y - d.start.y },
    };
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
