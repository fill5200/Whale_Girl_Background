// 宠物活动推导：纯函数，从任务快照列表派生 activity（零宿主依赖，可单测）。
// 契约：
// - tasks: [{ id, status }] 任务快照视图（Node half 负责收集 owned+unowned，见 index.mjs）。
// - known: Map<taskId, 上次状态>，跨调用保持的记账（宿主持有）。
// - wasWorking: 上次调用是否处于工作态（宿主持有）。
// - 返回 { working, burst, completed, failed, known, wasWorking }；burst 为 null 或
//   { name: 'celebrate'|'error', until }；completed/failed 是本次翻转的任务 id 列表
//   （宿主据此记账：完成 +XP、失败计数，零负反馈只积累不惩罚）。

export const BURST_MS = 6000

function betterBurst(a, b) {
  if (a === null) return b
  return b.until > a.until ? b : a
}

/**
 * 从任务快照推导活动状态。
 * @param {{ tasks: Array<{id: string, status: string}>, nowMs: number, known?: Map<string,string>, wasWorking?: boolean }} input
 */
export function deriveActivity({ tasks, nowMs, known = new Map(), wasWorking = false }) {
  // 任务列表为空时清空记账：无任务可跟踪，且 wasWorking 必为 false，无翻转可丢
  // （防长会话下 known 随历史任务 id 无限增长——内存泄漏）。
  if (tasks.length === 0) known.clear()
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'stopping')
  const working = running.length > 0
  let burst = null
  const completed = []
  const failed = []
  for (const t of tasks) {
    const prev = known.get(t.id)
    if (prev === 'running' && (t.status === 'completed' || t.status === 'killed')) {
      completed.push(t.id)
      burst = betterBurst(burst, { name: 'celebrate', until: nowMs + BURST_MS })
    } else if (prev === 'running' && t.status === 'failed') {
      failed.push(t.id)
      burst = betterBurst(burst, { name: 'error', until: nowMs + BURST_MS })
    }
    known.set(t.id, t.status)
  }
  // 任务从列表消失也视为完成（列表可能只保留活跃任务）。
  if (wasWorking && !working) {
    burst = betterBurst(burst, { name: 'celebrate', until: nowMs + BURST_MS })
  }
  // known 收缩到当前任务 id 集合：unowned 终态任务常驻列表时也不会线性增长
  // （仅 tasks 为空才 clear 挡不住"列表残留一条终态任务"的窗口）。
  if (tasks.length > 0) {
    const ids = new Set(tasks.map((t) => t.id))
    for (const key of known.keys()) if (!ids.has(key)) known.delete(key)
  }
  return { working, burst, completed, failed, known, wasWorking: working }
}
