const { apiBase } = require("../config");
let pending;
function request(
  path,
  method = "GET",
  data,
  token = wx.getStorageSync("session"),
) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: apiBase + path,
      method,
      data,
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      success: (r) =>
        r.statusCode >= 200 && r.statusCode < 300
          ? resolve(r.data)
          : reject(
              Object.assign(Error(r.data?.error || "请求失败"), {
                status: r.statusCode,
              }),
            ),
      fail: () => reject(Error("网络未连接，请重试")),
    }),
  );
}
function login() {
  if (!pending)
    pending = new Promise((resolve, reject) =>
      wx.login({
        success: (r) =>
          request("/api/wechat/login", "POST", { code: r.code }, "").then(
            (d) => {
              wx.setStorageSync("session", d.token);
              resolve(d.user);
            },
            reject,
          ),
        fail: reject,
      }),
    ).finally(() => (pending = null));
  return pending;
}
async function api(path, method = "GET", data) {
  if (!wx.getStorageSync("session")) await login();
  try {
    return await request(path, method, data);
  } catch (e) {
    if (e.status !== 401) throw e;
    await login();
    return request(path, method, data);
  }
}
const nonce = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
function avatar(url) {
  return url && url.startsWith("/")
    ? apiBase.match(/^https?:\/\/[^/]+/)[0] + url
    : url;
}
function error(e) {
  wx.showToast({ title: e.message || "请重试", icon: "none" });
}
module.exports = { api, nonce, avatar, error, apiBase };
