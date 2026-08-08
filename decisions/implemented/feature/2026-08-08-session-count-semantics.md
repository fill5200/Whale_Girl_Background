# Decision: 会话计数语义——每次 agent 发布 vs 严格新会话

Status: proposed

## Problem

`agent/session-start` 在每次 agent publish 时发出（含 `publish('resume')` 续接旧会话与懒恢复）；dsh-pet 每次事件都 `recordSession` +5 XP + welcome（index.mjs）。因此 `stats.sessions` = 「会话活动/续接次数」而非「新会话数」：「广结善缘」（sessions≥10）在频繁续接下更快达成；回忆里「新会话开启（第 N 个）」可能对同一会话出现多次。当前语义未写入决策记录。

## Proposal

- **维持现状语义并明确写入决策记录**：session-start = 一次 agent 发布（含续接/恢复），+5 XP 是对「这次会话活动」的鼓励，「广结善缘」衡量会话活跃度而非严格新会话数。
- 产品若后续要「严格新会话数」，按 agent id 去重（agent id 与 session id 同轴，事件可按 agent 维度计数）——单独立项。

## Alternatives considered

**B：严格新会话（按 agent/session id 去重）。** 同一会话的多次 publish 只计 1 次。语义更贴近「新会话」，但需要识别会话身份并跨事件去重；resume 不 +5 XP 会降低续接体验的正反馈。

**C：时间窗去重（N 分钟内同 agent 多次 publish 计 1 次）。** 折中：抑制同一会话快速重建的重复计数，但阈值是魔数，语义仍不精确。

## Acceptance criteria

- 决策记录与 README 明确「会话 = 一次 agent 发布（含续接）」。
- 现有行为不变（无代码改动），仅文档化。

## Risks

- 若产品/用户期待「广结善缘」= 真实新会话数，现状会高估——文档化后由产品决定是否升级为方案 B。
