// /interact 路由的纯逻辑：动作分发与跨源校验（无宿主依赖，可单测）。
// 契约：applyAction 输入 (state, action, nowMs)，返回 { status, body }，错误码语义集中于此；
// isCrossOrigin 输入 (headers, host)，Sec-Fetch-Site 优先、其次 Origin，都缺省视为同源。
import { feed, play } from './pet-state.mjs'

/** 按动作转移状态。 */
export function applyAction(state, action, nowMs) {
  if (action === 'feed') return { status: 200, body: { pet: feed(state, nowMs) } }
  if (action === 'play') return { status: 200, body: { pet: play(state, nowMs) } }
  return { status: 400, body: { error: `unknown action "${action}"; expected "feed" or "play"` } }
}

/** 跨源判定（CSRF 面）：返回 true 表示跨源（应拒绝）。 */
export function isCrossOrigin(headers, host) {
  const site = headers['sec-fetch-site']
  if (site !== undefined) return site !== 'same-origin' && site !== 'none'
  const origin = headers['origin']
  if (origin !== undefined) {
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }
  return false
}
