const { points, FU } = require("../../utils/scoring");
Page({
  data: {
    quick: {
      fu: 30,
      han: 1,
      players: 4,
      dealer: false,
      method: "ron",
      honba: 0,
      yakuman: 0,
    },
    fu: FU,
    han: Array.from({ length: 13 }, (_, i) => i + 1),
  },
  onLoad() {
    this.refresh();
  },
  onShow() {
    const fu = wx.getStorageSync("calculatedFu");
    if (fu) {
      this.setData({
        "quick.fu": typeof fu === "number" ? fu : fu.fu,
        "quick.method": fu.method || this.data.quick.method,
        "quick.han": Math.max(this.data.quick.han, fu.minHan || 1),
      });
      wx.removeStorageSync("calculatedFu");
    }
    this.refresh();
  },
  choose(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ ["quick." + key]: value });
    this.refresh();
  },
  honba(e) {
    this.setData({ "quick.honba": Number(e.detail.value || 0) });
    this.refresh();
  },
  refresh() {
    const q = this.data.quick;
    let result,
      error = "";
    try {
      result = points(q);
      result.payment =
        q.method === "ron"
          ? `放铳者支付 ${result.ron}`
          : q.dealer
            ? `每家 ${result.child}`
            : `闲家 ${result.child} / 庄家 ${result.parent}`;
    } catch (e) {
      error = e.message;
    }
    const rows = FU.map((fu) => ({
      fu,
      cells: [1, 2, 3, 4].map((han) => {
        try {
          return this.format(points({ ...q, fu, han, yakuman: 0 }));
        } catch {
          return "—";
        }
      }),
    }));
    const limits = [
      [5, "5番 · 满贯"],
      [6, "6–7番 · 跳满"],
      [8, "8–10番 · 倍满"],
      [11, "11–12番 · 三倍满"],
      [13, "13番以上 · 累计役满"],
    ].map(([han, label]) => ({
      label,
      value: this.format(points({ ...q, fu: 30, han, yakuman: 0 })),
    }));
    for (let n = 1; n <= 6; n++)
      limits.push({
        label: n === 1 ? "役满" : n + "倍役满",
        value: this.format(points({ ...q, yakuman: n })),
      });
    this.setData({ result, error, rows, limits });
  },
  format(p) {
    const q = this.data.quick;
    return q.method === "ron"
      ? String(p.ron)
      : q.dealer
        ? p.child + " ALL"
        : p.child + " / " + p.parent;
  },
});
