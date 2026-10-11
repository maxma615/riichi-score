# 独立日麻记分：上海 ECS 部署

手机入口：**https://8.133.186.15/riichi/**。原情侣空间和联机麻将保持各自入口；不需要情侣空间账号。网页二维码是浏览器入桌链接，不是微信小程序码。

2026-10-11 当前部署源 `4942b1419cf6132dd24cb118aeb5e017db50f0d2`。ECS `i-uf6i9ie15g82dprialoy`，`cn-shanghai`；运行目录 `/srv/riichi-score/current` 指向 `/srv/riichi-score/releases/4942b14`。

## 进程与资料

- Compose项目 `yougui-riichi`，容器 `yougui-riichi-score`，Node24 普通用户运行。
- 镜像 `yougui-riichi-score:4942b14`，启动标签 `yougui-riichi-score:latest`。
- 独立持久化卷 `yougui-riichi_score_data` 挂载 `/data`；SQLite文件 `score.sqlite`。不共享情侣空间的PostgreSQL、账号或照片卷。
- 运行限制0.25CPU、128MiB内存、64进程，所有capability撤销。3200仅绑定127.0.0.1；Caddy经私有 `yougui_default` 网络转发。
- `.env`：`APP_ORIGIN=https://8.133.186.15`、`APP_BASE_PATH=/riichi`。不存放密码；不要提交环境文件或真实数据。

## 新设备升级

先在独立目录执行 `npm ci`、`npm test` 和 `npm run test:browser`。只打包受Git管理的源码，排除node_modules、环境文件与.local。上传到新的 `/srv/riichi-score/releases/提交号`，构建镜像并测试，保留现有独立卷。

```sh
# 在新的版本目录创建上述 .env，构建完成后执行；不要删卷。
docker build --pull=false -t yougui-riichi-score:提交号 .
docker tag yougui-riichi-score:提交号 yougui-riichi-score:latest
docker compose -p yougui-riichi -f compose.yml -f compose.ecs.yml up -d --no-build
```

本次使用已缓存的 `node:24-bookworm-slim`，构建限制0.5CPU/256MiB；服务器没有执行Next编译。停止服务只需相同Compose命令的 `stop`；恢复用 `up -d --no-build`。**不要使用 `down -v`**，它会删除记分数据。回滚时将latest改回保留的旧镜像并up，先确认数据库模式兼容。

## HTTPS网关

现有Caddy证书和80/443继续使用。路由保留前缀，不使用handle_path：

```caddyfile
@riichi_score path /riichi /riichi/*
reverse_proxy @riichi_score yougui-riichi-score:3200
```

代码中的 `Caddyfile` 与 `deploy/Caddyfile.ip` 已加入路由，后续情侣空间发布必须保留。现有Caddy实际bind挂载仍对应 `/srv/yougui/releases/ccfe04c9d5a4/deploy/Caddyfile.ip` 的inode；current文件为 `/srv/yougui/releases/2904c46/deploy/Caddyfile.ip`。本次两处已同步。更新网关前核对docker inspect和实际挂载内容，先validate再平滑reload；失败恢复原配置。旧的冻结发布包未包含本路由，不可直接覆盖网关。

当前实例继续遵守禁备份策略：不移除 `/srv/yougui/config/backups-disabled`，不启用备份timer、不生成或下载真实资料。独立记分服务也未配置自动备份。

验收见[实际记录](acceptance.md)。真实安卓与微信小程序仍待验收。

## 底部导航与原生小程序版本

本版新增底部四入口、逐项算符、月度统计及原生微信客户端。候选镜像 SHA-256 `0fb37844e0c5d541fef203b954a7a48f193ba69a02a6641fb140695b288fd747`。生产容器 Node24/Linux 的74项测试通过，升级前后原有 sessions/rooms/commands 表内容哈希一致；情侣空间容器未改变。初次只读卷核对遇到SQLite WAL访问错误，自动恢复旧版；允许SQLite维护共享内存后第二次升级成功，没有生成资料备份。

AppID与备案域名未提供，因此服务端微信配置为空，未发布微信体验版；网页版已上线。原生导入及配置见 微信相关文档与 miniprogram/project.config.json。

## 符番交叉表更新上线

2026-10-11源912dabb，镜像 `sha256:88565527aeb89c097fda4091451f7bdd49ca7f60efe23e7f5eb27ffc2a32c9b7` 已发布。78项Linux容器测试通过，原业务表哈希一致；实际0.25CPU/128MiB、独立卷及情侣空间容器未改变均已核对。公网HTTPS Chromium/WebKit手机390px验证交叉格点选、行列高亮、庄闲自摸支付、满贯至累计役满、算符回填、底部导航和匿名权限通过。两端源码已同步，微信正式发布条件仍待提供。

## 连庄与本场明细上线

2026-10-11源a951112，镜像 `sha256:d6cd511a2947258b7706af23ab0f5e0d62a3c5c16a3c86a19bd4683f4f979a9c` 已发布。83项Node24/Linux受限容器测试通过；原业务表哈希不变，情侣空间容器及0.25CPU/128MiB限制已核对。公网HTTPS Chromium/WebKit手机验证本场加减、金额随本场变化、无文本本场输入、线上支付明细模块、算符回填、限界表及匿名权限。没有生成真实测试牌桌或下载资料。原生小程序源码已同步，平台编译/真机/正式发布继续待AppID与备案域名。

## 点按记分与前置桌型上线

2026-10-11源b37c749，镜像 `sha256:7a370642e0f64c16e22287e7b9acc1ef116efd82b99b4ab892353bd182d6428d` 已发布。84项Node24/Linux受限容器测试通过。原业务表升级前后内容哈希一致，实际牌桌及记分保留；情侣空间容器与0.25CPU/128MiB限制均已核对。公网HTTPS Chromium/WebKit手机验证桌型/本场常显且排列最前、本场加减和支付更新、算符回填、点数矩阵与权限通过。原生页面同改，微信工具/真机与正式发布继续待AppID和备案域名。

## 算符中文术语修正上线

2026-10-11源4942b14，镜像 `sha256:ef78bcda3e650e8e134f0062083229ff64451e33f60f139e340a30de097e539c` 已发布。84项Linux受限容器测试、8组完整浏览器流程通过；公网两种浏览器手机验证“听牌形”、加符明细“单骑听牌”及回填。原业务表哈希一致，情侣空间容器及运行限制未改变。小程序源码同步，实际微信编译和发布未执行。
