const { lookup } = require("../../utils/lookup");
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
    more: false,
    settings: false,
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
        "quick.yakuman": 0,
      });
      wx.removeStorageSync("calculatedFu");
    }
    this.refresh();
  },
  choose(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ ["quick." + key]: value });
    if (key === "method" && !lookup(this.data.quick).result)
      this.setData({ "quick.fu": 30 });
    this.refresh();
  },
  selectCell(e) {
    const { fu, han, yakuman } = e.currentTarget.dataset;
    const q = {
      ...this.data.quick,
      fu: Number(fu),
      han: Number(han),
      yakuman: Number(yakuman || 0),
    };
    const view = lookup(q);
    if (!view.result) return;
    this.setData({ quick: q });
    this.refresh();
  },
  toggle(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: !this.data[key] });
  },
  honba(e) {
    this.setData({
      "quick.honba": Math.max(
        0,
        Math.min(
          100,
          this.data.quick.honba + Number(e.currentTarget.dataset.step),
        ),
      ),
    });
    this.refresh();
  },
  refresh() {
    this.setData(lookup(this.data.quick));
  },
});
