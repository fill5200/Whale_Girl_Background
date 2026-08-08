// dsh-pet Node half：积累型账本宿主 + assets 静态服务 + 活动/事件推导 + 状态持久化。
// 契约：contributes.tools 与下方注册的工具逐名一致（verify-contributes 门禁守护）；
// 路由路径与 client bundle 一致（见 client/index.mjs 的 STATE_PATH/INTERACT_PATH/ASSETS_URL）；
// activity 是派生字段，不写入账本（账本保持纯函数积累，见 src/pet-state.mjs）。
// 事件机制（v2，零负反馈）：任务完成 → 资历 +XP/称号/回忆 + celebrate；失败 → 只计数 +
// error(4s) → disappointed(12s) 瞬发；新会话 → welcome；工作态累加活跃时长。
// 安全：/interact 校验跨源（CSRF）；body 上限 1KB；assets 路径净化拒绝 `\` 段（Windows 穿越）。
// 持久化：状态存 <dshHome>/data/dsh-pet/state.json（.tmp + rename 原子写，1s 防抖，
// 事件记账时落盘；disable 时末次落盘）。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  INITIAL_STATE, titleName, recordTaskCompleted, recordFailure, recordSession, recordActive, describe,
} from './src/pet-state.mjs'
import { deriveActivity } from './src/activity.mjs'
import { sanitizeAssetPath, contentTypeFor, ASSETS_PATH } from './src/assets.mjs'
import { applyAction, isCrossOrigin } from './src/interact.mjs'
import { normalizeState, serializeState } from './src/persistence.mjs'

export const name = 'dsh-pet'
export const inject = ['httpServer', 'tools', 'tasks', 'agents']

export const STATE_PATH = '/plugins/vlln/dsh-pet/state'
export const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'

/** /interact 请求体大小上限（动作只需几字节）。 */
export const BODY_LIMIT = 1024

/** 瞬发窗口：错误惊吓 4s → 失落尾 12s；欢迎 6s。 */
const ERROR_MS = 4000
const DISAPPOINTED_MS = 12000
const WELCOME_MS = 6000

/** 状态文件：<dshHome>/data/dsh-pet/state.json（不放插件目录——uninstall 会删）。 */
const DSH_HOME = process.env.DSH_HOME ?? resolve(import.meta.dirname, '../../..')
const STATE_FILE = join(DSH_HOME, 'data', 'dsh-pet', 'state.json')

/** 读取并归一化已保存状态；缺失/损坏返回 null。 */
function loadState() {
  try {
    return normalizeState(JSON.parse(readFileSync(STATE_FILE, 'utf8')))
  } catch {
    return null
  }
}

