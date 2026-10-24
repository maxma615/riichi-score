const { api, avatar, error } = require("../../utils/api");
Page({
  data: { month: "", stats: null, profile: null, games: [] },
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
    const [year,month]=this.data.month.split("-").map(Number);
    const d=new Date(Date.UTC(year,month-1+Number(e.currentTarget.dataset.step),1));
    this.setData({ month: d.toISOString().slice(0,7) });
    this.load();
  },
  async load() {
    try {
      const [profile, stats, games] = await Promise.all([
        api("/api/profile"),
        api("/api/stats?month=" + this.data.month),
        api("/api/rooms"),
      ]);
      profile.avatar = avatar(profile.avatar);
      stats.peers = stats.peers.map((p) => ({
        ...p,
        avatar: avatar(p.avatar),
      }));
      this.setData({ profile, stats, games: games.map(g=>({...g, namesText:g.names.join(" / ")})) });
    } catch (e) {
      error(e);
    }
  },
  openHistory(e) {
    wx.setStorageSync("roomId", e.currentTarget.dataset.id);
    wx.setStorageSync("roomMode","history");
    wx.switchTab({url:"/pages/room/index"});
  },
  profile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
});
