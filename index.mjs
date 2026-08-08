// dsh-pet Node half：宠物状态机宿主 + assets 静态服务 + 活动状态推导。
// 契约：contributes.tools 与下方注册的工具逐名一致；路由路径与 client bundle 一致
// （见 client/index.mjs 的 STATE_PATH/INTERACT_PATH/ASSETS_URL）；activity 是派生字段，
// 不写入 pet-state（状态机保持纯函数）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { INITIAL_STATE, tick, feed, play } from './src/pet-state.mjs'
import { deriveActivity, mergeBurst, BURST_MS } from './src/activity.mjs'
import { sanitizeAssetPath, contentTypeFor, ASSETS_PATH } from './src/assets.mjs'

export const name = 'dsh-pet'
export const inject = ['httpServer', 'tools', 'tasks', 'agents']

export const STATE_PATH = '/plugins/vlln/dsh-pet/state'
export const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'

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

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  let data = ''
  for await (const chunk of req) data += chunk
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
      ctx.httpServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (_req, res) => {
          try {
            json(res, 200, { pet: snapshot(), activity: activity() })
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
              json(res, 405, { error: 'method not allowed; use POST' })
              return
            }
            const body = JSON.parse((await readBody(req)) || '{}')
            const action = body.action
            const now = Date.now()
            if (action === 'feed') state = feed(snapshot(), now)
            else if (action === 'play') state = play(snapshot(), now)
            else {
              json(res, 400, { error: `unknown action "${action}"; expected "feed" or "play"` })
              return
            }
            json(res, 200, { pet: state })
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
          const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)
          const rel = sanitizeAssetPath(pathname)
          if (rel === null) {
            res.writeHead(403)
            res.end()
            return
          }
          try {
            const data = readFileSync(join(import.meta.dirname, 'assets', rel))
            res.writeHead(200, { 'content-type': contentTypeFor(rel) })
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
