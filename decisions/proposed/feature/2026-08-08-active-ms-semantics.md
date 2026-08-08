# Decision: activeMs（活跃时长）语义——观察窗口 vs 真实工作时长

Status: proposed

## Problem

`recordActive` 只在「/state 轮询观察到 working 态」时累加 `now - lastActiveCheck`（index.mjs），产生两个失真方向：① GUI 关闭/禁用期间任务运行不计——「常驻伙伴」（activeMs≥6h）实际要求"页面打开 + 有任务运行"约 6h 的观察窗口；② 页面开着、任务跑过夜、机器睡眠 → 唤醒后首轮 poll 把整段睡眠时长一次计入（「常驻伙伴」可一夜刷出）。当前语义未写入任何决策记录。

## Proposal

- **语义定为「陪伴观察时长」**：宠物是陪伴角色，activeMs = 宠物在场（页面轮询）观察到的协作时长——写入决策记录，与「积累型/零负反馈」产品定位一致。
- **加睡眠恢复护栏**：单次累加封顶一个轮询间隔的合理倍数（如 `MIN(now - lastActiveCheck, 5min)`），防机器睡眠后一次计入整段睡眠。
- 不做真实工作时长（见备选方案 B）。

## Alternatives considered

**B：真实工作时长（基于任务 startedAt/finishedAt 补算）。** 需要 Node half 自主跟踪每任务耗时（onTaskDone 已有终态快照，可记录每任务 duration 累加），绕过轮询。代价：语义从「陪伴」变「任务耗时」，与零负反馈的伙伴定位偏离；且任务并行/失败/取消的耗时语义复杂。产品明确要「真实工作时长」时再做。

**C：现状不改。** 观察窗口语义未声明 + 睡眠计满的副作用并存——「常驻伙伴」可被一夜睡眠刷出，属于明确缺陷，需至少加护栏。

## Acceptance criteria

- 机器睡眠 >1h 后唤醒，首轮 poll 的 activeMs 单次增量 ≤ 5 分钟。
- 决策记录明确「陪伴观察时长」语义；README/sprites-spec 的称号说明同步。

## Risks

- 观察窗口语义下，关闭 GUI 期间的工作时长不计——若产品期望「关闭也陪伴」，需升级为 Node half 自主跟踪（方案 B 的变体）。
