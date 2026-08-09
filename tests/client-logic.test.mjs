// client 纯逻辑单测（node:test）。归属：client/logic.mjs 的行为改动跑本文件。
// v2：零负反馈——无 hunger/mood 属性状态；情绪只由事件瞬发 + 互动喜悦。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickState, TRANSIENT_MS, WAKE_MS, JOY_MS, ROUND_CELEBRATE_MS, EMOJI, deriveSessionMood, STATE_TABLE, nextWorkingRhythm, detectRoundCompleted, shouldWake } from '../client/logic.mjs'

const IDLE = { activity: { name: 'idle', until: 0 }, dragging: false, transient: null, sleeping: false, joyUntil: 0, now: 1000 }

test('拖拽优先于一切', () => {
  assert.equal(pickState({ ...IDLE, dragging: true, transient: 'eat' }), 'drag')
})

test('临时状态结束后回到当前底层状态', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 }, transient: 'wake' }), 'wake')
  assert.equal(pickState({ ...IDLE, activity: { name: 'celebrate', until: 5000 }, transient: 'wake' }), 'celebrate')
  assert.equal(pickState({ ...IDLE, workingActive: true, transient: null }), 'working')
  assert.equal(pickState({ ...IDLE, transient: null, sleeping: true }), 'sleep')
})

test('walk 游走只在无事件反馈时生效', () => {
  assert.equal(pickState({ ...IDLE, walking: true }), 'walk')
  assert.equal(pickState({ ...IDLE, walking: true, transient: 'eat' }), 'eat')
})

test('任务事件与互动优先于 walk，游走不遮住反馈动画', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'celebrate', until: 5000 }, walking: true }), 'celebrate')
  assert.equal(pickState({ ...IDLE, workingActive: true, walking: true }), 'working')
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
  assert.equal(pickState({ ...IDLE, workingActive: true }), 'working')
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
  // now=2500 → 时间片 think 段，sessionThink 时思考陪伴
  assert.equal(pickState({ ...IDLE, sessionThink: true, now: 2500 }), 'think')
  assert.equal(pickState({ ...IDLE, sessionWait: true }), 'wait')
  assert.equal(pickState({ ...IDLE, sessionThink: true, sessionWait: true }), 'wait')
})

test('会话感知：思考陪伴覆盖 sleep/walk/joy（会话活跃时保持清醒陪伴）', () => {
  // now 取 think 段，验证陪伴优先于睡眠/漫游/喜悦
  assert.equal(pickState({ ...IDLE, sessionThink: true, sleeping: true, now: 2500 }), 'think')
  assert.equal(pickState({ ...IDLE, sessionThink: true, walking: true, now: 2500 }), 'think')
  assert.equal(pickState({ ...IDLE, sessionThink: true, joyUntil: 1500, now: 2500 }), 'think')
})

test('工作陪伴（v3）：workingActive 插曲 > think 常态，不依赖 activity', () => {
  // think 是会话思考常态（不依赖 Node half activity——思考阶段 activity 是 idle）
  assert.equal(pickState({ ...IDLE, sessionThink: true, activity: { name: 'idle', until: 0 } }), 'think')
  // working 插曲激活时优先显示 working（随机节奏器注入 workingActive）
  assert.equal(pickState({ ...IDLE, sessionThink: true, workingActive: true }), 'working')
  // 无 sessionThink 时插曲撤防（纯任务也不显示 working——working 不是任务指示灯）
  assert.equal(pickState({ ...IDLE, workingActive: true, sessionThink: false }), 'working')
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 } }), 'idle')
})

test('回合完成庆祝（v3）：celebrateUntil 窗口内播 celebrate，且不抢互动/等待', () => {
  // 回合完成窗口内 → celebrate（高于 think/working 陪伴）
  assert.equal(pickState({ ...IDLE, sessionThink: true, celebrateUntil: 2000, now: 1000 }), 'celebrate')
  assert.equal(pickState({ ...IDLE, celebrateUntil: 2000, now: 1000 }), 'celebrate')
  // 窗口过期 → 回底层（think/陪伴）
  assert.equal(pickState({ ...IDLE, sessionThink: true, celebrateUntil: 500, now: 1000 }), 'think')
  // 不抢互动：用户点击喂食时先播 eat（互动优先）
  assert.equal(pickState({ ...IDLE, transient: 'eat', celebrateUntil: 2000, now: 1000 }), 'eat')
  // 不抢等待批准（wait 需要用户注意）
  assert.equal(pickState({ ...IDLE, sessionWait: true, celebrateUntil: 2000, now: 1000 }), 'wait')
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
  // think > sleep（会话活跃保持清醒；now 取 think 段）
  assert.equal(pickState({ ...IDLE, sessionThink: true, sleeping: true, now: 2500 }), 'think')
  // celebrate（回合完成窗口）低于 wait、高于 think
  assert.equal(pickState({ ...IDLE, sessionThink: true, celebrateUntil: 2000, now: 1000 }), 'celebrate')
})

