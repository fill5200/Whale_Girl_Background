# Decision: 点击热区跟随当前状态——逐状态 bbox 取代全状态并集 + 首帧 bbox 修正

Status: implemented

## Problem

两轮问题。**第一轮**：热区由 `contentBox`（全部状态不透明像素并集）驱动，被宽幅状态撑到 88×97px。**第二轮（用户实测纠偏）**：改逐状态后仍「think 左侧大片空白可点击、flip 后仍在左侧」——headless 实测热区 101.7×96.2px（应 85.5px）。**真正根因**：`analyzeSheet` 扫描**整张 sheet** 的不透明像素范围——多帧 sheet（如 idle 768px 宽）把第 2..N 帧的内容跨度计入 bbox（w=0.925），热区被撑到接近 sheet 全宽（角色只在帧 0 位置，右侧大片空白）。flip 后角色镜像到右侧，但热区定位未镜像——错位仍在。

## Decision

- **热区逐状态 bbox**：`contentBox`（全局并集）替换为 `stateBoxes`（`Map<stateName, bbox>`）。
- **analyzeSheet 只取首帧**：离屏 canvas 只裁出帧 0 分析（`drawImage` 限定首帧区域），bbox 以单帧为单位——修复多帧 sheet 撑宽 bug。
- **热区按内容实际位置对齐**：`offX = size * box.x`（不再假设居中），flip 时镜像 `offX = size * (1 - box.x - box.w)`；flip 变化的三处（转身/行走方向/拖拽方向）补 `applyHitArea()`——热区与角色视觉严格同步。
- 素材本身不动（0 边界会破坏「帧等宽同高 + background-position 切帧」契约，且 88% 内容占比给动画留呼吸空间）。
- 热区尺寸保留 `Math.max(40, ...)` 下限（防止过小难点）。

## Alternatives considered

**A：素材内容占比加大（88%→95%+）重切素材。** 收益有限——walk 的 55% 宽幅是动作帧横排的固有形态（不是透明边缘），加大占比只是把 61→64px；需重跑素材管线——弃。

**B：素材真 0 边界（裁透明后重排）。** 每帧裁边后帧不等宽，破坏「PNG 宽 = frames × 高度」契约与帧播放器（background-position 按等宽切）——需重构播放器为变宽帧，成本高风险大——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

## Consequences

- 热区跟随状态 + 首帧 bbox + flip 镜像对齐：headless 实测 walk 热区从 101.7px（bug 撑宽）修正为 61px（内容实际 55% 宽），位置按内容对齐（left=24.9px=110×box.x）——「大片空白可点击」消除。
- 每个状态自身的透明边缘（内容占比 88% 契约）仍让热区略大于角色轮廓——属预期（素材契约给动画留空间），非缺陷。
- 纯 client 改动：重装 + 刷新生效，无需重启 web。
