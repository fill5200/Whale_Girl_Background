// 宠物状态机：纯函数、不可变更新、零宿主依赖（可脱离 dsh 单测）。
// 契约：
// - 状态字段：hunger（0=不饿，100=饿极）、mood（0=低落，100=开心）、level、xp、updatedAt（epoch ms）。
// - tick(state, nowMs) 按流逝时间推进衰减；feed/play 内部先吸收流逝衰减（传 stale 状态也安全，
//   宿主无需先 tick）；updatedAt 单调不减（时钟回拨时不倒退，恢复后不二次计数）。
// - 所有变更返回新对象，不改入参；数值一律 clamp 到 [0, 100]。

export const INITIAL_STATE = Object.freeze({
  hunger: 0,
  mood: 60,
  level: 1,
  xp: 0,
  updatedAt: 0,
})

// 衰减/增益常量：随流逝推进（饥饿每小时 +8，心情每小时 -2）。
const HUNGER_PER_HOUR = 8
const MOOD_DECAY_PER_HOUR = 2
const FEED_HUNGER_REDUCE = 35
const FEED_MOOD_GAIN = 5
const FEED_XP = 10
const PLAY_MOOD_GAIN = 25
const PLAY_HUNGER_COST = 8
const PLAY_XP = 15
const XP_PER_LEVEL = 100

function clamp(v, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, v))
}

/** 等级 = 1 + floor(xp / XP_PER_LEVEL)。 */
export function levelFor(xp) {
  return 1 + Math.floor(xp / XP_PER_LEVEL)
}

function applyXp(state, gain) {
  const xp = state.xp + gain
  return { ...state, xp, level: levelFor(xp) }
}

/** 按流逝毫秒推进衰减。updatedAt 单调不减（时钟回拨时保持原锚点）。 */
export function tick(state, nowMs) {
  const elapsed = Math.max(0, nowMs - state.updatedAt)
  const hours = elapsed / 3_600_000
  return {
    ...state,
    hunger: clamp(state.hunger + HUNGER_PER_HOUR * hours),
    mood: clamp(state.mood - MOOD_DECAY_PER_HOUR * hours),
    updatedAt: Math.max(state.updatedAt, nowMs),
  }
}

/** 喂食：先吸收流逝衰减，再降饥饿、升心情、加经验。 */
export function feed(state, nowMs) {
  const base = tick(state, nowMs)
  return applyXp(
    { ...base, hunger: clamp(base.hunger - FEED_HUNGER_REDUCE), mood: clamp(base.mood + FEED_MOOD_GAIN), updatedAt: nowMs },
    FEED_XP,
  )
}

/** 玩耍：先吸收流逝衰减，再升心情、略增饥饿（运动消耗）、加经验。 */
export function play(state, nowMs) {
  const base = tick(state, nowMs)
  return applyXp(
    { ...base, mood: clamp(base.mood + PLAY_MOOD_GAIN), hunger: clamp(base.hunger + PLAY_HUNGER_COST), updatedAt: nowMs },
    PLAY_XP,
  )
}
