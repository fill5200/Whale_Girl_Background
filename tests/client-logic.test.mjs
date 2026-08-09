// client 纯逻辑单测（node:test）。归属：client/logic.mjs 的行为改动跑本文件。
// v2：零负反馈——无 hunger/mood 属性状态；情绪只由事件瞬发 + 互动喜悦。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickState, TRANSIENT_MS, WAKE_MS, JOY_MS, EMOJI, deriveSessionMood, STATE_TABLE } from '../client/logic.mjs'

const IDLE = { activity: { name: 'idle', until: 0 }, dragging: false, transient: null, sleeping: false, joyUntil: 0, now: 1000 }

test('拖拽优先于一切', () => {
  assert.equal(pickState({ ...IDLE, dragging: true, transient: 'eat' }), 'drag')
})

test('临时状态结束后回到当前底层状态', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 }, transient: 'wake' }), 'wake')
  assert.equal(pickState({ ...IDLE, activity: { name: 'celebrate', until: 5000 }, transient: 'wake' }), 'celebrate')
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 }, transient: null }), 'working')
  assert.equal(pickState({ ...IDLE, transient: null, sleeping: true }), 'sleep')
})

test('walk 游走只在无事件反馈时生效', () => {
  assert.equal(pickState({ ...IDLE, walking: true }), 'walk')
  assert.equal(pickState({ ...IDLE, walking: true, transient: 'eat' }), 'eat')
})

test('任务事件与互动优先于 walk，游走不遮住反馈动画', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'celebrate', until: 5000 }, walking: true }), 'celebrate')
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 }, walking: true }), 'working')
  assert.equal(pickState({ ...IDLE, transient: 'play', walking: true }), 'play')
  assert.equal(pickState({ ...IDLE, walking: true }), 'walk')
})

test('瞬发 transient 覆盖派生状态（eat/play/wake）', () => {
  assert.equal(pickState({ ...IDLE, transient: 'eat' }), 'eat')
  assert.equal(pickState({ ...IDLE, transient: 'play' }), 'play')
  assert.equal(pickState({ ...IDLE, transient: 'wake' }), 'wake')
})

test('wake 使用独立的较长过渡时长', () => {
  assert.equal(TRANSIENT_MS, 1500)
  assert.equal(WAKE_MS, 3000)
  assert.ok(WAKE_MS > TRANSIENT_MS)
})

test('burst 在窗口内生效、过期后回退（welcome/celebrate/error/disappointed）', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'welcome', until: 2000 } }), 'welcome')
  assert.equal(pickState({ ...IDLE, activity: { name: 'celebrate', until: 2000 } }), 'celebrate')
  assert.equal(pickState({ ...IDLE, activity: { name: 'error', until: 2000 } }), 'error')
  assert.equal(pickState({ ...IDLE, activity: { name: 'disappointed', until: 2000 } }), 'disappointed')
  assert.notEqual(pickState({ ...IDLE, activity: { name: 'celebrate', until: 500 } }), 'celebrate')
})

test('working 与 sleeping', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 } }), 'working')
  assert.equal(pickState({ ...IDLE, sleeping: true }), 'sleep')
})

test('joy 在互动后窗口内生效、过期回 idle', () => {
  assert.equal(pickState({ ...IDLE, joyUntil: 1500 }), 'joy')
  assert.notEqual(pickState({ ...IDLE, joyUntil: 800 }), 'joy')
  assert.equal(pickState(IDLE), 'idle')
})

test('零负反馈：pet 不再驱动状态（无 hunger/mood 分支）', () => {
  assert.equal(pickState({ ...IDLE, pet: { hunger: 90, mood: 0 } }), 'idle')
})

test('确定性：显式 now 时相同输入相同输出', () => {
  assert.deepEqual(pickState(IDLE), pickState(IDLE))
})

test('TRANSIENT_MS/JOY_MS 与 EMOJI 完整性（每个可达状态都有兜底表情）', () => {
  assert.equal(TRANSIENT_MS, 1500)
  assert.equal(JOY_MS, 1600)
  for (const s of ['idle', 'working', 'celebrate', 'error', 'disappointed', 'joy', 'eat', 'play', 'drag', 'walk', 'sleep', 'wake', 'welcome', 'think', 'wait']) {
    assert.ok(EMOJI[s] !== undefined, `EMOJI 缺 ${s}`)
  }
})

