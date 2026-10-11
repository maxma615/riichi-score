const { api, nonce, error } = require("../../utils/api");
const { roundStatus, settlementView } = require("../../utils/settlement-view");
const { FU, points } = require("../../utils/scoring");
Page({
  data: {
    room: null,
    kind: "win",
    method: "tsumo",
    fu: FU,
    yakumans: [
      "普通符番",
      "役满",
      "2倍役满",
      "3倍役满",
      "4倍役满",
      "5倍役满",
      "6倍役满",
    ],
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
        status: roundStatus(room),
        names: room.members.map((m) => m?.name || "空位"),
        winForms: room.members.map((_, seat) => ({
          seat,
          han: 3,
          fuIndex: 2,
          yakuman: 0,
        })),
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
  selectWinner(e) {
    const seat = Number(e.currentTarget.dataset.seat),
      d = this.data;
    if (d.method === "ron" && seat === d.loser) return;
    let winners;
    if (d.method === "tsumo") winners = [seat];
    else if (d.winners.includes(seat))
      winners = d.winners.filter((s) => s !== seat);
    else if (d.winners.length < 2) winners = [...d.winners, seat];
    else return;
    this.setData({ winners });
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
  stepHan(e) {
    const { seat, step } = e.currentTarget.dataset;
    const han = Math.max(
      1,
      Math.min(100, this.data.winForms[seat].han + Number(step)),
    );
    this.setData({ ["winForms[" + seat + "].han"]: han });
    this.nonce = null;
    this.refresh();
  },
  chooseFu(e) {
    const { seat, index } = e.currentTarget.dataset;
    if (!this.data.fuChoices[seat][index].valid) return;
    this.setData({ ["winForms[" + seat + "].fuIndex"]: Number(index) });
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
    const method = this.data.method;
    let winners = this.data.winners;
    if (method === "tsumo" && winners.length > 1) winners = winners.slice(0, 1);
    if (method === "ron")
      winners = winners.filter((s) => s !== Number(this.data.loser));
    this.setData({ winners });
    const fuChoices = this.data.winForms.map((form, seat) => {
      const valid = (fu) => {
        try {
          points({ han: form.han, fu, method });
          return true;
        } catch {
          return false;
        }
      };
      if (!valid(FU[form.fuIndex]))
        this.setData({ ["winForms[" + seat + "].fuIndex"]: 2 });
      return FU.map((fu, index) => ({ fu, index, valid: valid(fu) }));
    });
    this.setData({
      fuChoices,
      winnerFlags:
        this.data.names?.map((_, i) => this.data.winners.includes(i)) || [],
    });
    try {
      const details = settlementView(this.data.room, this.event());
      this.setData({
        preview: details.rows,
        details,
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
