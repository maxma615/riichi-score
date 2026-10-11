const { searchYaku } = require("../../utils/yaku");
Page({
  data: {
    query: "",
    group: "全部",
    groups: ["全部", "1番", "2番", "3番", "6番", "役满"],
    items: [],
  },
  onLoad() {
    this.refresh();
  },
  search(e) {
    this.setData({ query: e.detail.value });
    this.refresh();
  },
  choose(e) {
    this.setData({ group: e.currentTarget.dataset.group });
    this.refresh();
  },
  refresh() {
    this.setData({ items: searchYaku(this.data.query, this.data.group) });
  },
});
