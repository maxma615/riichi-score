const { api, nonce, error } = require("../../utils/api");
const { FU, settle } = require("../../utils/scoring");
Page({
  data: {
    room: null,
    kind: "win",
    method: "tsumo",
    fu: FU,
    han: 3,
    fuIndex: 2,
    winners: [0],
    winForms: [],
    winnerFlags: [],
    loser: 1,
    riichi: [],
    tenpai: [],
    yakuman: 0,
    saving: false,
    preview: null,
  },
  onLoad(o) {
    this.id = o.id;
    this.load();
  },
  async load() {
    try {
      const room = await api("/api/rooms/" + this.id);
      if (!room.isOwner) throw Error("由桌主记分");
      this.setData({
        room,
        names: room.members.map((m) => m?.name || "空位"),
        winForms: room.members.map(() => ({ han: 3, fuIndex: 2, yakuman: 0 })),
      });
      this.refresh();
    } catch (e) {
      error(e);
    }
  },
  choose(e) {
    this.setData({
      [e.currentTarget.dataset.key]: e.currentTarget.dataset.value,
    });
    this.nonce = null;
    this.refresh();
  },
  picker(e) {
    const { key, seat } = e.currentTarget.dataset;
    this.setData({
      [seat === undefined ? key : "winForms[" + seat + "]." + key]: Number(
        e.detail.value,
      ),
    });
    this.nonce = null;
    this.refresh();
  },
  check(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value.map(Number) });
    this.nonce = null;
    this.refresh();
  },
  event() {
    const d = this.data;
    return {
      kind: d.kind,
      method: d.method,
      loser: d.loser,
      riichi: d.riichi,
      tenpai: d.tenpai,
      winners: d.winners.map((seat) => ({
        seat,
        han: d.winForms[seat].han,
        fu: d.fu[d.winForms[seat].fuIndex],
        yakuman: d.winForms[seat].yakuman,
      })),
    };
  },
  refresh() {
    this.setData({
      winnerFlags:
        this.data.names?.map((_, i) => this.data.winners.includes(i)) || [],
    });
    try {
      const r = settle(this.data.room, this.event());
      this.setData({
        preview: r.delta.map((value, i) => ({
          name: this.data.names[i],
          value,
          positive: value >= 0,
        })),
        error: "",
      });
    } catch (e) {
      this.setData({ preview: null, error: e.message });
    }
  },
  async save() {
    if (this.data.saving || !this.data.preview) return;
    this.nonce = this.nonce || nonce();
    this.setData({ saving: true });
    try {
      await api("/api/rooms/" + this.id + "/events", "POST", {
        action: "record",
        version: this.data.room.version,
        nonce: this.nonce,
        event: this.event(),
      });
      wx.navigateBack();
    } catch (e) {
      error(e);
      if (e.status === 409) {
        this.nonce = null;
        await this.load();
      }
    } finally {
      this.setData({ saving: false });
    }
  },
});
