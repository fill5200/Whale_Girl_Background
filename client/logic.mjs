// client 纯逻辑：动画状态选择与表情映射（无 DOM 引用，可脱离浏览器单测）。
// 契约：pickState 输入 { activity, pet, dragging, transient, sleeping, joyUntil, now }，
// 返回动画状态名；pet 不再驱动状态（零负反馈——无 hunger/mood 属性状态）。
// 状态优先级：drag > 瞬发 transient(eat/play/wake) > burst(welcome/celebrate/error/disappointed
// 窗口内) > working > joy(互动后短时) > sleep > idle。
// transient 由宿主计时（TRANSIENT_MS 超时兜底），本模块只做选择；burst 由 activity.until 窗口决定。

export const TRANSIENT_MS = 1500
export const JOY_MS = 1600

export const EMOJI = {
  idle: '🐣', working: '🤔', celebrate: '🎉', error: '😱', disappointed: '😞',
  joy: '🐥', eat: '😋', play: '🎾', drag: '😵', walk: '🚶', sleep: '💤', wake: '😪', welcome: '👋',
}

/** 选择当前应播放的动画状态名（now 显式传入，测试确定性）。 */
export function pickState({ activity, dragging, walking, transient, sleeping, joyUntil = 0, now = Date.now() }) {
  if (dragging) return 'drag'
  if (walking) return 'walk'
  if (transient !== null) return transient
  if (activity.name !== 'idle' && activity.name !== 'working' && activity.until > now) {
    return activity.name // welcome / celebrate / error / disappointed
  }
  if (activity.name === 'working') return 'working'
  if (now < joyUntil) return 'joy'
  if (sleeping) return 'sleep'
  return 'idle'
}
