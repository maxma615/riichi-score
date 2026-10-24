# 独立日麻记分：上海 ECS 部署

## 2026-10-18 真实三维牌桌前端更新

网页前端源3103c97已上线，current为/srv/riichi-score/releases/3103c97。以前端补丁方式替换client.js与client.css，并以原运行镜像生成yougui-riichi-score:3103c97／latest，镜像标识为sha256:d2017bcae550cceba2044ea6de27d1fa02935e65bb08e74e8bb656df85d54aa1。现有麻将容器ID和启动时间、全部有归容器ID及0.25CPU／256MiB限制与更新前相同，没有结束现有牌局。

Three.js已在本地构建进浏览器bundle，服务器未执行npm安装或几何渲染计算；后台仍是原07a07be服务程序。没有修改数据库、复制真实资料或生成资料备份。当前运行容器仍报告原镜像ID，其静态文件已就地更新；下次Compose重建使用保留本次资源的latest镜像。后续完整构建仍用正常Dockerfile。

公网JS SHA-256为5a4be2e08d1f9665c6922a406f0a828e9982d76480f309ab308b1a82cd2529a8，CSS为b7a866675a84e2b2d61634684193dd1fe3de64474af97239aafdf50f3f7c1c75，与本地构建和容器资源相同。牌桌入口、健康接口、原授权牌面及有归域名均返回200。330项常规、4组真实WebGL、18组特殊动作、4组真实服务浏览器检查通过；上下文丢失期间缩放也保持备用界面，恢复后才启用三维。原生仍为现有WXML渲染。

## 2026-10-18 立直自动操作与牌桌结算前端更新

网页前端源`c3a2183`已上线，`current`指向`/srv/riichi-score/releases/c3a2183`。本轮没有服务端规则或数据库改动：复用运行中的`07a07be`后端，仅替换构建出的`public/online/client.js`与`client.css`，没有重启容器，未结束现有联机牌桌。运行容器ID和启动时间、所有有归容器ID、0.25CPU／256MiB均与更新前一致，没有复制资料卷或生成真实资料备份。

同时以原运行镜像为基底生成持久化前端补丁镜像`yougui-riichi-score:c3a2183`并标记latest，镜像标识为`sha256:cf5aeb2d89fe4cc662ae76a2fd570a2f70eccf22055a635e66cbb922b46ace4d`，以后Compose重建会保留本次前端。现有运行容器仍报告旧镜像ID，实际静态资源已替换；不可据此宣称服务端已重建。后续完整升级仍使用正常Dockerfile和独立数据卷。

公网前端JS SHA-256为`d017c26d534a630a8db652d5dfb6a1a2f97659fe48174efbc59ad63788f3da32`，CSS为`78a796ae6d8b24b552fdcfe245cbd465ebb83b43650b4be13dc7b0cce863b379`，与本地及容器文件一致。牌桌入口、健康接口及有归域名均返回200。305项逻辑、204组原生布局、18组特殊动作、12组牌体／坐标流程通过；实际微信preview编译969,789字节，小程序新版未发布，仍等备案与真机验收。

## 当前域名与微信环境（2026-10-18；前端更新前记录）

当前入口为 **https://yougui.online/riichi/**，健康接口 `https://yougui.online/riichi/api/health` 返回 200，不跳转至 IP。原 IP 入口 308 跳转到该域名；下文 IP 入口及空微信环境为历史发布记录。

保持运行源 `07a07be` 与既有镜像，仅更新该版本目录下受保护的 `.env`：`APP_ORIGIN=https://yougui.online`、`APP_BASE_PATH=/riichi`、正式 `WECHAT_APP_ID`、AppSecret 及 `WECHAT_ENV_VERSION=trial`。AppSecret 不入库，环境文件为 0600。独立容器重建后健康、镜像与卷保持一致；微信 access_token 接口实测成功。没有重启有归或网关容器，没有创建或下载真实资料备份。

共享网关当前配置 `/srv/yougui/current/deploy/Caddyfile.ip` 已校验并平滑 reload：`yougui.online` 的 `/riichi` 和 `/riichi/*` 反代至 `yougui-riichi-score:3200`，IP 站点相同路径改为跳转域名。**有归下次发布必须保留此配置，不得恢复旧的域名到 IP 跳转。** 此仓库不修改有归本地源码，网关规则需纳入其后续发布核对。

