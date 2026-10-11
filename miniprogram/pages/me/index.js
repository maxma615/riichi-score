const { api, avatar, error } = require("../../utils/api");
Page({
  data: { month: "", stats: null, profile: null },
  onLoad() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    this.setData({
      month:
        d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"),
    });
  },
  onShow() {
    this.load();
  },
  month(e) {
    this.setData({ month: e.detail.value });
    this.load();
  },
  async load() {
    try {
      const [profile, stats] = await Promise.all([
        api("/api/profile"),
        api("/api/stats?month=" + this.data.month),
      ]);
      profile.avatar = avatar(profile.avatar);
      stats.peers = stats.peers.map((p) => ({
        ...p,
        avatar: avatar(p.avatar),
      }));
      this.setData({ profile, stats });
    } catch (e) {
      error(e);
    }
  },
  profile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
});
