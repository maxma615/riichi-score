# 结算与终局的水墨仪式（UI-only）

分支 `ui/majsoul-settlement-brush`。以雀魂结算的“关键瞬间必须醒目”为方向做的一轮
展示层打磨；不复制雀魂素材/音效/美术，不改计分、结算序列、Socket 载荷或既有
`data-testid`。线下与小程序端只做同语言的轻量同步。

## 改了什么

### 联机结算面板（`src/online/client/mahjong-settlement-panel.tsx` + `mahjong-calligraphy.css`）

- 所有阶段标题 `h2` 统一挂 `mahjong-settlement-panel__title`，按阶段着色：
  - 和牌（自摸／荣和，`__win-title`）：鎏金大字，字号上限 32→46px，描边与金色辉光加强。
  - 点数结算、流满贯：朱砂（vermillion #ff9d7d + 深朱描边 + 红辉光），新增 `is-nagashi` 修饰类。
  - 荒牌流局／途中流局：墨色宣纸（#d9e2df + 深墨描边），庄重的“收场”语气。
- 満貫以上的大牌新增一笔榜书“钤印”：`pointTierLabel()`（纯展示）按番数给出
  满贯／跳满／倍满／三倍满／役满（含 N倍役满），渲染为 `mahjong-settlement-panel__tier`
  大字（`is-yakuman` 时更大更亮），带一次性盖章动画 `mahjong-tier-stamp`。
  推导只使用引擎已保证的阈值：5番及以上任何符数都封顶对应基础点；13番以上按本桌
  固定开启的累计役满显示“役满”。合计行的 exact 番/符 不变。
- 流满贯的“满贯”标示（`data-testid="nagashi-mangan-title"`）改为同款朱砂榜书
  （新增 `mahjong-settlement-panel__mangan` 类，testid 保留）。
- 牌型点数 `__value b` 鎏金放大（23px → clamp(24–36px)），仍用表格数字保证滚动/对齐。
- 各席收支可读性：正收支金字 + 左侧金色内衬条，负收支墨青 + 左侧青灰内衬条；
  `is-scores` 大号滚动总分按正负染金/墨。数字、滚动步进、确认时序不变。
- 途中流局原因 `mahjong-draw-cause` 改为榜书墨字横幅；显示文本经 `mahjongTerm()`
  归一为简体（九種九牌→九种九牌等），与役名展示同一规则；引擎名与判定逻辑不动。
- 面板顶部加一条安静的金色发丝线；kicker、胜者名、等待状态文字对比度微调。

### 终局名次（`mahjong-final-ranking.tsx` 样式层）

- 标题「最终名次」整行榜书鎏金，「名次」朱砂；名次数字 `01…` 用榜书数字 + 金色。
- 第一名行金色内衬条 + 金字强调；本人行原有的金色标记保持优先。

### 字体与命名统一

- 新增 `public/online/assets/fonts/mahjong-brush-settlement.woff2`
  （`"Yougui Settlement Brush"`）：在冻结的声明子集之外补入
  `0-9 点数结算 最终名次 途中 荒 贯 倍 种`。仍由 SIL OFL 1.1 的 Ma Shan Zheng
  原字体（SHA-256 `6d2546bb…`，与 NOTICE 记录一致）用 pyftsubset 生成，不改字形。
  原 `mahjong-brush.woff2` 字节不变——`tests/online-mini-assets.test.js` 钉住了它的
  哈希，归档资源清单无需重建。
- 许可：`public/online/licenses/Ma-Shan-Zheng-Settlement-NOTICE.txt`（新增子集的
  来源/哈希/生成方式），OFL 全文沿用 `Ma-Shan-Zheng-OFL.txt`。未引入任何雀魂或
  未授权字体。
- 家族命名统一：删除 `theme.css` 里重复的 `MahjongBrush` @font-face（无人引用），
  `--font-brush` 统一指向 `"Yougui Settlement Brush", "Yougui Mahjong Brush", serif`；
  吃/碰/杠/立直等桌面声明继续用原 `"Yougui Mahjong Brush"`，不受影响。

### 线下 H5 与小程序（轻量同步）

- `public/style.css`：终局名次第一名行淡朱砂底 + 加粗；名次/净点/收支数字统一
  `font-variant-numeric: tabular-nums`。
- `miniprogram/pages/room/index.wxss`：同款第一名行强调与表格数字（纯 WXSS，
  不触碰 `sync:mini` 生成物与发布包结构）。

## 动效与 prefers-reduced-motion

- 新增动画只有 `mahjong-tier-stamp`（520ms 盖章）与既有金色/朱砂辉光的静态阴影；
  未加循环动画、未加滚动劫持。
- `prefers-reduced-motion: reduce` 下：显式 `animation: none`（本文件内），并且
  `table.css` 已有的全局 reduce 规则会把页内动画压到 0.01ms。盖章直接以成品姿态出现。
- 时序完全沿用 `settlement-presentation.ts` 的边界时钟；无新增常量、无自动确认变化。

## 验证

- `npm test`（Node 24）：node --test 188 通过、vitest 规则回归 187 通过（与本分支改动前一致）。
- 实测走查（Playwright chromium，844×390 手机横屏视口 + 真实规则引擎夹具）：
  - 自摸（天和役满）：标题自摸为鎏金榜书（`document.fonts` 确认两个子集均 loaded，
    computed family/color/size 逐项核对），合计行旁 40.95px 金色「役满」钤印为全面板最大字，
    48,000 点鎏金 36px，无遮挡/溢出。
  - 双荣和·点数结算阶段：标题朱砂榜书；正收支行金字 + 金色内衬条，负收支行墨青 +
    青灰内衬条，不变席中性；滚动总分按正负染金/墨青，可读性良好。
  - 九个夹具（立直/自摸/抜/碰/暗杠/加杠/吃/大明杠/双荣和）全部断言通过。
  - 本容器缺 webkit 系统库（libevent/libgst 系列等），webkit 引擎无法启动——视觉核验以
    chromium 为准；线上环境两种引擎由 CI 覆盖。
- CSS 顺序约束：`__win-title`（和牌金）必须排在通用 `__title`（流局墨）之后——两者特异性
  相同，靠源码顺序决胜；文件内已加注释钉住。
- 视觉走查建议：
  1. `npm run build && npm start`，打开 `http://127.0.0.1:3200/online/`，开一桌（可加电脑），
     打到任一和牌/流局，观察 标题→手牌/役→点数→各席收支 的层级与满贯以上盖章；
     打到终局看最终名次。
  2. 确定性回放：`npm run test:online:interactions`（真实规则引擎 + 两种浏览器，
     产物截图在 `.local/browser/online-interactions/`）。
  3. 移动端：Chrome DevTools 手机视口（横屏优先）；系统开启“减少动态效果”后复核
     盖章动画消失、内容立即可见。
- 字形覆盖自检：`python3 -c "from fontTools.ttLib import TTFont; print(''.join(sorted(map(chr,TTFont('public/online/assets/fonts/mahjong-brush-settlement.woff2').getBestCmap()))))"`。
