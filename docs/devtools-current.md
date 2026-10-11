# 当前微信开发者工具实测（2026-10-12）

本次使用腾讯官方稳定版 2.02.2608080（ARM64，官方配置标记日期 2026-09-30），在本机 macOS 导入本仓库 miniprogram/，游客模式、基础库 3.17.4。源码基准 07f7c41；这是当前官方工具模拟器实测，区别于此前浏览器布局适配和 2020 年模板编译器。

## 获取与运行

官方入口：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html 。页面脚本实际获取版本配置 https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json 。选取 stable/macOS/ARM64 包，保存于被忽略的 .local/wechat-devtools/。

包 SHA256：faeb39e0c3496747e6b958c05452af389bdbe428e13885cd4fb191e6c7172840。pkgutil --check-signature 确认 Tencent Technology (Shanghai) Company Limited 的 Apple Developer ID 签名及可信公证；codesign --verify --deep --strict 应用验证退出 0。用 pkgutil --expand-full 解包，在项目本地工具目录启动，没有执行全局安装脚本。

命令行服务端口默认关闭，cli open 返回 service port disabled；没有修改安全设置。通过工具界面选游客模式、导入 miniprogram、选择不使用云服务、运行本项目。工具导入时补入默认 project.config 选项；这些机器自动生成选项已恢复为仓库原配置。基础库等本机设置在 Git 忽略的 project.private.config.json。

## 直接观察到的运行结果

| 页面与操作 | 当前工具模拟器结果 |
| --- | --- |
| 记分首页 | pages/room/index 加载；开三人／四人桌、扫码、头像昵称入口与四个底部 tab 渲染 |
| 符番速查 | pages/quick/index 加载；桌型、本场、庄闲与荣和／自摸开关、四列交叉表和满贯以上行显示 |
| 支付交互 | 点选 3番40符、增加到1本场、切自摸；显示总收5,500，闲家各付1,400、庄家2,700 |
| 算符 | pages/fu/index 加载；门前清荣和+10符、点选边张／嵌张／单骑+2符，结果从30变40，显示32符向上取整；底部结果固定且可见 |
| 算符回填 | 点击“用这个符数查点”回到速查；保留3番与1本场，切荣和并使用40符，显示放铳者付5,500 |
| 查番 | pages/yaku/index 加载；点2番筛选，显示七对子、对对和、三暗刻等，保留副露后的番数 |
| 联机入口 | pages/online/index 加载并自动横屏，工具页面区域标记844×346；三／四人、东风／半庄、创建及房间码加入入口显示 |

上述是通过 UI 的当前官方工具渲染和实际点选观察，未将 wx mock 或浏览器 adapter 冒充为平台实测；本次没有断言所有页面／牌局／视口都通过。

## 仍缺的验收

游客模式的 wx.login 返回工具模拟值；生产 /riichi/api/wechat/login 返回503，服务器没有正式微信配置。因此未创建生产测试牌桌，未验证真实微信身份、扫码、小程序上传或安卓真机，也未看到正式登录后的记分／多人荣和／统计与联机牌桌原生运行。联机入口横屏的工具结果不能代替安卓锁屏方向或拖牌、测量、飞牌、长牌河与结算滚动实机验证。

控制台显示的错误是上述微信登录503；游客 API 限制及工具资源预加载警告同时存在，不能写成“无错误全部通过”。合法域名检查在游客模式被工具跳过，不能用IP请求成功证明正式域名通过。

网页生产仍为3e1c657，两套业务服务未重启；没有读取、复制、下载或备份真实资料。下一步可以在独立本地合成身份后端上继续检查原生业务页面；此类身份适配只用于开发，不证明真实微信登录。
