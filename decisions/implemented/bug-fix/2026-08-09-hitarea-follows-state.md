# Decision: 点击热区跟随当前状态——逐状态 bbox 取代全状态并集

Status: implemented

## Problem

用户反馈：宠物的可点击、操作边界太大，是否应把素材做成 0 边界。实测根因：热区由 `contentBox` 驱动——它是**全部 15 状态所有帧的不透明像素并集**（`mergeContentBox` 取并）。各状态内容占比差异大（walk 横向仅 55%、welcome 62%、idle/working 77-79%），并集被最宽幅状态（walk 横跨 21.9% 偏移 + 88% 宽）撑到 **88×97px（占 110px 舞台的 80%×88%）**——热区比多数状态的实际轮廓大一圈。

## Decision

- **热区改为逐状态 bbox**：`contentBox`（全局并集）替换为 `stateBoxes`（`Map<stateName, {x,y,w,h}>`），`preload`/`switchCharacter` 每状态独立记录。
- **热区跟随当前显示状态**：`setState` 时调用 `applyHitArea()`，取 `stateBoxes.get(animState)` 驱动热区——idle 时贴合 idle 轮廓、walk 时贴合 walk 轮廓（状态切换实时收窄/放宽）。
- 素材本身不动（0 边界会破坏「帧等宽同高 + background-position 切帧」契约，且 88% 内容占比给动画留呼吸空间）。
- 热区尺寸保留 `Math.max(40, ...)` 下限（防止过小难点）。

## Alternatives considered

**A：素材内容占比加大（88%→95%+）重切素材。** 收益有限——walk 的 55% 宽幅是动作帧横排的固有形态（不是透明边缘），加大占比只是把 61→64px；需重跑素材管线——弃。

**B：素材真 0 边界（裁透明后重排）。** 每帧裁边后帧不等宽，破坏「PNG 宽 = frames × 高度」契约与帧播放器（background-position 按等宽切）——需重构播放器为变宽帧，成本高风险大——弃。

**C：热区保留并集但缩小（乘系数）。** 无状态感知，walk 时仍偏大；且角色轮廓不规则，乘系数不可靠——弃。

## Consequences

- 热区跟随状态：walk 时 88→61px（55%）、welcome →69px、idle 保持 86px（该状态本身内容占比 78%）——「被宽幅状态撑大」的根因消除。
- 每个状态自身的透明边缘（内容占比 88% 契约）仍让热区略大于角色轮廓——属预期（素材契约给动画留空间），非缺陷。
- 纯 client 改动：重装 + 刷新生效，无需重启 web。
