# Decision: 朝向（flip）行为——动作间连续 + 静态态随机转身

Status: implemented

## Problem

素材本身无朝向（内容水平居中），朝向完全由 client `flip`（scaleX 翻转）表达。但现状 flip 只在两处写入：walk（随机左右）与 drag（按位移方向），且**只在 `showSprite` 时应用**——静态陪伴态（idle/think/wait）没有朝向概念：不会随机转身，且 flip 变化时若当前是静态态不会刷新 sprite（只有 walk/drag 恰好是当前状态时才重新 showSprite）。用户反馈：「所有图片实际上是有方向的，应该考虑动作间的朝向连续性、随机朝向转换」。

## Decision

- **动作间朝向连续**：flip 是模块级状态，walk/drag 的方向写入后，静态态（idle/think/wait）沿用其值渲染（setState 的 showSprite 读当前 flip）——不无谓跳回默认方向。
- **静态态随机转身**：新增纯函数 `nextFacingAt({ now, random })`（间隔 10-25s，L2 语义层代码级）决策转身时刻；tick 里静态态（idle/think/wait）到点时 `flip = -flip` 并 `applyFacing()` 刷新当前 sprite transform（不动帧/背景）；离开静态态清排程（walk/drag/burst/transient 方向由各自行为主导，不随机转）。
- **`applyFacing` 刷新封装**：复用 showSprite 的 scale 计算，只更新 transform——静态态转身不需要重建 sprite。
- 沿用 v3/v4 纪律：随机决策在纯函数（注入随机源、可单测），index.mjs 薄执行。

## Alternatives considered

**A：素材层面画朝向（多方向图集）。** 素材内容居中且 AI 生图已成本高（每状态每方向重复生成），flip 是零成本方案；且 walk/drag 已用 flip 表达方向——弃。

**B：静态态不转身，只保持 walk/drag 方向。** 满足连续性但不满足「随机朝向转换」——宠物长时间面朝一个方向不自然（真实宠物会东张西望）——弃。

**C：转身做成独立动画状态（turn）。** 需要新增素材（转身中间帧）、manifest 条目、spec 总表——成本高；flip 翻转本身已是「转身」视觉（sprite 镜像），无需中间帧——弃。

## Consequences

- 朝向连续：walk 朝左停下 → idle/think 保持朝左；drag 方向延续。
- 静态态随机转身（10-25s），宠物不再长时间固定朝向。
- 测试：新增 `nextFacingAt` 确定性测试（注入随机源，区间边界）；单测 102 条全绿，14 门禁全过。
- 纯 client 改动：重装 + 刷新生效，无需重启 web。