test('会话感知：等待批准 wait 优先于思考陪伴 think（都需要用户注意）', () => {
  assert.equal(pickState({ ...IDLE, sessionThink: true }), 'think')
  assert.equal(pickState({ ...IDLE, sessionWait: true }), 'wait')
  assert.equal(pickState({ ...IDLE, sessionThink: true, sessionWait: true }), 'wait')
})

test('会话感知：思考陪伴覆盖 sleep/walk/working/joy（会话活跃时保持清醒陪伴）', () => {
  assert.equal(pickState({ ...IDLE, sessionThink: true, sleeping: true }), 'think')
  assert.equal(pickState({ ...IDLE, sessionThink: true, walking: true }), 'think')
  assert.equal(pickState({ ...IDLE, sessionThink: true, activity: { name: 'working', until: 0 } }), 'think')
  assert.equal(pickState({ ...IDLE, sessionThink: true, joyUntil: 1500 }), 'think')
})

test('会话感知：事件反馈与用户互动仍优先于陪伴状态（不抢戏）', () => {
  assert.equal(pickState({ ...IDLE, sessionThink: true, transient: 'eat' }), 'eat')
  assert.equal(pickState({ ...IDLE, sessionWait: true, transient: 'wake' }), 'wake')
  assert.equal(pickState({ ...IDLE, sessionThink: true, activity: { name: 'celebrate', until: 5000 } }), 'celebrate')
  assert.equal(pickState({ ...IDLE, sessionWait: true, dragging: true }), 'drag')
})

test('deriveSessionMood：多会话聚合——任一 running 即思考、任一 pending 即等待、标题收集', () => {
  const snap = {
    current: 's2',
    byId: {
      s1: { displayTitle: '甲', running: true },
      s2: { displayTitle: '乙', running: false, pendingInteraction: 'approval' },
      s3: { displayTitle: '丙', running: false },
    },
  }
  const mood = deriveSessionMood(snap)
  assert.equal(mood.thinking, true)
  assert.equal(mood.waiting, true)
  assert.deepEqual(mood.titles, ['甲'])
})

test('deriveSessionMood：空/未就绪快照与缺字段行安全（服务不可用降级）', () => {
  assert.deepEqual(deriveSessionMood(undefined), { thinking: false, waiting: false, titles: [] })
  assert.deepEqual(deriveSessionMood({ byId: {} }), { thinking: false, waiting: false, titles: [] })
  const mood = deriveSessionMood({ byId: { s1: { running: false }, s2: null } })
  assert.equal(mood.thinking, false)
  assert.equal(mood.waiting, false)
  assert.deepEqual(mood.titles, [])
  // pending 值枚举：approval/plan-review/question 任一都算等待
  for (const p of ['approval', 'plan-review', 'question']) {
    assert.equal(deriveSessionMood({ byId: { s1: { pendingInteraction: p } } }).waiting, true)
  }
})

test('STATE_TABLE 文法单源：表内状态全部在 EMOJI 表，idle 兜底在末行', () => {
  const last = STATE_TABLE[STATE_TABLE.length - 1]
  assert.equal(last.state, 'idle') // 兜底必须最后
  assert.equal(last.when({}), true) // 恒命中
  for (const row of STATE_TABLE) {
    // burst 是动态解析（resolve 到 activity.name），其可能值也须在 EMOJI
    for (const s of ['welcome', 'celebrate', 'error', 'disappointed']) assert.ok(EMOJI[s])
    if (row.state !== 'burst') assert.ok(EMOJI[row.state], `STATE_TABLE 状态 ${row.state} 缺 EMOJI 兜底`)
  }
})

test('STATE_TABLE 行序即优先级：手动验证关键竞争', () => {
  // drag 最高：其他条件全命中时仍返回 drag
  assert.equal(pickState({ ...IDLE, dragging: true, transient: 'eat', sessionWait: true, sleeping: true, walking: true }), 'drag')
  // burst 高于瞬发：welcome 窗口内点 eat 仍播 welcome
  assert.equal(pickState({ ...IDLE, activity: { name: 'welcome', until: 5000 }, transient: 'eat' }), 'welcome')
  // wait > think > working
  assert.equal(pickState({ ...IDLE, sessionWait: true, sessionThink: true, activity: { name: 'working', until: 0 } }), 'wait')
  // think > sleep（会话活跃保持清醒）
  assert.equal(pickState({ ...IDLE, sessionThink: true, sleeping: true }), 'think')
})
