# 原生联机牌桌历史档案

2026-10-19 用户确认：微信「雀叙牌谱」只上线线下工具，联机麻将先仅在网站提供。本目录保留此前已实现的原生页面、实体三维、拖牌、鸣牌和结算源码及授权素材，方便回归；不放置 app.json、AppID 或发布配置，不是可直接提审的小程序项目。

实际微信项目只在仓库 `miniprogram/`。本目录位于其发布根目录之外，不会打入记分小程序；不能把联机代码移回、用隐藏入口或远程页面加入工具发布包。通用API／术语桥仅用于既有测试加载，不是另一个部署环境。

原生历史几何使用腾讯适配器 Three r108／WebGL1，同源布局、圆角牌体与光照。此前安卓优化已保留：增量几何缓冲／投影缓存、拖牌合并采样、单次飞牌提交、结算叶子更新及慢画布DPR降级。旧工具／浏览器验证与用户反馈保留在 docs/acceptance.md、docs/devtools-current.md；不表示现在计划发布微信游戏。

在仓库根目录运行：

```sh
npm run sync:mini            # 仅线下工具；不会生成任何联机文件
npm run sync:archive:native  # 仅重建本档案中的同源模块／三维包
npm run sync:archive:assets  # 仅重建本档案中的授权牌面／书法图
npm run sync:archive:audio   # 仅重建本档案中的原创结算声音
npm run test:mini:layout    # 历史WXML布局回归
npm run test:mini:webgl     # 历史原生后端真实WebGL桥回归
```

网站实际联机入口：[网站牌桌](https://yougui.online/riichi/online/)。网页源码、规则与服务位于 src/online/、public/online/，本次没有修改其业务或部署。
