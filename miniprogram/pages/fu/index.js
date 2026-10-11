const { calculateFu } = require("../../utils/fu");
Page({
  data: {
    form: {
      closed: true,
      method: "ron",
      special: "normal",
      pair: 0,
      wait: 0,
      melds: [],
    },
    types: ["明刻", "暗刻", "明杠", "暗杠"],
    keys: ["openTriplet", "closedTriplet", "openKan", "closedKan"],
  },
  onLoad() {
    this.refresh();
  },
  choose(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ ["form." + key]: value });
    this.refresh();
  },
  add() {
    if (this.data.form.melds.length >= 4) return;
    this.setData({
      "form.closed": false,
      "form.melds": [
        ...this.data.form.melds,
        {
          id: Date.now() + Math.random(),
          type: "openTriplet",
          terminal: false,
          index: 0,
        },
      ],
    });
    this.refresh();
  },
  remove(e) {
    this.setData({
      "form.melds": this.data.form.melds.filter(
        (_, i) => i !== e.currentTarget.dataset.index,
      ),
    });
    this.refresh();
  },
  type(e) {
    const i = e.currentTarget.dataset.index,
      n = Number(e.detail.value);
    this.setData({
      ["form.melds[" + i + "].type"]: this.data.keys[n],
      ["form.melds[" + i + "].index"]: n,
    });
    if (n === 0 || n === 2) this.setData({ "form.closed": false });
    this.refresh();
  },
  terminal(e) {
    const i = e.currentTarget.dataset.index;
    this.setData({ ["form.melds[" + i + "].terminal"]: e.detail.value });
    this.refresh();
  },
  refresh() {
    try {
      this.setData({ result: calculateFu(this.data.form), error: "" });
    } catch (e) {
      this.setData({ result: null, error: e.message });
    }
  },
  use() {
    if (!this.data.result) return;
    wx.setStorageSync("calculatedFu", {
      fu: this.data.result.fu,
      method: this.data.form.method,
      minHan:
        this.data.result.fu === 25
          ? this.data.form.method === "tsumo"
            ? 3
            : 2
          : this.data.result.fu === 20
            ? 2
            : 1,
    });
    wx.switchTab({ url: "/pages/quick/index" });
  },
});