当前小程序客户端已同步域名。开发者工具服务端口已开启；真实 wx.login 凭证经服务器换取应用会话成功，随后资料接口 200。CLI 上传 `0.1.0` 成功（908,440 字节），后台设为体验版、真实手机扫码仍待用户完成；当前入桌码生成收到微信 `41030 invalid page`。详细证据与界限见 `wechat-plan.md` 当前配置章节。

手机入口：**https://8.133.186.15/riichi/**。原情侣空间和联机麻将保持各自入口；不需要情侣空间账号。网页二维码是浏览器入桌链接，不是微信小程序码。

本轮前端更新前的网页运行源为 `07a07be`，运行目录 `/srv/riichi-score/current` 指向 `/srv/riichi-score/releases/07a07be`。后续小程序／测试／文档提交不改变网页运行版本。ECS `i-uf6i9ie15g82dprialoy`，`cn-shanghai`。

## 进程与资料

- Compose项目 `yougui-riichi`，容器 `yougui-riichi-score`，Node24 普通用户运行。
- 生产镜像 `sha256:b2a3eeba9a1ce05daf8d869eb76fd71151b05acd5f6456e8676a99992ed6bdd4`。
- 独立持久化卷 `yougui-riichi_score_data` 挂载 `/data`；SQLite文件 `score.sqlite`。不共享有归的PostgreSQL、账号或照片卷。
- 运行限制0.25CPU、256MiB内存、64进程，所有capability撤销。3200仅绑定127.0.0.1；Caddy经私有 `yougui_default` 网络转发。
- `.env`：`APP_ORIGIN=https://8.133.186.15`、`APP_BASE_PATH=/riichi`。不存放密码；不要提交环境文件或真实数据。
- 联机页 `/riichi/online/`；旧 `/mahjong` 跳转至此，旧联机 API／Socket 返回410。以下按日期章节是历史发布记录。

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

## 2026-10-12 全页紧凑布局上线

源`ba804fe72e074d8beae436ba56ff1ba1dd01cc7f`，镜像`sha256:00d704b9bca1d335239212c3f7a28c43f5713fe5ecf2a21fe55098f0e70da2c8`，独立current指向`/srv/riichi-score/releases/ba804fe`。84项Linux容器测试与8组本地浏览器流程通过；公网Chromium/WebKit在360px、390px手机视口检查固定算符结果、无溢出及原有查点流程。原三张业务表内容哈希一致，独立持久化卷、0.25CPU/128MiB限制、情侣空间容器与禁备份策略不变。小程序源码已改；正式微信配置和平台验收继续待提供。

## 2026-10-12 记分优先及分仓

线上线下应用源1d333eb，镜像sha256:57ad50898eddd9cd25696ab687f5903949f72e1763a2eb3bcf1eafa9615d509b，current为/srv/riichi-score/releases/1d333eb。86项Linux容器测试通过，现有业务表内容不变、独立卷和0.25CPU/128MiB限制、禁备份及有归容器未改变均核对。公网手机两种浏览器检查通过。

新源码入口为https://github.com/maxma615/riichi-score，独立根目录直接构建Docker上下文，不再从有归的mahjong-room取源码。提取ed0b2dd与有归1d333eb的应用文件一致，线上镜像仍标记原发布源，不伪称已从新修订重建。分仓后的维护继续使用同一独立记分卷，不创建备份、复制真实数据库或共享有归登录。原联机麻将服务待迁移，不属于本轮已部署功能。

## 2026-10-12 独立联机生产迁移

当前网页运行源`60eba12`，镜像`sha256:d9be7e1a19d5e07501d69883f4440c07892ecac7d8d19af61548df2a503749cd`，current为`/srv/riichi-score/releases/60eba12`。独立仓库已包含完整牌桌样式、Node子进程与Socket.IO；Docker多阶段构建前端和联机服务后仅保留生产依赖。最新原生绘牌／摸牌适配修正在`1d0f352`，该提交只改小程序和测试，网页构建与生产相同。

