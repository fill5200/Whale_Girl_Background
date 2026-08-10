# Decision: 点击热区跟随当前状态——逐状态 bbox 取代全状态并集 + 首帧 bbox 修正

Status: implemented

## Problem

三轮问题。**第一轮**：热区由 `contentBox`（全部状态不透明像素并集）驱动，被宽幅状态撑到 88×97px。**第二轮**：改逐状态后仍「think 左侧大片空白可点击、flip 后仍在左侧」——`analyzeSheet` 扫描**整张 sheet**，多帧 sheet（idle 768px 宽）把第 2..N 帧内容跨度计入 bbox（w=0.925），热区被撑到 sheet 全宽（101.7px 实测）。**第三轮（用户纠偏：怀疑非素材按钮/消息框）**：修 analyzeSheet 后用户仍「没有变化」——DOM 探针（模拟页 elementFromPoint）证实：**交互事件绑在 stage（110×110 全尺寸），hitarea 收窄到内容区后 stage 的四周透明仍暴露且可点**（宿主左缘+5px → pet-stage，且 stage 有 pointerdown 监听触发拖拽/菜单）——「大片空白可点击」的真实来源是 stage 全尺寸承载交互，而非素材。

## Decision

- **交互统一由 hitarea 承载**：5 个 pointer 事件（down/move/up/cancel/lostpointercapture）从 stage 改绑 hitarea；stage 设 `pointer-events: none`（纯视觉层，不再拦事件）——点击只在内容 bbox 内触发拖拽/互动，四周透明完全不可点。
- **热区逐状态 bbox**：`contentBox`（全局并集）替换为 `stateBoxes`（`Map<stateName, bbox>`）。
- **analyzeSheet 只取首帧**：离屏 canvas 只裁出帧 0 分析，bbox 以单帧为单位——修复多帧 sheet 撑宽 bug。
- **热区按内容实际位置对齐**：`offX = size * box.x`，flip 时镜像 `offX = size * (1 - box.x - box.w)`；flip 变化三处（转身/行走/拖拽）补 `applyHitArea()`。
- **cursor 移到 hitarea**：host 不再显示 grab 光标（避免空白区 hover 误导），仅内容区显示可交互光标。
- 素材本身不动（0 边界会破坏「帧等宽同高 + background-position 切帧」契约，且 88% 内容占比给动画留呼吸空间）。
- 热区尺寸保留 `Math.max(40, ...)` 下限。

## Alternatives considered

**A：素材内容占比加大（88%→95%+）重切素材。** 收益有限——walk 的 55% 宽幅是动作帧横排的固有形态（不是透明边缘），加大占比只是把 61→64px；需重跑素材管线——弃。

**B：素材真 0 边界（裁透明后重排）。** 每帧裁边后帧不等宽，破坏「PNG 宽 = frames × 高度」契约与帧播放器（background-position 按等宽切）——需重构播放器为变宽帧，成本高风险大——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

## Consequences

- 交互统一由 hitarea（贴合内容 bbox）承载：headless 实测宿主左缘+5px → stage（旧）→ DIV 无监听（新，点击无响应）；hitarea 85.5×96.25px 正确收窄。walk 热区 101.7→61px。
- 每个状态自身的透明边缘（内容占比 88% 契约）仍让热区略大于角色轮廓——属预期（素材契约给动画留空间），非缺陷。
- 纯 client 改动：重装 + 刷新生效，无需重启 web。
