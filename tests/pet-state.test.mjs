// 积累账本单测（node:test，零依赖）。归属：src/pet-state.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INITIAL_STATE, MEMORY_MAX, TASK_XP, SESSION_XP, xpForLevel, levelFor,
  recordTaskCompleted, recordFailure, recordSession, recordActive, describe, titleName,
} from '../src/pet-state.mjs'

const NOW = 1_700_000_000_000

test('初始账本为冻结默认值（零负反馈：无 hunger/mood 字段）', () => {
  assert.deepEqual(INITIAL_STATE, {
    level: 1, xp: 0,
    stats: { tasksDone: 0, failures: 0, sessions: 0, activeMs: 0, firstSeenAt: null },
    titles: [], memory: [], updatedAt: 0,
  })
  assert.equal(Object.isFrozen(INITIAL_STATE), true)
  assert.equal('hunger' in INITIAL_STATE, false)
  assert.equal('mood' in INITIAL_STATE, false)
})

test('xpForLevel 三角数列与 levelFor 互逆', () => {
  assert.equal(xpForLevel(1), 0)
  assert.equal(xpForLevel(2), 50)
  assert.equal(xpForLevel(3), 150)
  assert.equal(levelFor(0), 1)
  assert.equal(levelFor(49), 1)
  assert.equal(levelFor(50), 2)
  assert.equal(levelFor(149), 2)
  assert.equal(levelFor(150), 3)
})

test('recordTaskCompleted：+XP、记统计、写回忆、不可变', () => {
  const base = { ...INITIAL_STATE, updatedAt: 0 }
  const { state } = recordTaskCompleted(base, '任务甲', NOW)
  assert.equal(state.stats.tasksDone, 1)
  assert.equal(state.xp, TASK_XP)
  assert.equal(state.level, 1)
  assert.match(state.memory[0], /完成任务「任务甲」（第 1 个）/)
  assert.equal(base.stats.tasksDone, 0) // 不可变
  assert.equal(state.updatedAt, NOW)
})

test('recordTaskCompleted：长标签截断（回忆用可读标签而非 UUID）', () => {
  const long = 'a3f9c2d1e4b5a6b7c8d9e0f1a2b3c4d5e6f7a8b9'
  const { state } = recordTaskCompleted({ ...INITIAL_STATE, updatedAt: 0 }, long, NOW)
  assert.match(state.memory[0], /「a3f9c2d1e4b5a6…」/)
  assert.ok(state.memory[0].length < 50)
})

test('任务完成解锁称号「初次协作」', () => {
  const { state, unlocked } = recordTaskCompleted({ ...INITIAL_STATE, updatedAt: 0 }, 'x', NOW)
  assert.deepEqual(unlocked, ['初次协作'])
  assert.ok(state.titles.includes('first-task'))
})

test('升级：XP 越过阈值时 leveledUp 且回忆含升级', () => {
  const base = { ...INITIAL_STATE, xp: 45, level: 1, updatedAt: 0 }
  const { state, leveledUp } = recordTaskCompleted(base, 'x', NOW)
  assert.equal(leveledUp, true)
  assert.equal(state.level, 2)
  assert.ok(state.memory.some((m) => /升到 Lv\.2/.test(m)))
})

test('recordFailure：只计数不惩罚（无 XP、不扣等级）', () => {
  const base = { ...INITIAL_STATE, xp: 100, level: 2, updatedAt: 0 }
  const { state } = recordFailure(base, NOW)
  assert.equal(state.stats.failures, 1)
  assert.equal(state.xp, 100)
  assert.equal(state.level, 2)
  assert.match(state.memory[0], /任务失败（第 1 次）/)
})

test('5 次失败解锁「越挫越勇」', () => {
  let s = { ...INITIAL_STATE, updatedAt: 0 }
  let unlocked = []
  for (let i = 0; i < 5; i++) {
    const r = recordFailure(s, NOW + i)
    s = r.state
    unlocked = r.unlocked
  }
  assert.ok(unlocked.includes('越挫越勇'))
})

test('recordSession：+XP、记首见时间', () => {
  const { state } = recordSession({ ...INITIAL_STATE, updatedAt: 0 }, NOW)
  assert.equal(state.stats.sessions, 1)
  assert.equal(state.stats.firstSeenAt, NOW)
  assert.equal(state.xp, SESSION_XP)
})

test('recordActive：活跃时长积累且称号「常驻伙伴」在 6h 解锁', () => {
  let s = { ...INITIAL_STATE, updatedAt: 0 }
  s = recordActive(s, 6 * 3_600_000, NOW).state
  assert.equal(s.stats.activeMs, 6 * 3_600_000)
  assert.ok(s.titles.includes('regular'))
})

test('回忆环形上限 MEMORY_MAX', () => {
  let s = { ...INITIAL_STATE, updatedAt: 0 }
  for (let i = 0; i < MEMORY_MAX + 3; i++) {
    s = recordFailure(s, NOW + i).state
  }
  assert.equal(s.memory.length, MEMORY_MAX)
})

test('titleName 未知 id 原样返回', () => {
  assert.equal(titleName('first-task'), '初次协作')
  assert.equal(titleName('unknown-id'), 'unknown-id')
})

test('describe 资历摘要', () => {
  const { state } = recordTaskCompleted({ ...INITIAL_STATE, updatedAt: 0 }, 'x', NOW)
  assert.match(describe(state), /资历 Lv\.1（10 XP）· 完成 1 个任务 · 称号「初次协作」/)
})