运行总上限0.25 CPU／256 MiB，3200仍仅回环监听，使用同一独立SQLite卷。Node24／Linux受限镜像90项测试通过，原三张记分业务表更新前后内容哈希不变；有归容器ID与进程未变，禁备份策略保留。网页前端JS与CSS公网内容SHA-256均与本地构建一致。公网360／390px入口、匿名HTTP／Socket权限、拒绝有归Cookie，以及旧页面302、新记分200、旧接口410均实际检查。没有写真实测试牌桌。

原表的透视、副露立体牌、飞牌、宣言、桌布、宝牌、横屏等独立样式按原导入顺序全部保留。本地Chromium／WebKit根路径和前缀4项手机横屏开桌／人机／牌面与字体加载通过，原线下8项浏览器流程通过。原生源码与HTTP适配已提交，微信平台验收未执行。

网关注意：宿主路径的当前文件与运行容器既有bind inode可能不同。本次先验证宿主当前配置，再通过`docker exec -i ... caddy reload --config /dev/stdin --adapter caddyfile`传入当前配置；随后从公网检查实际跳转和接口退役，不能仅凭CLI退出0宣称生效。有归仓库两份网关配置均须保留以下规则：

```caddyfile
redir /mahjong /riichi/online/ 302
redir /mahjong/ /riichi/online/ 302
@retired_mahjong path /api/mahjong /mahjong/socket.io*
respond @retired_mahjong "联机麻将已迁移至 /riichi/online/" 410
@riichi_score path /riichi /riichi/*
reverse_proxy @riichi_score yougui-riichi-score:3200
```

## 联机大厅与完整规则回归上线

网页源`3e1c657`、镜像`sha256:b8440e3a696d1f97d79e01f91703d41152c5be0cd4ab2b297a4cfbacdc67b798`已发布，current为`/srv/riichi-score/releases/3e1c657`。昵称入口和大厅使用紧凑纸页界面，结算和役种统一写“番”。`3c0dcc4`只补了本地测试自动构建及README接手说明，不改线上运行源。

生产镜像的90项Node检查在0.25 CPU／256 MiB下通过；107项迁入规则回归在同源构建检查镜像的0.25 CPU／384 MiB下通过（开发测试工具有额外内存，不能混称生产算法使用384 MiB）。运行服务仍限制0.25 CPU／256 MiB，端口仅回环、非root、独立卷；有归容器和原有记分业务表哈希保持不变。

全新代码目录独立npm ci与npm test自动构建、90＋107项测试通过。4组浏览器流程覆盖390px首屏大厅和横屏开局；公网360／390px实际检查新昵称纸页、输入能清空、权限与旧入口跳转。线上JS与CSS哈希和本地构建匹配。无生产测试牌桌，无真实资料备份或下载。

## 最近牌桌昵称与零支出修正上线（2026-10-12）

网页源69c11a9、镜像sha256:e0277fabcd21cde6abcd2e786b4767352bc3335cb640fb1a6b897242407a059a已发布。最近牌桌读取最新profiles昵称，历史牌局快照不改写；单局最高支出通过绝对值显示，零支出为0点。网页和原生小程序均消费同一HTTP返回，无需维护不同文案。

本地129项Node＋107项规则检查及8组Chromium／WebKit浏览器流程通过。Linux生产镜像在0.25CPU／256MiB限制下96项服务检查通过，同源开发检查镜像在0.25CPU／384MiB下107项规则回归通过。实际服务仍为0.25CPU／256MiB、node、64进程、撤销所有capability、回环3200和独立卷。升级前后六张业务表（sessions、rooms、commands、profiles、wechat_accounts、wechat_sessions）内容摘要一致；有归容器ID及启动时间不变，禁备份标记保留。未复制真实数据、生成备份或写入生产测试牌桌。

公网健康200、匿名牌桌401、有归200、旧麻将入口302至独立联机页已核对；部署中src/store.js与src/stats.js逐字节哈希匹配本地源码。正式微信配置依旧为空，未上传发布小程序。部署证据保留于旧工具工作目录.local/ecs-deploy/late-response-remote-captures/late-response-profile-refresh-*。

## 联机中文术语上线（2026-10-12）

