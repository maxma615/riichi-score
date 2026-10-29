# 独立日麻应用协作约定

先读README.md、docs/design.md、docs/migration-plan.md及docs/acceptance.md。以记分为主，查番／算符辅助；网页版保留三／四麻联机与人机；微信「雀叙牌谱」只做线下记分工具（2026-10-19用户确认）。所有包管理、测试数据、构建和环境配置放在本目录，.local为合成开发数据，不复制有归或服务器的真实资料。

不依赖有归的进程、PostgreSQL、账号、Cookie或附件。线上独立服务：上海ECS i-uf6i9ie15g82dprialoy，https://8.133.186.15/riichi/，独立yougui-riichi_score_data卷；不得重启或修改有归容器。遵守已禁备份策略，不生成或下载真实资料备份。

网页与原生微信小程序同步线下记分业务语义和紧凑水墨UI。维护共享纯函数时运行npm run sync:mini；该命令只生成线下工具代码。miniprogram/是实际微信发布目录，不得放入联机页面／入口／API调用、三维运行时或打牌资源。历史原生联机源、资源和回归在archive/native-online/，无AppID、发布入口或独立上线计划；重建必须使用sync:archive:*，禁止写回记分小程序。

运行npm test及必要的浏览器／平台编译验证；当前小程序备案审核中，预览不等于审核或发布。记分站（riichi.yougui.online）以 APP_MODE=score 去掉联机；联机日后部署 mahjong.yougui.online（本轮不上线）。不修改有归业务或数据库、不重启有归。所有更新提交并推送maxma615/riichi-score，凭据不入库。
