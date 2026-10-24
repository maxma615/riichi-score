const { api, nonce, avatar, error, apiBase } = require("../../utils/api");
const { parseInvite } = require("../../utils/invite");
const { roundStatus } = require("../../utils/settlement-view");
const winds = ["东", "南", "西", "北"];
Page({
  data: {
    room: null,
    rooms: [],
    invite: null,
    code: "",
    profile: null,
    qr: "",
    loading: false,
    kiriage: false,
    kazoe: true,
    rounds: 2,
  },
  onLoad(o) {
    const code = parseInvite(o.scene || o.join || "");
    if (code) this.setData({ code });
  },
  onShow() {
    this.load();
    this.timer = setInterval(() => {
      if (this.data.room && !this.data.loading) this.refresh().catch(() => {});
    }, 10000);
  },
  onHide() {
    clearInterval(this.timer);
  },
  onUnload() {
    clearInterval(this.timer);
  },
  async load() {
    this.setData({ loading: true });
    try {
      const profile = await api("/api/profile");
      profile.avatar = avatar(profile.avatar);
      this.setData({ profile });
      if (this.data.code) {
        const invite = await api("/api/invite?code=" + this.data.code);
        invite.seats = invite.seats.map((s) => ({
          ...s,
          wind: winds[s.seat],
          avatar: avatar(s.avatar),
        }));
        this.setData({ invite });
        return;
      }
      const id = wx.getStorageSync("roomId");
      if (id) {
        try {
          await this.openRoom(id);
          return;
        } catch (e) {
          if (e.status !== 404 && e.status !== 403) throw e;
          wx.removeStorageSync("roomId");
        }
      }
      this.setData({ room: null, rooms: await api("/api/rooms") });
    } catch (e) {
      error(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  view(r) {
    const members = r.members.map((m, seat) => ({
      ...(m || {}),
      seat,
      wind: winds[seat],
      avatar: avatar(m?.avatar),
      score: r.scores[seat],
      delta: r.scores[seat] - r.rules.start,
      empty: !m,
      dealer: r.dealerSelected !== false && seat === r.dealer,
    }));
    const history = r.history
      .filter((h) => h.kind !== "finish")
      .map((h) => ({
        ...h,
        label:
          ["东", "南", "西", "北"][Math.floor(h.hand / r.rules.players)] +
          " " +
          ((h.hand % r.rules.players) + 1) +
          "局",
        changes: h.delta.map((n, i) => ({
          name: members[i].name,
          value: n,
          positive: n >= 0,
        })),
      }));
    const circle = new Map();
    for (const h of r.history) {
      if (h.kind === "finish") continue;
      const c = Math.floor(h.hand / r.rules.players);
      if (!circle.has(c)) circle.set(c, Array(r.rules.players).fill(0));
      h.delta.forEach((n, i) => (circle.get(c)[i] += n));
    }
    this.setData({
      room: r,
      status: roundStatus(r),
      members,
      ranking: [...members].sort((a,b)=>b.score-a.score||a.seat-b.seat),
      history: history.reverse(),
      round:
        (["东", "南", "西", "北"][Math.floor(r.hand / r.rules.players)] ||
          "延长") +
        ((r.hand % r.rules.players) + 1) +
        "局",
      circles: [...circle].map(([c, values]) => ({
        label: (["东", "南", "西", "北"][c] || "延长") + "圈",
        changes: values.map((value, i) => ({
          name: members[i].name,
          value,
          positive: value >= 0,
        })),
      })),
    });
  },
  async refresh() {
    const id = this.data.room?.id;
    if(id) {
      try{this.view(await api("/api/rooms/"+id));}
      catch(e){if(e.status!==404)throw e;wx.removeStorageSync("roomId");this.setData({room:null});await this.load();}
    }
  },
  async openRoom(id) {
    const r = await api("/api/rooms/" + id);
    wx.setStorageSync("roomId", id);
    this.view(r);
  },
  open(e) {
    this.openRoom(e.currentTarget.dataset.id).catch(error);
  },
  create(e) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    api("/api/rooms", "POST", {
      players: e.currentTarget.dataset.players,
      chooseDealer: true,
      rounds: this.data.rounds,
      kiriage: this.data.kiriage,
      kazoe: this.data.kazoe,
    })
      .then((r) => {
        wx.setStorageSync("roomId", r.id);
        this.view(r);
      })
      .catch(error)
      .finally(() => this.setData({ loading: false }));
  },
  rule(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.loading && ["kiriage", "kazoe"].includes(key))
      this.setData({ [key]: !this.data[key] });
  },
  scan() {
    wx.scanCode({
      success: (r) => {
        const code = parseInvite(r.path || r.result);
        if (!code) return error(Error("没有找到牌桌"));
        this.setData({ code, room: null, qr: "" });
        this.load();
      },
      fail: (r) => {
        if (!/cancel/.test(r.errMsg || "")) error(Error("扫码失败，请重试"));
      },
    });
  },
  async join(e) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const r = await api("/api/join", "POST", {
        code: this.data.code,
        seat: e.currentTarget.dataset.seat,
      });
      this.setData({ code: "", invite: null });
      wx.setStorageSync("roomId", r.id);
      this.view(r);
    } catch (e) {
      error(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  cancelJoin() {
    this.setData({ code: "", invite: null });
    this.load();
  },
  profile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
  record() {
    wx.navigateTo({ url: "/pages/record/index?id=" + this.data.room.id });
  },
  add(e) {
    wx.showModal({
      title: "填写玩家",
      editable: true,
      placeholderText: "昵称",
      success: (r) => {
        if (r.confirm && r.content)
          this.command("add-player", {
            seat: e.currentTarget.dataset.seat,
            name: r.content,
          });
      },
    });
  },
  command(action, fields = {}) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    return api("/api/rooms/" + this.data.room.id + "/events", "POST", {
      action,
      nonce: nonce(),
      version: this.data.room.version,
      ...fields,
    })
      .then((r) => {
        if(r.deleted){wx.removeStorageSync("roomId");this.setData({room:null});return this.load();}
        this.view(r);
      })
      .catch((e) => {
        error(e);
        if (e.status === 409) this.refresh();
      })
      .finally(() => this.setData({ loading: false }));
  },
  deleteRoom() {
    wx.showModal({title:"删除这张牌局？",content:"所有成员的该桌记录和相关统计将一并删除，删除后不能恢复。",confirmText:"删除",success:r=>{if(r.confirm)this.command("delete");}});
  },
  sortSeats() {
    const r=this.data.room;
    this.sortVersion=r.version;
    this.dragIndex=null;this.dragTo=null;
    this.setData({dragging:-1,seatOrder:r.members.map((m,seat)=>({seat,name:m?.name||"空位",offset:0})),sorting:true});
  },
  noop(){},
  dragStart(e) {
    const touch=e.touches[0];if(!touch||e.touches.length!==1)return;
    this.dragIndex=Number(e.currentTarget.dataset.index);this.dragTouch=touch.identifier;this.dragY=touch.clientY;
    this.setData({dragging:this.dragIndex,seatOrder:this.data.seatOrder.map(m=>({...m,offset:0}))});
    wx.createSelectorQuery().in(this).selectAll(".order-seat").boundingClientRect(rows=>{if(this.dragIndex!==null)this.dragRects=rows;}).exec();
  },
  dragMove(e) {
    if(this.dragIndex===null||!this.dragRects)return;
    if(e.touches.length!==1)return this.dragCancel();
    const touch=e.touches[0];if(touch.identifier!==this.dragTouch)return this.dragCancel();
    const rows=this.dragRects,from=this.dragIndex;
    const dy=Math.max(rows[0].top-rows[from].top,Math.min(touch.clientY-this.dragY,rows[rows.length-1].top-rows[from].top));
    const center=(rows[from].top+rows[from].bottom)/2+dy;
    const to=rows.reduce((best,r,i)=>Math.abs((r.top+r.bottom)/2-center)<Math.abs((rows[best].top+rows[best].bottom)/2-center)?i:best,0);
    this.dragTo=to;
    this.setData({seatOrder:this.data.seatOrder.map((m,i)=>({...m,offset:i===from?dy:from<to&&i>from&&i<=to?rows[i-1].top-rows[i].top:from>to&&i>=to&&i<from?rows[i+1].top-rows[i].top:0}))});
  },
  dragEnd() {
    const from=this.dragIndex,to=this.dragTo,order=[...this.data.seatOrder];
    if(Number.isInteger(from)&&Number.isInteger(to)&&from!==to){const [m]=order.splice(from,1);order.splice(to,0,m);}
    this.dragIndex=null;this.dragTo=null;this.dragRects=null;
    this.setData({dragging:-1,seatOrder:order.map(m=>({...m,offset:0}))});
  },
  dragCancel(){this.dragTo=null;this.dragEnd();},
  sortUp(e) {
    const i=Number(e.currentTarget.dataset.index);if(i<1)return;
    const order=[...this.data.seatOrder];[order[i-1],order[i]]=[order[i],order[i-1]];this.setData({seatOrder:order});
  },
  saveOrder() {
    this.command("reorder",{order:this.data.seatOrder.map(m=>m.seat),version:this.sortVersion}).then(()=>this.setData({sorting:false}));
  },
  cancelOrder(){this.dragCancel();this.setData({sorting:false});},
  length(e){const rounds=Number(e.currentTarget.dataset.rounds);if(this.data.room)this.command("set-length",{rounds});else this.setData({rounds});},
  removePlayer(e){const seat=Number(e.currentTarget.dataset.seat);wx.showModal({title:"更换这位玩家？",content:"移出后可以扫码加入或填写新玩家。",success:r=>{if(r.confirm)this.command("remove-player",{seat});}});},
  rematch(){return this.command("rematch").then(()=>{this.setData({qr:""});wx.pageScrollTo({scrollTop:0,duration:0});});},
  selectDealer() {
    const r = this.data.room;
    if (r.members.some(m => !m)) return error(Error("请先为所有座位添加成员"));
    wx.showActionSheet({itemList:r.members.map(m=>m.name),success:res=>this.command("set-dealer",{seat:res.tapIndex})});
  },
  undo() {
    wx.showModal({
      title: "撤回最近一局？",
      success: (r) => {
        if (r.confirm) this.command("undo");
      },
    });
  },
  finish() {
    wx.showModal({
      title: "结束这场牌局？",
      success: (r) => {
        if (r.confirm) this.command("finish");
      },
    });
  },
  another() {
    wx.removeStorageSync("roomId");
    this.setData({ room: null, qr: "" });
    this.load();
  },
  share() {
    wx.request({
      url: apiBase + "/api/rooms/" + this.data.room.id + "/wxcode",
      header: { Authorization: "Bearer " + wx.getStorageSync("session") },
      responseType: "arraybuffer",
      success: (r) => {
        if (r.statusCode !== 200) return error(Error("小程序码暂时不可用"));
        const path = wx.env.USER_DATA_PATH + "/invite.png";
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: r.data,
          success: () => this.setData({ qr: path }),
          fail: () => error(Error("小程序码保存失败")),
        });
      },
      fail: () => error(Error("网络未连接")),
    });
  },
  closeQr() {
    this.setData({ qr: "" });
  },
  onShareAppMessage() {
    return {
      title: "来一起打日麻",
      path: "/pages/room/index?scene=" + this.data.room?.code,
    };
  },
});
