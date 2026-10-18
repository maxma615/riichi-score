# 独立日麻应用协作约定

先读README.md、docs/design.md、docs/migration-plan.md及docs/acceptance.md。以记分为主，查番／算符辅助；继续把有归三／四麻联机与人机迁入本项目。所有包管理、测试数据、构建和环境配置放在本目录，.local为合成开发数据，不复制有归或服务器的真实资料。

不依赖有归的进程、PostgreSQL、账号、Cookie或附件。线上独立服务：上海ECS i-uf6i9ie15g82dprialoy，https://8.133.186.15/riichi/，独立yougui-riichi_score_data卷；不得重启或修改有归容器。遵守已禁备份策略，不生成或下载真实资料备份。

网页与原生微信小程序同步业务语义和紧凑水墨UI。维护共享纯函数时运行npm run sync:mini。运行npm test及必要的浏览器／Linux生产镜像验证；微信AppID和备案域名已配置，小程序备案审核中；适配器与浏览器验证不等于微信真机或发布。网页版与原生小程序均有真实WebGL几何牌桌；原生通过离屏WebGL／Canvas2D保留WXML交互，开发者工具另有位图呈现兼容分支。已完成模拟器检查，仍不能混称安卓真机性能已验收。所有更新提交并推送maxma615/riichi-score，凭据不入库。
