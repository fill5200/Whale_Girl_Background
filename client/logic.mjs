// client 纯逻辑：动画状态选择与表情映射（无 DOM 引用，可脱离浏览器单测）。
// 契约：pickState 输入 { activity, pet, dragging, transient, sleeping, joyUntil, now, sessionThink, sessionWait }，
// 返回动画状态名；pet 不再驱动状态（零负反馈——无 hunger/mood 属性状态）。
// 状态优先级由 STATE_TABLE 声明（顺序即优先级，文法单源——加状态/调优先级只改此表，
// 不再散落 if 链）；Node half 的窗口级联仍输出 { name, until }（burst 权威，两半分工：
// Node 出事实窗口、client 出本地交互选择）。
// drag/burst/transient 都是临时覆盖；窗口结束后重新计算底层派生状态，不硬编码回 idle。
// transient 由宿主计时（TRANSIENT_MS 超时兜底），本模块只做选择；burst 由 activity.until 窗口决定。
// 会话感知（P2 思考态）：sessionThink/sessionWait 由 host sessions 服务聚合（见 deriveSessionMood），
// 是持续陪伴底座——任一会话活跃时宠物保持清醒陪伴（覆盖 sleep/walk），低于用户互动与事件反馈。

export const TRANSIENT_MS = 1500
// wake 是从长时间休眠回来的过渡，不与短促的 eat/play 互动共用时长；
// 非循环 wake sheet 播完后保持末帧，直到 WAKE_MS 到期。
export const WAKE_MS = 3000
export const JOY_MS = 1600

export const EMOJI = {
  idle: '🐣', working: '🤔', celebrate: '🎉', error: '😱', disappointed: '😞',
  joy: '🐥', eat: '😋', play: '🎾', drag: '😵', walk: '🚶', sleep: '💤', wake: '😪', welcome: '👋',
  think: '💭', wait: '👀',
}

/**
 * 状态优先级表（文法单源）。行序即优先级：首行命中即返回。
 * - `when`：命中谓词（输入上下文）。
 * - `resolve`：命中时返回的状态名（多数恒等于 state；burst 需取 activity.name）。
 * 注意：状态名必须都在 EMOJI 表（verify-spec-states 门禁校验 spec 总表 ↔ EMOJI）。
 */
export const STATE_TABLE = [
  { state: 'drag', when: (c) => c.dragging },
  // 拖拽放下缓冲：drag 结束短暂回 idle（1.5s），再进入底层状态——避免放下即跳 think/working 的生硬切换。
  { state: 'idle', when: (c) => c.dragReleaseUntil > c.now },
  // 事件 burst（welcome/celebrate/error/disappointed）：Node half 窗口级联输出，until 有效期内优先。
  { state: 'burst', when: (c) => c.activity.name !== 'idle' && c.activity.name !== 'working' && c.activity.until > c.now, resolve: (c) => c.activity.name },
  { state: 'eat', when: (c) => c.transient === 'eat' },
  { state: 'play', when: (c) => c.transient === 'play' },
  { state: 'wake', when: (c) => c.transient === 'wake' },
  { state: 'wait', when: (c) => c.sessionWait },
  // 工作陪伴时间片：会话思考中且有任务跑时，think（沉思）与 working（托腮小灯泡）交替，
  // 避免一直 think 显得静态。workingSlice 由 pickState 按周期计算。
  { state: 'working', when: (c) => c.activity.name === 'working' && (c.workingSlice || !c.sessionThink) },
  { state: 'think', when: (c) => c.sessionThink },
  { state: 'joy', when: (c) => c.now < c.joyUntil },
  { state: 'sleep', when: (c) => c.sleeping },
  { state: 'walk', when: (c) => c.walking },
  { state: 'idle', when: () => true },
]

// working/think 交替周期：每 3s 切一次（working 2s / think 1s，working 为主表现）。
export const WORKING_SLICE_MS = 3000
export const WORKING_ACTIVE_MS = 2000

/** 选择当前应播放的动画状态名（now 显式传入，测试确定性；遍历 STATE_TABLE 首个命中）。 */
export function pickState(input) {
  const ctx = {
    ...input,
    now: input.now ?? Date.now(),
    joyUntil: input.joyUntil ?? 0,
    sessionThink: input.sessionThink ?? false,
    sessionWait: input.sessionWait ?? false,
    dragReleaseUntil: input.dragReleaseUntil ?? 0,
    // working/think 交替时间片：now 落在周期内的 working 活跃段则为 true。
    workingSlice: (input.now ?? Date.now()) % WORKING_SLICE_MS < WORKING_ACTIVE_MS,
  }
  for (const row of STATE_TABLE) {
    if (row.when(ctx)) return row.resolve ? row.resolve(ctx) : row.state
  }
  return 'idle'
}

/**
 * 从 host sessions 服务快照聚合「陪伴」信号（多会话：任一活跃会话都算——
 * 宠物陪伴整个 GUI，不只当前会话；当前会话由宿主 current 标出，消费方自行区分）。
 * 输入快照形状（host sessions 契约）：{ byId: { [id]: { displayTitle, running,
 * pendingInteraction, completed } }, current }。仅读字段，无副作用。
 * @returns {{ thinking: boolean, waiting: boolean, titles: string[] }} thinking=任一会话运行中；
 *   waiting=任一会话等待用户交互（approval/plan-review/question）；titles=运行中会话的展示标题。
 */
export function deriveSessionMood(snapshot) {
  const byId = snapshot?.byId ?? {}
  let thinking = false
  let waiting = false
  const titles = []
  for (const id of Object.keys(byId)) {
    const s = byId[id]
    if (s === undefined || s === null) continue
    if (s.running === true) {
      thinking = true
      titles.push(s.displayTitle ?? id)
    }
    if (s.pendingInteraction !== undefined) waiting = true
  }
  return { thinking, waiting, titles }
}
