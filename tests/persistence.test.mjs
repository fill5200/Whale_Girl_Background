// 持久化纯逻辑单测（node:test）。归属：src/persistence.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeState, serializeState } from '../src/persistence.mjs'

test('normalizeState: 合法状态原样归一化', () => {
  const s = normalizeState({ hunger: 30, mood: 70, xp: 150, updatedAt: 1234 })
  assert.deepEqual(s, { hunger: 30, mood: 70, xp: 150, level: 2, updatedAt: 1234 })
})

test('normalizeState: level 按 xp 重算（手改不一致被纠正）', () => {
  const s = normalizeState({ hunger: 0, mood: 60, xp: 10, level: 9, updatedAt: 0 })
  assert.equal(s.level, 1)
})

test('normalizeState: 越界值 clamp（手改/旧版本容忍）', () => {
  const s = normalizeState({ hunger: 999, mood: -50, xp: 10, updatedAt: 0 })
  assert.equal(s.hunger, 100)
  assert.equal(s.mood, 0)
})

test('normalizeState: 缺失/非对象/非法数值返回 null', () => {
  assert.equal(normalizeState(null), null)
  assert.equal(normalizeState('x'), null)
  assert.equal(normalizeState({ hunger: 'high', mood: 60, xp: 1, updatedAt: 0 }), null)
  assert.equal(normalizeState({ hunger: 10, mood: 60, xp: undefined, updatedAt: 0 }), null)
})

test('normalizeState: updatedAt 缺失/非法回退 Date.now()', () => {
  const s = normalizeState({ hunger: 0, mood: 60, xp: 0 })
  assert.ok(Number.isFinite(s.updatedAt))
})

test('serializeState: 往返一致', () => {
  const state = { hunger: 30, mood: 70, level: 2, xp: 150, updatedAt: 1234 }
  assert.deepEqual(JSON.parse(serializeState(state)), state)
})
