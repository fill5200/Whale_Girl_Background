// dsh-pet Node half：宠物状态机宿主。
// 契约：contributes.tools 与下方注册的工具逐名一致（缺失即启用失败回滚）；
// 路由路径与 client bundle 轮询地址一致（见 client/index.mjs 的 STATE_PATH/INTERACT_PATH）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { INITIAL_STATE, tick, feed, play } from './src/pet-state.mjs'

export const name = 'dsh-pet'
export const inject = ['httpServer', 'tools']

export const STATE_PATH = '/plugins/vlln/dsh-pet/state'
export const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'

/** 状态的一行摘要（工具输出与路由都复用）。 */
function describe(state) {
  return `宠物状态：饱食度 ${Math.round(100 - state.hunger)}%，心情 ${Math.round(state.mood)}，等级 ${state.level}（经验 ${state.xp}）`
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
  // 宿主时钟：任何读取/变更前先按流逝时间推进衰减。
  const snapshot = () => {
    state = tick(state, Date.now())
    return state
  }

  ctx.effect(() => {
    const disposers = [
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
            json(res, 200, { pet: snapshot() })
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
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-pet: tools + state/interact routes')
}
