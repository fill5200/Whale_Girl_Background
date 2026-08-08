// dsh-pet Node half：宠物状态机宿主 + assets 静态服务 + 活动状态推导。
// 契约：contributes.tools 与下方注册的工具逐名一致（verify-contributes 门禁守护）；
// 路由路径与 client bundle 一致（见 client/index.mjs 的 STATE_PATH/INTERACT_PATH/ASSETS_URL）；
// activity 是派生字段，不写入 pet-state（状态机保持纯函数）。
// 安全：/interact 校验跨源（CSRF）；body 上限 1KB；assets 路径净化拒绝 `\` 段（Windows 穿越）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { INITIAL_STATE, tick, feed, play } from './src/pet-state.mjs'
import { deriveActivity, mergeBurst, BURST_MS } from './src/activity.mjs'
import { sanitizeAssetPath, contentTypeFor, ASSETS_PATH } from './src/assets.mjs'
import { applyAction, isCrossOrigin } from './src/interact.mjs'

export const name = 'dsh-pet'
export const inject = ['httpServer', 'tools', 'tasks', 'agents']

export const STATE_PATH = '/plugins/vlln/dsh-pet/state'
export const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'

/** /interact 请求体大小上限（动作只需几字节）。 */
export const BODY_LIMIT = 1024

/** 状态的一行摘要（工具输出与路由都复用）。 */
function describe(state) {
  return `宠物状态：饱食度 ${Math.round(100 - state.hunger)}%，心情 ${Math.round(state.mood)}，等级 ${state.level}（经验 ${state.xp}）`
}

/** 收集宿主全部任务：owned（按 agent 遍历，绕过 owner fence）+ unowned，按 id 去重。 */
function collectTasks(ctx) {
  const tasks = ctx.tasks
  const seen = new Set()
  const out = []
  for (const agent of ctx.agents.list()) {
    for (const snapshot of tasks.list(agent)) {
      if (seen.has(snapshot.id)) continue
      seen.add(snapshot.id)
      out.push({ id: snapshot.id, status: snapshot.status })
    }
  }
  for (const snapshot of tasks.list()) {
    if (seen.has(snapshot.id)) continue
    seen.add(snapshot.id)
    out.push({ id: snapshot.id, status: snapshot.status })
  }
  return out
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra })
  res.end(JSON.stringify(body))
}

/** 读取请求体（超 BODY_LIMIT 返回 null，由调用方回 413）。 */
async function readBody(req, limit = BODY_LIMIT) {
  let data = ''
  for await (const chunk of req) {
    data += chunk
    if (data.length > limit) return null
  }
  return data
}

export function apply(ctx) {
  let state = { ...INITIAL_STATE, updatedAt: Date.now() }
  // 活动推导记账（跨轮询保持；与状态机分离，见 src/activity.mjs 契约）。
  const known = new Map()
  let wasWorking = false
  let errorUntil = 0
  // 宿主时钟：任何读取/变更前先按流逝时间推进衰减。
  const snapshot = () => {
    state = tick(state, Date.now())
    return state
  }
  // 派生活动：任务派生 burst + agent/request-error 事件 burst 合并。
  const activity = () => {
    const now = Date.now()
    const derived = deriveActivity({ tasks: collectTasks(ctx), nowMs: now, known, wasWorking })
    wasWorking = derived.wasWorking
    const eventBurst = errorUntil > now ? { name: 'error', until: errorUntil } : null
    const burst = mergeBurst(derived.burst, eventBurst)
    return { name: burst?.name ?? (derived.working ? 'working' : 'idle'), until: burst?.until ?? 0 }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('agent/request-error', () => {
        errorUntil = Date.now() + BURST_MS
      }),
      ctx.tools.register(defineTool({
        name: 'pet_feed',
        description: '喂食桌面宠物：降低饥饿、略升心情、获得经验。',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => {
          state = feed(snapshot(), Date.now())
          return describe(state)
        },
      })),
      ctx.tools.register(defineTool({
        name: 'pet_play',
        description: '陪桌面宠物玩耍：提升心情、略增饥饿（运动消耗）、获得经验。',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => {
          state = play(snapshot(), Date.now())
          return describe(state)
        },
      })),
      ctx.tools.register(defineTool({
        name: 'pet_status',
        description: '查看桌面宠物当前状态（饱食度/心情/等级/经验），喂食或玩耍前先查状态。',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            properties: {
              hunger: { type: 'number', description: '0=不饿，100=饿极' },
              mood: { type: 'number', description: '0=低落，100=开心' },
              level: { type: 'integer' },
              xp: { type: 'integer' },
            },
            required: ['hunger', 'mood', 'level', 'xp'],
          },
          render: (_args, value) => [{ type: 'text', text: describe(value) }],
        },
        execute: async () => snapshot(),
      })),
      ctx.httpServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              json(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
              return
            }
            // 轮询端点：禁缓存，防止启发式缓存读到冻结状态。
            json(res, 200, { pet: snapshot(), activity: activity() }, { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      ctx.httpServer.register({
        kind: 'exact',
        path: INTERACT_PATH,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
              return
            }
            // CSRF 面：跨源请求拒绝（恶意网页不能喂宠物/刷经验）。
            if (isCrossOrigin(req.headers, req.headers.host)) {
              json(res, 403, { error: 'cross-origin request rejected' })
              return
            }
            const raw = await readBody(req)
            if (raw === null) {
              json(res, 413, { error: 'request body too large' })
              return
            }
            let body
            try {
              body = JSON.parse(raw || '{}')
            } catch {
              json(res, 400, { error: 'invalid JSON body' })
              return
            }
            if (typeof body !== 'object' || body === null || Array.isArray(body)) {
              json(res, 400, { error: 'body must be a JSON object' })
              return
            }
            const result = applyAction(snapshot(), body.action, Date.now())
            if (result.status === 200) state = result.body.pet
            json(res, result.status, result.body, { 'cache-control': 'no-store' })
          } catch (error) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      ctx.httpServer.register({
        kind: 'prefix',
        path: ASSETS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          let pathname
          try {
            pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)
          } catch {
            res.writeHead(400)
            res.end()
            return
          }
          const rel = sanitizeAssetPath(pathname)
          if (rel === null) {
            res.writeHead(403)
            res.end()
            return
          }
          try {
            const data = readFileSync(join(import.meta.dirname, 'assets', rel))
            // no-cache：替换同名 sheet 后浏览器须重新校验，避免旧图。
            res.writeHead(200, { 'content-type': contentTypeFor(rel), 'cache-control': 'no-cache' })
            res.end(data)
          } catch {
            res.writeHead(404)
            res.end()
          }
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-pet: tools + state/interact routes + assets')
}
