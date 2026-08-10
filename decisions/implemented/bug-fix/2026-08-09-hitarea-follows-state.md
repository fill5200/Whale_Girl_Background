# Decision: 点击热区跟随当前状态——逐状态 bbox 取代全状态并集 + 首帧 bbox 修正

Status: implemented

## Problem

四轮问题。**第一轮**：热区由 `contentBox`（全部状态不透明像素并集）驱动，被宽幅状态撑到 88×97px。**第二轮**：改逐状态后仍「大片空白可点击」——`analyzeSheet` 扫描**整张 sheet**，多帧 sheet 把第 2..N 帧内容跨度计入 bbox（w=0.925），热区被撑到 sheet 全宽。**第三轮**：修 analyzeSheet 后仍「没有变化」——DOM 探针证实交互事件绑在 stage（110×110 全尺寸），hitarea 收窄后 stage 四周透明仍暴露可点。**第四轮（用户纠偏：左上角随宠物移动）**：改绑 hitarea 后仍「宠物左上角大片空白可点击」——**sprite 是 256px 布局盒，`transform: scale(0.43)` 仅视觉缩放，布局盒仍 256px 居中溢出 stage 73px/侧**；sprite 无 `pointer-events: none`，溢出区（角色左上角等）拦截事件。

## Decision

- **sprite 设 `pointer-events: none`**：视觉层（与 stage 一致）不拦事件——256px 溢出盒不再产生可点击区域，交互统一由 hitarea（贴合内容 bbox）承载。
- **交互统一由 hitarea 承载**：5 个 pointer 事件（down/move/up/cancel/lostpointercapture）从 stage 改绑 hitarea；stage 设 `pointer-events: none`。
- **热区逐状态 bbox**：`contentBox`（全局并集）替换为 `stateBoxes`（`Map<stateName, bbox>`）。
- **analyzeSheet 只取首帧**：离屏 canvas 只裁出帧 0 分析，bbox 以单帧为单位。
- **热区按内容实际位置对齐**：`offX = size * box.x`，flip 时镜像；flip 变化三处补 `applyHitArea()`。
- **cursor 移到 hitarea**；热区尺寸保留 `Math.max(40, ...)` 下限。
- 素材本身不动（0 边界会破坏「帧等宽同高 + background-position 切帧」契约，且 88% 内容占比给动画留呼吸空间）。

## Alternatives considered

**A：素材内容占比加大（88%→95%+）重切素材。** 收益有限——walk 的 55% 宽幅是动作帧横排的固有形态（不是透明边缘），加大占比只是把 61→64px；需重跑素材管线——弃。

**B：素材真 0 边界（裁透明后重排）。** 每帧裁边后帧不等宽，破坏「PNG 宽 = frames × 高度」契约与帧播放器（background-position 按等宽切）——需重构播放器为变宽帧，成本高风险大——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

## Consequences

- 交互统一由 hitarea（贴合内容 bbox）承载；sprite/stage 溢出区禁指针：模拟页验证角色左上角溢出区（-20,-20）→ HTML 无命中，热区中心可交互。walk 热区 101.7→61px。
- 每个状态自身的透明边缘（内容占比 88% 契约）仍让热区略大于角色轮廓——属预期（素材契约给动画留空间），非缺陷。
- 纯 client 改动：重装 + 刷新生效，无需重启 web。
