export class Wechat {
  constructor({
    appId = process.env.WECHAT_APP_ID,
    secret = process.env.WECHAT_APP_SECRET,
    envVersion = process.env.WECHAT_ENV_VERSION ?? "release",
    fetcher = fetch,
  } = {}) {
    Object.assign(this, { appId, secret, envVersion, fetcher });
    this.cached = null;
  }
  configured() {
    return Boolean(this.appId && this.secret);
  }
  async call(url, options) {
    if (!this.configured())
      throw Object.assign(Error("小程序登录尚未配置"), { status: 503 });
    const r = await this.fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw Object.assign(Error("微信服务暂时不可用"), { status: 502 });
    return r;
  }
  async login(code) {
    if (typeof code !== "string" || !code || code.length > 256)
      throw Object.assign(Error("登录凭证无效"), { status: 400 });
    const q = new URLSearchParams({
      appid: this.appId ?? "",
      secret: this.secret ?? "",
      js_code: code,
      grant_type: "authorization_code",
    });
    const d = await (
      await this.call("https://api.weixin.qq.com/sns/jscode2session?" + q)
    ).json();
    if (d.errcode || !d.openid)
      throw Object.assign(Error("登录已过期，请重试"), { status: 401 });
    return { appId: this.appId, openid: d.openid };
  }
  async accessToken() {
    if (this.cached && this.cached.expires > Date.now())
      return this.cached.token;
    const q = new URLSearchParams({
      grant_type: "client_credential",
      appid: this.appId ?? "",
      secret: this.secret ?? "",
    });
    const d = await (
      await this.call("https://api.weixin.qq.com/cgi-bin/token?" + q)
    ).json();
    if (d.errcode || !d.access_token)
      throw Object.assign(Error("小程序码暂时不可用"), { status: 502 });
    this.cached = {
      token: d.access_token,
      expires: Date.now() + Math.max(0, (d.expires_in ?? 7200) - 120) * 1000,
    };
    return this.cached.token;
  }
  async qr(code) {
    if (!/^[a-f0-9]{32}$/.test(code)) throw Error("邀请代码无效");
    const token = await this.accessToken();
    const r = await this.call(
      "https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=" +
        encodeURIComponent(token),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scene: code,
          page: "pages/room/index",
          env_version: this.envVersion,
          width: 430,
          check_path: true,
        }),
      },
    );
    if (!r.headers.get("content-type")?.startsWith("image/"))
      throw Object.assign(Error("小程序码暂时不可用"), { status: 502 });
    return Buffer.from(await r.arrayBuffer());
  }
}