源c08e23f、镜像sha256:df34449ad84d7414699159512a6910913bcd7b9e3a49da250863fe29797414d1已发布，current为/srv/riichi-score/releases/c08e23f。src/yaku.js的mahjongTerm为显示层转换，网页版结算明细／旧摘要／流局标题及原生结算共用；领域原始名称、番数、事件和金额不变。涵盖固定规则库所有普通役／役满／宝牌名称、场风自风、三麻拔北宝牌，以及常见流局标题；未知名称保留。

238项本地常规检查、18组Chromium／WebKit特殊动作流程、168组原生布局适配通过。生产镜像0.25CPU／256MiB下97项服务检查通过，同源开发检查镜像0.25CPU／384MiB下107项规则回归通过，实际服务仍为256MiB。六张业务表升级前后内容摘要一致，有归容器ID及启动时间、禁备份标记、独立卷、node用户、64进程、全部capability撤销及回环3200均核对。没有写生产测试牌桌或复制／备份真实数据。

公网健康200、匿名牌桌401及有归200；client.js和client.css内容哈希匹配本地构建，部署中共享术语源码哈希fdd162ff3c2d993df83cbf38f05462f90889c14cf0ff554a55b56915ae4c0cda匹配。发布证据在旧工具工作目录.local/ecs-deploy/late-response-remote-captures/late-response-c08e23f-terms-*，公网资源记录在本仓库.local/devtools-synthetic/terms-production-assets.json。小程序源码同步并在当前工具直接看到中文一气通贯；正式微信配置仍为空，未发布小程序。


## 开桌规则开关与加载保留（2026-10-12）

源07a07be已上线：切上满贯／累计役满采用纸页内紧凑朱砂开关，整行可点；首次身份请求结束时保留已填昵称、桌型与规则，避免重建表单还原默认值。原生同步按钮与状态样式，正式微信发布仍未执行。

本地242项常规及8组完整浏览器流程通过，浏览器增加受控延迟身份请求回归。Linux实际运行镜像内97项服务检查及107项规则通过。发布后六张业务表摘要一致；有归容器ID及启动时间未变，256MiB／0.25CPU、普通用户、独立卷、回环端口与禁备份标记再次核对。证据在旧工具工作目录.local/ecs-deploy/late-response-remote-captures/late-response-07a07be-switch-*。

### 2026-10-24 域名跳回 IP 的修复

发现 `https://yougui.online/riichi/` 与 `/riichi/online/` 返回 302 到 IP。DNS/TLS 正常，根因是 Caddy 实际绑定的旧 release 文件仍包含 IP 跳转，与 current 路径的文件不同。已定位并原位更新绑定 inode 对应的 Caddyfile，将域名下的 `/riichi`、`/riichi/*` 恢复反向代理至 `yougui-riichi-score:3200`，旧 `/mahjong` 入口改为域名地址。配置验证后热加载，未重启有归或记分容器，未操作业务数据。

验证：两个页面 GET 200，健康接口返回 ok；有归 `/home` 200。以后更新网关须同时核对容器实际挂载内容及运行配置，不能只写 current 路径。此次未新增子域名。

### 2026-10-24 独立子域名入口

公开入口为 https://riichi.yougui.online/ （302 到 /riichi/）；联机页面为 https://riichi.yougui.online/riichi/online/。DNS A 记录已由用户添加至 8.133.186.15，Caddy 自动签发 HTTPS 证书。旧 yougui.online 的记分及联机入口页面 GET/HEAD 跳转至新域名，旧 API、静态文件、Socket 路径保留，兼容既有微信客户端。

本次采用网关别名，未更改运行进程 APP_ORIGIN=https://yougui.online 或 APP_BASE_PATH=/riichi，也未重启业务容器。新域名下仅当 Origin 精确等于 https://riichi.yougui.online 且路径匹配 /riichi 或 /riichi/* 时，代理向源站传递其配置的旧 Origin；其他 Origin 原样透传，由应用继续拒绝。不应无条件覆盖所有请求 Origin。浏览器 Cookie 按域名隔离，新域名可能需要重新登录；现有二维码仍生成旧域名地址，经入口跳转进入新域名。

实际挂载旧 release Caddyfile 与 current 文件均已原位更新；current 文件的其他站点保持原样。新增站点根路径跳至 /riichi/，匹配路径代理至 yougui-riichi-score:3200，其余路径 404。微信客户端仍使用原合法域名，无需立即更改微信后台。

