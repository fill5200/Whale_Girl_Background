// dsh-pet Node half：积累型账本宿主 + assets 静态服务 + 活动/事件推导 + 状态持久化。
// 契约：contributes.tools 与下方注册的工具逐名一致（verify-contributes 门禁守护）；
// 路由路径与 client bundle 一致（见 client/index.mjs 的 STATE_PATH/INTERACT_PATH/ASSETS_URL）；
// activity 是派生字段，不写入账本（账本保持纯函数积累，见 src/pet-state.mjs）。
// 事件机制（v2，零负反馈）：任务完成 → 资历 +XP/称号/回忆 + celebrate；失败 → 只计数 +
// error(4s) → disappointed(6s) 瞬发（任务失败与请求错误同一负面窗口，总 10s）；新会话 → welcome；
// 工作态累加活跃时长。
// 安全：/interact 校验跨源（CSRF）；body 上限 1KB；assets 路径净化拒绝 `\` 段（Windows 穿越）。
// 持久化：状态存 <dshHome>/data/dsh-pet/state.json（.tmp + rename 原子写，1s 防抖，
// 事件记账时落盘；disable 时末次落盘）。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  INITIAL_STATE, titleName, recordTaskCompleted, recordFailure, recordSession, recordSessionResume, recordActive,
} from './src/pet-state.mjs'
import { deriveActivity, mergeCelebrate } from './src/activity.mjs'
import { sanitizeAssetPath, contentTypeFor, ASSETS_PATH } from './src/assets.mjs'
import { applyAction, isCrossOrigin } from './src/interact.mjs'
import { normalizeState, serializeState } from './src/persistence.mjs'
import { createSignals } from './src/signals.mjs'

export const name = 'dsh-pet'
export const inject = ['httpServer', 'tools', 'tasks', 'agents']

export const STATE_PATH = '/plugins/vlln/dsh-pet/state'
export const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'

/** /interact 请求体大小上限（动作只需几字节）。 */
export const BODY_LIMIT = 1024

