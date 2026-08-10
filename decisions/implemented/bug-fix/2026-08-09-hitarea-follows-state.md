# Decision: 点击热区跟随当前状态——逐状态 bbox 取代全状态并集 + 首帧 bbox 修正

Status: implemented

## Problem

五轮问题。**第一轮**：热区由 `contentBox`（全部状态不透明像素并集）驱动，被宽幅状态撑到 88×97px。**第二轮**：改逐状态后仍「大片空白可点击」——`analyzeSheet` 扫描**整张 sheet**，多帧 sheet 把第 2..N 帧内容跨度计入 bbox（w=0.925），热区被撑到 sheet 全宽。**第三轮**：修 analyzeSheet 后仍「没有变化」——DOM 探针证实交互事件绑在 stage（110×110 全尺寸），hitarea 收窄后 stage 四周透明仍暴露可点。**第四轮**：改绑 hitarea 后仍「宠物左上角大片空白可点击」——sprite 是 256px 布局盒 transform 仅视觉缩放，溢出 stage 73px/侧，sprite 无 `pointer-events: none` 拦截事件。**第五轮（用户反馈：整个 pet 无交互点）**：CDP 真实浏览器实测——hitarea computed `position: static`、`z-index: auto`、`cursor: auto`——**`.pet-hitarea` 的 CSS 类规则全部失效**（宿主清理/覆盖注入的 style 标签，同 status/menu 已知问题，但 hitarea 未做 JS 内联），hitarea 掉出文档流（宿主下方 110px），整个 pet 无交互点。

## Decision

- **hitarea 关键样式 JS 内联**：`position: absolute; cursor: grab; touch-action: none; z-index: 3` 在创建时内联（不依赖 CSS 注入——宿主环境可能覆盖/清理 style 标签，与 status/menu 同款规避）；尺寸/定位由 applyHitArea 更新。
- **sprite 设 `pointer-events: none`**：256px 溢出盒不再产生可点击区域。
- **交互统一由 hitarea 承载**：5 个 pointer 事件从 stage 改绑 hitarea；stage 设 `pointer-events: none`。
- **热区逐状态 bbox** + **analyzeSheet 只取首帧** + **热区按内容实际位置对齐（flip 镜像）** + **cursor 移到 hitarea**。
- 素材本身不动（0 边界会破坏「帧等宽同高 + background-position 切帧」契约，且 88% 内容占比给动画留呼吸空间）。
- 热区尺寸保留 `Math.max(40, ...)` 下限。

## Alternatives considered

**A：素材内容占比加大（88%→95%+）重切素材。** 收益有限——walk 的 55% 宽幅是动作帧横排的固有形态（不是透明边缘），加大占比只是把 61→64px；需重跑素材管线——弃。

**B：素材真 0 边界（裁透明后重排）。** 每帧裁边后帧不等宽，破坏「PNG 宽 = frames × 高度」契约与帧播放器（background-position 按等宽切）——需重构播放器为变宽帧，成本高风险大——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

## Consequences

- 交互统一由 hitarea（贴合内容 bbox，关键样式 JS 内联防宿主清理）承载：CDP 真实浏览器实测热区中心命中 hitarea、点击触发；walk 热区 101.7→61px。
- 教训：CSS 注入的 style 标签可能被宿主覆盖/清理——所有承载交互的元素（status/menu/hitarea）关键样式必须 JS 内联，不能只靠 CSS 类。
- 每个状态自身的透明边缘（内容占比 88% 契约）仍让热区略大于角色轮廓——属预期（素材契约给动画留空间），非缺陷。
- 纯 client 改动：重装 + 刷新生效，无需重启 web。