验证：TLS 验证通过；新域名记分页、联机页、健康接口、旧域名健康接口 GET 200；新 Origin 登录空昵称请求进入业务校验并返回 400，非法 Origin 返回 403（未创建测试账户）；Socket.IO polling 握手新 Origin 200、非法 Origin 403。有归与记分容器 StartedAt 未变。未以真实微信账号完成扫码登录或实际多人对局验收。

### 2026-10-24 共享记分与明确选择起庄

已部署 src/store.js 与 public/app.js，记分 action=record 允许全部已加入成员，其他管理操作保持桌主权限；既有牌桌无需数据迁移。新网页／小程序创建时传 chooseDealer=true，首次记分前桌主明确选择起庄玩家；整体旋转座位使起庄为东家，不改变成员与分数对应。旧客户端未传该字段时保持兼容。进行中牌桌不修改庄家或历史。

173 Node 测试及 187 规则测试通过；八组 Chromium/WebKit × 手机/桌面 × 根/前缀浏览器检查通过，覆盖成员入口、选择庄家、旧表单冲突；追加存储测试覆盖非成员拒绝、成员记分、版本冲突、重复提交、管理权限、座位旋转。微信页面仅完成源码同步及 JS 语法检查，未上传／发布新版、未完成真机验证。

生产服务仅重启 yougui-riichi-score，启动时间 2026-10-24T13:53:09Z；有归仍为 2026-10-18T08:23:55Z。运行容器、current 源码同步补丁；基于原镜像及现有公开静态文件构建持久化补丁镜像 yougui-riichi-score:shared-score-20261024 并更新 latest，未快照运行环境或数据卷。线上 app.js SHA256 eef6df186f673af61ca0af3f754c47f69e2a37de61453759aa7479fb19aa5bf2，健康接口成功；运行容器内使用内存 SQLite 合成数据验证 memberRecord=true，未读取或复制用户牌桌数据。

### 2026-10-24 和牌优先、全成员管理

全体已入桌成员可使用所有牌桌命令（记分、撤回、结束、开局前选庄与填写玩家），仍通过成员校验、事务、版本和nonce控制并发；外部账号不能管理。记分首先点选和牌人，再选自摸／荣和，再点放铳人，符番与役满均为按钮，无下拉框，支持双响。微信源码同步，未上传或发布新版。

源代码、公开 app.js/style.css 已更新到运行容器及 current，持久补丁镜像 yougui-riichi-score:winner-first-20261024 / latest。仅重启记分服务至 2026-10-24T15:17:22Z，有归未重启。健康接口通过，线上JS/CSS哈希与本地一致；内存SQLite合成检查 memberFinish=true、memberUndo=true，未读取或复制用户业务资料。

### 2026-10-25 中文用户名身份上线

网页支持以用户名／昵称登录，首次创建固定 UUID，同名登录创建新的会话而复用原账号。修改名字保留 UUID；历史牌桌、邀请名单与统计按 profiles 最新名字展示，未修改历史分数或合并账号。改名撞名返回 409；历史数据已存在多个同名账号时拒绝自动认领，需在原浏览器改名解除歧义。按用户明确选择，不设置密码。

新增“我的 → 用户名登录／我的名字”表单及 account-name.js 路由。部署包含 src/store.js、src/server.js、public/app.js、public/account-name.js；保留已发布 3924c66 记分流程。源码与 current、运行容器同步，持久镜像 yougui-riichi-score:username-20261025 / latest，仅从源代码和公开静态文件构建，未复制数据卷或快照密钥。记分服务重启于 2026-10-25 00:23:26（北京时间），有归启动时间保持 2026-10-18T08:23:55Z。

验证：175 Node + 187 规则测试通过；独立 Chromium 会话验证中文同名登录、改名后旧会话刷新及新浏览器恢复相同 ID；存储测试覆盖历史显示、统计、重名、重启持久化。生产健康接口与静态文件哈希通过，容器内仅使用内存 SQLite 验证 username identity and rename，不创建真实服务测试账号。app.js SHA256 067a97fce2fbfdb6929260df626ae1f323e7fa7e5bbcc9b8c14693d91382f986。

### 2026-10-25 我的对局历史