/** 原子写：同目录 .tmp + rename；失败不阻塞插件（状态仅本次运行有效）。 */
function saveState(next) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    const tmp = `${STATE_FILE}.tmp`
    writeFileSync(tmp, serializeState(next))
    renameSync(tmp, STATE_FILE)
  } catch {
    // 持久化失败不阻塞插件：状态仅本次运行内有效。
  }
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
      out.push({ id: snapshot.id, status: snapshot.status, label: snapshot.label })
    }
  }
  for (const snapshot of tasks.list()) {
    if (seen.has(snapshot.id)) continue
    seen.add(snapshot.id)
    out.push({ id: snapshot.id, status: snapshot.status, label: snapshot.label })
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
  let state = loadState() ?? { ...INITIAL_STATE, updatedAt: Date.now() }
  // 落盘防抖：事件记账时触发（任务完成/失败/会话/活跃时长）。
  let saveTimer = null
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveState(state), 1000)
  }
  // 活动推导记账（跨轮询保持；与账本分离，见 src/activity.mjs 契约）。
  const known = new Map()
  let wasWorking = false
  let lastActiveCheck = Date.now()
  // 瞬发窗口（welcome > error > disappointed；celebrate 由任务派生）。
  let errorUntil = 0
  let disappointedUntil = 0
  let welcomeUntil = 0

  // 派生活动 + 事件记账（积累）：完成 +XP/称号/回忆；失败计数；工作态累加活跃时长。
  const activity = () => {
    const now = Date.now()
    const tasks = collectTasks(ctx)
    const derived = deriveActivity({ tasks, nowMs: now, known, wasWorking })
    wasWorking = derived.wasWorking
    for (const id of derived.completed) {
      // 回忆用任务 label（非原始 id——UUID 截断无意义）；缺 label 用通用占位。
      const label = tasks.find((t) => t.id === id)?.label
      state = recordTaskCompleted(state, label ?? '未命名任务', now).state
      scheduleSave()
    }
    for (const id of derived.failed) {
      state = recordFailure(state, now).state
      scheduleSave()
    }
    if (derived.working) {
      state = recordActive(state, now - lastActiveCheck, now).state
      scheduleSave()
    }
    lastActiveCheck = now
    // burst 级联：welcome > error > disappointed > celebrate > working > idle。
    let name = derived.working ? 'working' : 'idle'
    let until = 0
    if (derived.burst !== null && derived.burst.until > now) {
      name = derived.burst.name
      until = derived.burst.until
    }
    if (disappointedUntil > now) {
      name = 'disappointed'
      until = disappointedUntil
    }
    if (errorUntil > now) {
      name = 'error'
      until = errorUntil
    }
    if (welcomeUntil > now) {
      name = 'welcome'
      until = welcomeUntil
    }
    return { name, until }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('agent/request-error', () => {
        const now = Date.now()
        state = recordFailure(state, now).state
        scheduleSave()
        errorUntil = now + ERROR_MS
        disappointedUntil = now + DISAPPOINTED_MS
      }),
      ctx.on('agent/session-start', () => {
        const now = Date.now()
        state = recordSession(state, now).state
        scheduleSave()
        welcomeUntil = now + WELCOME_MS
      }),
      ctx.tools.register(defineTool({
        name: 'pet_feed',
        description: '投喂桌面宠物（社交娱乐）：纯乐趣互动，宠物会回话，不影响资历。',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => applyAction(state, 'feed').body.reply,
      })),
      ctx.tools.register(defineTool({
        name: 'pet_play',
        description: '陪桌面宠物玩耍（社交娱乐）：纯乐趣互动，宠物会回话，不影响资历。',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => applyAction(state, 'play').body.reply,
      })),
      ctx.tools.register(defineTool({
        name: 'pet_status',
        description: '查看桌面宠物的资历（等级/经验/任务数/称号/最近共同回忆）。',
        parameters: {},
        output: {
          // 注意：value-schema DSL 不支持 required 数组与数组类型；object 必须显式声明
          // additionalProperties；这里全部扁平化为原始类型字段（见 verify-tool-schemas 门禁）。
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              level: { type: 'integer', description: '资历等级' },
              xp: { type: 'integer', description: '累计资历经验' },
              tasksDone: { type: 'integer', description: '完成的任务数' },
              failures: { type: 'integer', description: '失败的任务数' },
              sessions: { type: 'integer', description: '开启的会话数' },
              activeMs: { type: 'integer', description: '累计活跃毫秒' },
              titles: { type: 'string', description: '已解锁称号（顿号分隔）' },
              memory: { type: 'string', description: '最近共同事件（换行分隔）' },
            },
          },
          render: (_args, value) => [{ type: 'text', text: describe(value) }],
        },
        execute: async () => ({
          level: state.level,
          xp: state.xp,
          tasksDone: state.stats.tasksDone,
          failures: state.stats.failures,
          sessions: state.stats.sessions,
          activeMs: state.stats.activeMs,
          titles: state.titles.map(titleName).join('、') || '无',
          memory: state.memory.join('\n') || '还没有共同回忆',
        }),
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
            // 先跑 activity()（有记账副作用），再读 state——响应里的 pet 才是记账后的值。
            const act = activity()
            json(res, 200, { pet: state, activity: act }, { 'cache-control': 'no-store' })
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
            // CSRF 面：跨源请求拒绝（恶意网页不能喂宠物/刷互动）。
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
            const result = applyAction(state, body.action)
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
      clearTimeout(saveTimer)
      saveState(state) // 末次落盘：disable/卸载前保留最终状态
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-pet: tools + state/interact routes + assets')
}
