// client 纯逻辑：动画状态选择与表情映射（无 DOM 引用，可脱离浏览器单测）。
// 契约：pickState 输入 { activity, pet, dragging, transient, sleeping, joyUntil, now, sessionThink, sessionWait }，
// 返回动画状态名；pet 不再驱动状态（零负反馈——无 hunger/mood 属性状态）。
// 状态优先级：drag > 事件 burst > 用户互动 eat/play > wake > 等待批准 wait > 会话思考陪伴 think
//           > working > joy > sleep > walk > idle。
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

/** 选择当前应播放的动画状态名（now 显式传入，测试确定性）。 */
export function pickState({ activity, dragging, walking, transient, sleeping, joyUntil = 0, now = Date.now(), sessionThink = false, sessionWait = false }) {
  if (dragging) return 'drag'
  if (activity.name !== 'idle' && activity.name !== 'working' && activity.until > now) {
    return activity.name // welcome / celebrate / error / disappointed
  }
  if (transient === 'eat' || transient === 'play') return transient
  if (transient === 'wake') return 'wake'
  if (sessionWait) return 'wait'
  if (sessionThink) return 'think'
  if (activity.name === 'working') return 'working'
  if (now < joyUntil) return 'joy'
  if (sleeping) return 'sleep'
  if (walking) return 'walk'
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