在确认 de816e2 用户名身份版本已上线（线上 app.js 哈希一致）后追加。本次“我的”页面展示所有已参与线下牌桌、同桌姓名、记分局数、结束状态与本人净点数，独立于月度统计筛选；点击打开牌桌查看点数和逐局记录。列表解除30桌截断，按成员固定ID隔离，以最新资料显示姓名。新桌记录创建时间，历史桌没有日期时不虚构。微信源码同步入口，未发布微信新版。

全量176 Node +187规则检查通过，追加小程序历史导航后12项定向检查通过；8组浏览器历史入口与回看流程通过，独立用户名浏览器回归通过。生产公开文件哈希、健康接口、内存SQLite身份保留与历史字段验证通过，不读写实际用户牌局。镜像 yougui-riichi-score:history-20261025 / latest 保留运行容器完整源码与公开资源（含账号身份版本）；记分服务重启至2026-10-24T16:27:13Z（北京时间25日00:27），有归未重启。

### 2026-10-25 删除牌局、调整座位与立直点选

网页已提供空桌直接删除及历史牌局删除，确认后移除全桌记录与相关统计。删除仍验证成员身份和版本，事务清理命令记录；其他成员刷新后退出已删除桌。扫码自动加入空位，首次记分前支持拖动排序及按钮辅助调整，排序后重新选择起庄人；已有记分的桌不允许重排。立直改为整块玩家名字点选。微信源码同步，尚未上传或真机验收。

178项Node及187项规则检查通过，最后追加的定向检查12项通过；8组Chromium/WebKit手机／桌面浏览器流程通过，覆盖拖动、删除确认及历史刷新。权限、版本冲突、删除后重启持久化均有验证。

持久镜像 yougui-riichi-score:management-20261025 / latest 保留完整运行源码与公开资源，未复制密钥或用户数据。仅重启记分服务，StartedAt=2026-10-24T17:31:16.200015315Z；有归未重启。健康接口成功，线上JS/CSS哈希与本地一致；容器内存SQLite合成检查自动入座、排序和删除通过。未删除或重新排序任何实际用户牌局。

### 2026-10-25 整场结算与原班续桌

部署src/store.js、src/scoring.js、src/settlement-view.js及public/app.js/style.css；更新前逐个核对运行文件与0031af9一致，保留运行镜像完整源码与公开资源。持久补丁镜像 yougui-riichi-score:session-flow-20261025 / latest，仅包含代码和公开资源，不包含密钥或数据卷。

仅重启记分服务，StartedAt=2026-10-24T18:51:34.820112397Z（北京时间25日02:51）；有归仍为2026-10-18T08:23:55.08055454Z。健康接口成功，公开JS/CSS及共享计分／明细模块哈希与本地一致；内存SQLite合成检查autoFinish、sameMembers、sharedRematch通过，不读取、删除或重排实际牌局。

小程序线下源码同步，7份WXML及5份WXSS在固定Linux编译器通过；尚未上传或真机验收。网页版8组浏览器完整流程通过，权限／持久化／版本冲突及重复续桌回归见acceptance.md。

### 2026-10-25 自动续桌与全点选

src/store.js新增只读current追踪，src/server.js普通牌桌GET支持follow=1；普通历史GET和二维码仍指向原桌。public/app.js/style.css接入自动追踪、前台恢复、首屏回主页和全按钮交互。发布前核对这四份线上文件与4dfdb33一致，保留完整运行源码和公开资源构建yougui-riichi-score:auto-follow-20261025 / latest，不包含环境文件和数据卷。

仅重启记分服务，StartedAt=2026-10-24T19:08:16.197843109Z（北京时间25日03:08），有归仍为2026-10-18T08:23:55.08055454Z。线上健康成功，app.js SHA256 8bee40f82d2d43453ab4c84abb6d857f629f0279a4cf99652cac39b23a890f11，style.css SHA256 9f9d8994753bcb340be81a6f3ad697ca3047cb53b3cedbb4736643e3506dd440。内存SQLite合成检查follow、history、readOnly通过；未操作实际用户牌桌。

小程序线下源码同步，模板／样式编译通过，未上传新版。发布后各成员需刷新网页加载新客户端，此后续桌自动跟进，不再要求每人点击或扫码。
