# 独立日麻记分：上海 ECS 部署

手机入口：**https://8.133.186.15/riichi/**。原情侣空间和联机麻将保持各自入口；不需要情侣空间账号。网页二维码是浏览器入桌链接，不是微信小程序码。

2026-10-11 部署源 `211b33162b41fb8e042e696dc3a20e82d25767e9`。ECS `i-uf6i9ie15g82dprialoy`，`cn-shanghai`；运行目录 `/srv/riichi-score/current` 指向 `/srv/riichi-score/releases/211b331`。

## 进程与资料

- Compose项目 `yougui-riichi`，容器 `yougui-riichi-score`，Node24 普通用户运行。
- 镜像 `yougui-riichi-score:211b331`，启动标签 `yougui-riichi-score:latest`。
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
