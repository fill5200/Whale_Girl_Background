# Decision: DSH 全屏背景图（导入/还原/透明度）

Status: implemented

## Problem

用户希望鲸鱼娘插件提供一个改变 DSH Web GUI 背景图片的能力：还原默认、导入图片，导入后
可调节透明度——透明度 100% 时显示默认背景，0% 时显示完整图片背景。入口排在点击鲸鱼娘
弹出的菜单（喂食/玩耍/换角色）之后。

## Decision

**纯客户端实现**（`lib/client/index.mjs`），不新增 Node half 端点、不改设置 schema、不改
积累账本：背景是显示层偏好，归 client 自管（与角色选择/窗口位置同一 localStorage 模式）。

- **菜单入口**：在 `menu.append(feedBtn, playBtn, roleBtn)` 后追加「🖼️ 背景」按钮；点击
  toggle 一个背景面板（沿用 `PANEL_THEME` 基调 + 内联样式），含「📁 导入图片」「↩️ 还原
  默认」与透明度滑条（0–100）。
- **背景层**：全屏 `position: fixed; inset: 0; z-index: -1; pointer-events: none` 的 div，
  `background-image: url(dataURL)` + `background-size: cover` 居中；`opacity = (100 - 透明度)/100`。
- **压过默认底色**：DSH 主框架背景是 `--dsw-alias-bg-base`、侧边栏是 `--dsw-specific-sidebar-fill`，
  默认不透明会遮住 z-index:-1 的背景层。故启用图片且透明度 <100 时把这两个变量覆盖为
  `transparent`；透明度 =100（或未导入）时 `removeProperty` 恢复默认背景——「100% = 默认
  背景」不是露白底，而是真恢复主题变量。
- **主题变化兜底**：主题服务（dsh-client-ui-layout ThemePresenter）在 theme/change 时会
  `removeProperty` 后重写 body 内联 token，覆盖会被清掉。用 `MutationObserver` 观察
  `body` 的 `style` 属性，值非预期时重新覆盖（值相同不重设，防观察-设置循环）。
- **导入压缩**：隐藏 `<input type=file accept="image/*">` → FileReader → canvas 缩放
  （最长边 ≤1600px、JPEG 0.85，控制 localStorage 体积）。
- **持久化**：localStorage `whale-girl:background` = `{ dataUrl, transparency }`；还原默认
  即删除该 key。
- **清理**：dispose() 断开 observer、移除背景层/面板/文件输入、恢复主题变量，与既有卸载路径一致。
- **菜单联动**：菜单关闭（toggleMenu(false)）时同步收起背景面板，防残留浮层。

## Alternatives considered

**Node half 存图 + 新端点（/whale-girl/background）供客户端拉取。** 图片可存磁盘、不限
localStorage 大小；但要改 Node half（路由/读写/CSRF/上限面）与 settings schema，且背景图
是单机显示层偏好，跨浏览器同步无意义。客户端 localStorage 更贴合现有模式，弃用。

**覆盖 body 的 background-image 而非 z-index:-1 图层。** body 背景会被 frame（position:
relative、自带 `background: var(--dsw-alias-bg-base)`）遮住，仍需改主题变量；且透明度控制
需要独立 opacity，图层方案更直接。弃用。

**直接改 --dsw-alias-bg-base 为图片色/半透明。** 变量是颜色 token，不能承载图片；且语义
层（主题）与显示层（图片）不该耦合。弃用。

## Consequences

- 背景功能纯客户端，Node half、积累账本、settings、外部消费者契约（/state /events
  /interact /presence /config /assets）全部不受影响。
- 透明度过中值时 frame/侧边栏底色被透明化，露出的是背景层图片（半透明时与 DSH 自身
  底色混叠）；透明度 100% 时主题变量恢复，与「默认背景」语义一致。
- 图片存 localStorage，单浏览器生效；清浏览器数据或换浏览器会重置（预期内，与角色/位置一致）。
- 客户端源码改动必须重新生成 `lib/client.js`（`node scripts/build-client.mjs`），构建产物
  已随本分支提交，安装即用。
