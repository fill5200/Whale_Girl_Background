// 宠物状态持久化：归一化与序列化（纯函数；文件 IO 在宿主 index.mjs）。
// 契约：normalizeState(saved) 合并 INITIAL_STATE 并对数值 clamp、按 xp 重算 level
// （容忍手改/旧版本越界与不一致），缺失/非法返回 null（宿主回退初始态）；
// serializeState 输出 JSON 文本。
import { INITIAL_STATE, levelFor } from './pet-state.mjs'

function clampNum(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NaN
}

/** 归一化保存的状态；非法输入返回 null。 */
export function normalizeState(saved) {
  if (typeof saved !== 'object' || saved === null) return null
  const hunger = clampNum(saved.hunger, 0, 100)
  const mood = clampNum(saved.mood, 0, 100)
  const xp = clampNum(saved.xp, 0, Number.MAX_SAFE_INTEGER)
  const updatedAt = typeof saved.updatedAt === 'number' && Number.isFinite(saved.updatedAt)
    ? saved.updatedAt
    : Date.now()
  if (![hunger, mood, xp].every(Number.isFinite)) return null
  // level 是 xp 的派生值：以 xp 为准重算，杜绝手改不一致。
  return { ...INITIAL_STATE, hunger, mood, xp, level: levelFor(xp), updatedAt }
}

/** 序列化状态为 JSON 文本。 */
export function serializeState(state) {
  return JSON.stringify(state)
}
