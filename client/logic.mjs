// client 纯逻辑：动画状态选择与表情映射（无 DOM 引用，可脱离浏览器单测）。
// 契约：pickState 输入 { activity, pet, dragging, transient, sleeping, now }，返回动画状态名。
// 状态优先级：drag > 瞬发 transient > burst(celebrate/error) > working > sleep > hungry > sad > happy > idle。
// transient 由宿主计时（TRANSIENT_MS 超时兜底），本模块只做选择；burst 由 activity.until 窗口决定。

export const TRANSIENT_MS = 1500

export const EMOJI = {
  idle: '🐣', happy: '🐥', hungry: '🥺', sad: '😞', eat: '😋', play: '🎾',
  drag: '😵', sleep: '💤', working: '🤔', celebrate: '🎉', error: '😱',
}

/** 选择当前应播放的动画状态名（now 显式传入，测试确定性）。 */
export function pickState({ activity, pet, dragging, transient, sleeping, now = Date.now() }) {
  if (dragging) return 'drag'
  if (transient !== null) return transient
  if (activity.name === 'celebrate' && activity.until > now) return 'celebrate'
  if (activity.name === 'error' && activity.until > now) return 'error'
  if (activity.name === 'working') return 'working'
  if (sleeping) return 'sleep'
  if (pet && pet.hunger > 70) return 'hungry'
  if (pet && pet.mood < 30) return 'sad'
  if (pet && pet.mood >= 80 && pet.hunger < 40) return 'happy'
  return 'idle'
}
