# 有归与麻将：独立维护入口

两个产品共享当前 ECS 和 HTTPS 网关，但不共享业务运行、身份或资料。

| 项目 | 有归 | 日麻应用 |
| --- | --- | --- |
| 手机入口 | https://8.133.186.15/ | https://8.133.186.15/riichi/ |
| GitHub | https://github.com/maxma615/yougui-couple-home | https://github.com/maxma615/riichi-score |
| 本地源码 | couple-home/ | riichi-score/ |
| 功能 | 情侣空间、照片、日历、共同记录与管理 | 线下记分、符番速查、算符、统计、三／四人联机和人机 |
| 身份 | 有归账号与会话 | 独立昵称会话；配置后使用独立微信身份 |
| 数据 | 有归 PostgreSQL、照片持久化卷 | 独立 SQLite 卷 yougui-riichi_score_data；联机内存状态 |
| 发布 | 有归自己的镜像与容器 | 自己的镜像与容器 yougui-riichi-score |

日麻联机入口：https://8.133.186.15/riichi/online/ 。打开、克隆、安装、构建和运行本仓库均不需要有归。升级或停止任一业务服务不要求操作另一服务；共享服务器或网关故障仍会影响两者。

旧 /mahjong 页面仅保留迁移跳转，旧 /api/mahjong 和 /mahjong/socket.io 不再承载业务。独立麻将不接受有归 Cookie，不访问有归数据库或照片。历史有归仓库中的麻将代码不作为当前生产运行与后续开发入口。

2026-10-12 再次核对公网：旧页面302到独立联机页、旧API／Socket410、独立健康200、有归Cookie请求401、匿名Socket拒绝连接。检查未创建生产牌桌、未复制真实数据、未重启两套应用。

微信小程序源码在本仓库 miniprogram/；正式发布仍需独立AppID和备案域名，当前网页可直接使用。
