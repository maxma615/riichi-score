const { api, avatar, error, nonce } = require("../../utils/api");
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
    this.setData({ month: e.detail.value });
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
  deleteHistory(e){
    const id=e.currentTarget.dataset.id;
    wx.showModal({title:"删除这张牌局？",content:"所有成员的该桌记录和相关统计将一并删除，删除后不能恢复。",confirmText:"删除",success:async r=>{
      if(!r.confirm)return;
      try{const room=await api("/api/rooms/"+id);await api("/api/rooms/"+id+"/events","POST",{action:"delete",version:room.version,nonce:nonce()});if(wx.getStorageSync("roomId")===id)wx.removeStorageSync("roomId");await this.load();}catch(e){error(e);}
    }});
  },
  openHistory(e) {
    wx.setStorageSync("roomId", e.currentTarget.dataset.id);
    wx.switchTab({url:"/pages/room/index"});
  },
  profile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
});
