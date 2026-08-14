# Decision: 网页端宠物渲染开关

Status: implemented

## Problem

桌面伴侣（dsh-desktop-pet，外部 HTTP 消费者）与网页端宠物并存时出现「两条大肥鱼」：同一 DSH profile 上同时渲染两个宠物。外部消费者无法卸载网页端宠物，用户也没有关闭入口。

## Decision

体验层配置项 `enabled`（默认 `true`，settings 可配，热生效）控制网页端 client 是否渲染宠物：

- client `apply()` 挂载后先取配置判定：`enabled: false` 时不启动任何计时器/轮询/SSE 并立即卸载；挂载期 host 隐藏，禁用时不闪一下再消失。
- 运行中热切换为 `false`（configRevision 变化 → `applyClientConfig`）立即卸载；重新启用需刷新页面（client 自渲染无重建路径）。配置缺失（旧 Node half）视为启用，向后兼容。
- Node half 端点（`/state` `/events` `/interact` `/config` `/assets`）不受影响——桌面伴侣等外部消费者照常读取账本与信号。

## Alternatives considered

**桌面伴侣启动时调用隐藏端点（如 `POST /visibility`）。** 有状态且崩溃恢复差：桌面进程被 kill 后网页端宠物永久隐藏直到再次显式恢复；多消费者并发语义复杂。配置开关无状态、持久化、崩溃安全。

**仅在桌面伴侣侧隐藏（不动 whale-girl）。** 网页端宠物对普通浏览器用户仍渲染，问题未根治；关闭入口属于 whale-girl 的能力面。

## Consequences

- 双宠物场景由用户显式关闭网页端宠物消除，设置持久化（settings 服务落盘）。
- `enabled` 是客户端渲染开关，不影响账本、信号与外部消费契约（`docs/external-consumers.md` 不变）。
- 重新启用需刷新页面——已知边界，记录于 config 注释与本文。
