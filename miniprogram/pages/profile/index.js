const { api, avatar, error } = require("../../utils/api");
Page({
  data: { name: "", avatar: "", avatarData: "", saving: false },
  async onLoad() {
    try {
      const p = await api("/api/profile");
      this.setData({ name: p.name, avatar: avatar(p.avatar) });
    } catch (e) {
      error(e);
    }
  },
  name(e) {
    this.setData({ name: e.detail.value });
  },
  choose(e) {
    wx.compressImage({
      src: e.detail.avatarUrl,
      quality: 40,
      compressedWidth: 256,
      compressedHeight: 256,
      success: (r) => {
        const f = wx.getFileSystemManager();
        f.readFile({
          filePath: r.tempFilePath,
          encoding: "base64",
          success: (d) => {
            if (d.data.length > 175000) return error(Error("请选择较小的头像"));
            const type = d.data.startsWith("iVBORw0KGgo") ? "png" : "jpeg";
            this.setData({
              avatar: r.tempFilePath,
              avatarData: "data:image/" + type + ";base64," + d.data,
            });
          },
          fail: () => error(Error("头像读取失败")),
        });
      },
      fail: () => error(Error("头像处理失败")),
    });
  },
  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api("/api/profile", "POST", {
        name: this.data.name,
        ...(this.data.avatarData ? { avatarData: this.data.avatarData } : {}),
      });
      wx.navigateBack();
    } catch (e) {
      error(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});