test('拖拽放下缓冲：dragReleaseUntil 内短暂回 idle，再进入底层状态', () => {
  // 放下缓冲期内：即使有 working 插曲/思考陪伴也先 idle
  assert.equal(pickState({ ...IDLE, dragReleaseUntil: 2500, now: 1000, sessionThink: true, workingActive: true }), 'idle')
  // 缓冲过期后：进入底层（working 插曲优先于 think）
  assert.equal(pickState({ ...IDLE, dragReleaseUntil: 2500, now: 3000, sessionThink: true, workingActive: true }), 'working')
  assert.equal(pickState({ ...IDLE, dragReleaseUntil: 2500, now: 3000, sessionThink: true, workingActive: false }), 'think')
})

// ---- v3 纯函数调度面（确定性：now/random 显式注入）----

test('nextWorkingRhythm：会话不活跃时插曲撤防', () => {
  assert.deepEqual(
    nextWorkingRhythm({ now: 1000, sessionThink: false, working: { active: true, until: 2000 } }),
    { active: false, until: 0 },
  )
})

test('nextWorkingRhythm：think 常态 → 随机间隔后插 working（区间边界用注入随机源）', () => {
  const base = { now: 1000, sessionThink: true, working: { active: false, until: 0 } }
  // r=0 → 最短间隔；r→1⁻ → 接近最长间隔（区间断言，不依赖取整细节）
  const min = nextWorkingRhythm({ ...base, random: () => 0 })
  assert.equal(min.active, true)
  assert.equal(min.until, 1000 + 12000) // WORKING_MIN_WAIT_MS
  const max = nextWorkingRhythm({ ...base, random: () => 0.999 })
  assert.equal(max.active, true)
  assert.ok(max.until >= 1000 + 12000 && max.until <= 1000 + 30000) // WORKING_MAX_WAIT_MS 区间
})

test('nextWorkingRhythm：working 中 → 随机时长后回 think', () => {
  const base = { now: 5000, sessionThink: true, working: { active: true, until: 6000 } }
  const short = nextWorkingRhythm({ ...base, random: () => 0 })
  assert.equal(short.active, false)
  assert.equal(short.until, 5000 + 2500) // WORKING_MIN_DUR_MS
  const long = nextWorkingRhythm({ ...base, random: () => 0.999 })
  assert.equal(long.active, false)
  assert.ok(long.until >= 5000 + 2500 && long.until <= 5000 + 6000) // WORKING_MAX_DUR_MS 区间
})

test('detectRoundCompleted：completed 从无到有 → flips；seen 去重', () => {
  const snap = { byId: { s1: { displayTitle: '甲', completed: true }, s2: { completed: false }, s3: { displayTitle: '丙', completed: true } } }
  const first = detectRoundCompleted(snap, new Set(), 's1')
  assert.deepEqual(first.flips.map((f) => f.id), ['s1', 's3'])
  assert.equal(first.seen.has('s1'), true)
  // 第二次：无新 flips（去重）
  const second = detectRoundCompleted(snap, first.seen, 's1')
  assert.deepEqual(second.flips, [])
  // 新完成的会话才入 flips
  const snap2 = { byId: { s1: { completed: true }, s4: { displayTitle: '丁', completed: true } } }
  const third = detectRoundCompleted(snap2, first.seen, 's1')
  assert.deepEqual(third.flips.map((f) => f.id), ['s4'])
})

test('detectRoundCompleted：空/损坏快照安全', () => {
  assert.deepEqual(detectRoundCompleted(undefined, new Set(), 's1').flips, [])
  assert.deepEqual(detectRoundCompleted({ byId: {} }, new Set(), 's1').flips, [])
  assert.deepEqual(detectRoundCompleted({ byId: { s1: null } }, new Set(), 's1').flips, [])
})

test('shouldWake：sleep→非 sleep 且非拖拽/无瞬发 → 播 wake', () => {
  assert.equal(shouldWake('sleep', 'think', {}), true)
  assert.equal(shouldWake('sleep', 'working', {}), true)
  // 仍在 sleep / 非 sleep 出发 → 不播
  assert.equal(shouldWake('sleep', 'sleep', {}), false)
  assert.equal(shouldWake('think', 'idle', {}), false)
  // 拖拽打断 / 瞬发占用 → 不播
  assert.equal(shouldWake('sleep', 'think', { dragging: true }), false)
  assert.equal(shouldWake('sleep', 'think', { transient: 'eat' }), false)
})