/** 瞬发窗口：错误惊吓 4s → 失落尾 6s（总负面 10s，任务失败与请求错误统一）；欢迎 6s；庆祝 6s。 */
const ERROR_MS = 4000
const DISAPPOINTED_MS = 6000
const WELCOME_MS = 6000
// 庆祝窗口与 deriveActivity 的 BURST_MS 同长：事件路径（onTaskDone）与轮询路径
// （翻转检测）产出同一视觉窗口，两源取 max 不叠加延长。
const CELEBRATE_MS = 6000

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
  // 瞬发窗口（welcome > error > disappointed；celebrate 由任务派生——事件 + 轮询两源）。
  let errorUntil = 0
  let disappointedUntil = 0
  let welcomeUntil = 0
  let celebrateUntil = 0

  // ---- pet 服务信号（开放性窄缝，供其他插件 ctx.pet.onSignal 订阅）----
  // 账本信号：celebrate（任务完成/升级）、levelUp（升级）、failure（失败）、session（新会话/续接）。
  // 订阅者回调 (signal, payload)；订阅者异常隔离（不影响宠物本体）。
  const signals = createSignals()
  const emitSignal = signals.emit

  // 派生活动 + 事件记账（积累）：完成 +XP/称号/回忆；失败计数；工作态累加活跃时长。
  const activity = () => {
    const now = Date.now()
    const tasks = collectTasks(ctx)
    const derived = deriveActivity({ tasks, nowMs: now, known, wasWorking, errorMs: ERROR_MS })
    wasWorking = derived.wasWorking
    // 账本记账（+XP/失败计数/回忆）已迁入 ctx.tasks.onTaskDone 事件驱动——
    // 页面关闭/轮询缺席时任务终态不漏记；此处只保留展示（working/burst）与活跃时长。
    if (derived.working) {
      state = recordActive(state, now - lastActiveCheck, now).state
      scheduleSave()
    }
    lastActiveCheck = now
    // 任务失败与请求错误同一负面窗口：error(ERROR_MS) → disappointed(尾段 DISAPPOINTED_MS)。
    // 窗口取 max：同一窗口内多次失败/错误只延长不缩短（越挫越勇不因并发被吞）。
    if (derived.burst?.name === 'error') {
      errorUntil = Math.max(errorUntil, derived.burst.until)
      disappointedUntil = Math.max(disappointedUntil, derived.burst.until + DISAPPOINTED_MS)
    }
    // burst 级联：welcome > error > disappointed > celebrate > working > idle。
    // welcome 不打断进行中的 error/disappointed 尾段（失败失落不该被新会话欢迎盖掉）。
    // celebrate 双源同窗：轮询翻转（derived.burst）与事件记账（celebrateUntil，F3）
    // 由 mergeCelebrate 取 max——页面关闭期间完成的任务（轮询缺席）重开后同样庆祝；
    // error burst 优先，并发完成不盖掉失败。
    let name = derived.working ? 'working' : 'idle'
    let until = 0
    const burst = mergeCelebrate(derived.burst, celebrateUntil, now)
    if (burst !== null && burst.until > now) {
      name = burst.name
      until = burst.until
    }
    if (disappointedUntil > now) {
      name = 'disappointed'
      until = disappointedUntil
    }
    if (errorUntil > now) {
      name = 'error'
      until = errorUntil
    }
    if (welcomeUntil > now && errorUntil <= now && disappointedUntil <= now) {
      name = 'welcome'
      until = welcomeUntil
    }
    return { name, until }
  }

  ctx.effect(() => {
    const disposers = [
      // pet 服务（开放性窄缝）：只读快照 + 信号订阅。其他插件 inject ['pet']
      // 消费；服务缺席时消费方应容忍（dsh-pet 自己处理 sessions 缺席即先例）。
      // 不暴露任何写面（账本语义由 dsh-pet 独占，防第三方破坏积累不变量）。
      ctx.provide('pet', {
        snapshot: () => ({ pet: state, activity: activity() }),
        onSignal: (fn) => signals.subscribe(fn),
      }),
      // 事件驱动记账（F1）：任务终态恰回调一次，与浏览器轮询解耦——
      // GUI 关闭期间完成/失败的任务也入账（此前靠轮询观察 running 翻转，漏记窗口大）。
      // killed（用户取消）中性：不计 XP、不记失败、不写回忆（F4 语义）。
      ctx.tasks.onTaskDone((snapshot) => {
        const now = Date.now()
        if (snapshot.status === 'completed') {
          const result = recordTaskCompleted(state, snapshot.label ?? '未命名任务', now)
          state = result.state
          // F3：账本与庆祝同源——记账即开庆祝窗口。页面关闭期间完成任务（轮询缺席、
          // deriveActivity 看不到翻转）时，重开后首次轮询仍能看到本窗口，同样庆祝；
          // 与轮询翻转的 celebrate 取 max 不叠加（CELEBRATE_MS 同 BURST_MS）。
          celebrateUntil = Math.max(celebrateUntil, now + CELEBRATE_MS)
          scheduleSave()
          emitSignal('celebrate', { label: snapshot.label ?? '未命名任务', level: state.level })
          if (result.leveledUp) emitSignal('levelUp', { level: state.level })
        } else if (snapshot.status === 'failed') {
          state = recordFailure(state, now).state
          scheduleSave()
          emitSignal('failure', { level: state.level })
        }
      }),
      ctx.on('agent/request-error', () => {
        // 请求错误（LLM API 抖动，重试后可能成功）只触发 error/disappointed 情绪，
        // 不记入 stats.failures / 回忆——「任务失败」计数只认任务状态翻转（deriveActivity），
        // 避免一次坏任务多次请求错误刷出「越挫越勇」称号、回忆里出现虚假的「任务失败」。
        // 窗口与任务失败统一：error(ERROR_MS) → disappointed(尾段)。
        const now = Date.now()
        errorUntil = Math.max(errorUntil, now + ERROR_MS)
        disappointedUntil = Math.max(disappointedUntil, now + ERROR_MS + DISAPPOINTED_MS)
      }),
      ctx.on('agent/session-start', (payload) => {
        const now = Date.now()
        // source 区分新会话（startup）与续接/延续（resume/compact/clear）——XP 不同：
        // 新会话 +5 + 计数 + welcome；续接 +2 不计数不 welcome（避免切换即欢迎的噪音）。
        if (payload.source === 'startup') {
          state = recordSession(state, now).state
          welcomeUntil = now + WELCOME_MS
          emitSignal('session', { kind: 'new', level: state.level })
        } else {
          state = recordSessionResume(state, now).state
          emitSignal('session', { kind: 'resume', level: state.level })
        }
        scheduleSave()
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
          // render 消费 execute 的扁平返回（schema 扁平化的同一面）——不能用 describe(state)，
          // 后者期望 state 形状（state.titles.map/stats），对扁平对象抛 TypeError。
          render: (_args, value) => [{
            type: 'text',
            text: `资历 Lv.${value.level}（${value.xp} XP）· 完成 ${value.tasksDone} 个任务 · ${value.titles ? `称号「${value.titles}」` : '尚无称号'}`,
          }],
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
