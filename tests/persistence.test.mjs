// 持久化纯逻辑单测（node:test）。归属：src/persistence.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeState, serializeState } from '../src/persistence.mjs'

test('normalizeState: 合法账本原样归一化', () => {
  const s = normalizeState({
    xp: 150, updatedAt: 1234,
    stats: { tasksDone: 3, failures: 1, sessions: 2, activeMs: 1000, firstSeenAt: 100 },
    titles: ['first-task'], memory: ['a', 'b'],
  })
  assert.deepEqual(s, {
    level: 3, xp: 150,
    stats: { tasksDone: 3, failures: 1, sessions: 2, activeMs: 1000, firstSeenAt: 100 },
    titles: ['first-task'], memory: ['a', 'b'], updatedAt: 1234,
  })
})

test('normalizeState: level 按 xp 重算（手改不一致被纠正）', () => {
  const s = normalizeState({ xp: 10, level: 9, updatedAt: 0 })
  assert.equal(s.level, 1)
})

test('normalizeState: 越界/非法字段容错（负值归零、非数忽略、缺字段补齐）', () => {
  const s = normalizeState({ xp: -5, stats: { tasksDone: -3, failures: 'x' }, titles: 'bad', memory: [1, 'ok'], updatedAt: 0 })
  assert.equal(s.xp, 0)
  assert.equal(s.stats.tasksDone, 0)
  assert.equal(s.stats.failures, 0)
  assert.deepEqual(s.titles, [])
  assert.deepEqual(s.memory, ['ok'])
})

test('normalizeState: 未知称号 id 被过滤', () => {
  const s = normalizeState({ xp: 10, titles: ['first-task', 'hack-title'], updatedAt: 0 })
  assert.deepEqual(s.titles, ['first-task'])
})

test('normalizeState: 缺失/非对象/非法数值返回 null', () => {
  assert.equal(normalizeState(null), null)
  assert.equal(normalizeState('x'), null)
  assert.equal(normalizeState({ xp: 'high', updatedAt: 0 }), null)
  assert.equal(normalizeState({ xp: undefined, updatedAt: 0 }), null)
})

test('normalizeState: updatedAt 缺失/非法回退 Date.now()', () => {
  const s = normalizeState({ xp: 0 })
  assert.ok(Number.isFinite(s.updatedAt))
})

test('serializeState: 往返一致', () => {
  const state = { level: 2, xp: 50, stats: { tasksDone: 5, failures: 0, sessions: 1, activeMs: 0, firstSeenAt: 1 }, titles: ['first-task'], memory: ['a'], updatedAt: 1234 }
  assert.deepEqual(JSON.parse(serializeState(state)), state)
})
