// Node half 状态机单测（node:test，零依赖）。归属：src/ 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_STATE, tick, feed, play, levelFor } from '../src/pet-state.mjs'

const HOUR = 3_600_000

test('初始状态为冻结默认值', () => {
  assert.deepEqual(INITIAL_STATE, { hunger: 0, mood: 60, level: 1, xp: 0, updatedAt: 0 })
  assert.equal(Object.isFrozen(INITIAL_STATE), true)
})

test('tick 按流逝推进衰减且不可变', () => {
  const base = { ...INITIAL_STATE, updatedAt: 0 }
  const next = tick(base, 2 * HOUR)
  assert.equal(next.hunger, 16)
  assert.equal(next.mood, 56)
  assert.equal(next.updatedAt, 2 * HOUR)
  assert.equal(base.updatedAt, 0)
})

test('tick 的负流逝钳制为 0', () => {
  const base = { ...INITIAL_STATE, updatedAt: 1000 }
  const next = tick(base, 500)
  assert.equal(next.hunger, 0)
  assert.equal(next.updatedAt, 500)
})

test('feed 降饥饿、升心情、加经验，且不越过边界', () => {
  const base = { ...INITIAL_STATE, hunger: 10, mood: 99, updatedAt: 0 }
  const next = feed(base, 1000)
  assert.equal(next.hunger, 0)
  assert.equal(next.mood, 100)
  assert.equal(next.xp, 10)
  assert.equal(next.level, 1)
})

test('play 升心情、饥饿略增（运动消耗）、加经验', () => {
  const base = { ...INITIAL_STATE, mood: 80, updatedAt: 0 }
  const next = play(base, 1000)
  assert.equal(next.mood, 100)
  assert.equal(next.hunger, 8)
  assert.equal(next.xp, 15)
})

test('levelFor 按经验阈值升级', () => {
  assert.equal(levelFor(0), 1)
  assert.equal(levelFor(99), 1)
  assert.equal(levelFor(100), 2)
  assert.equal(levelFor(299), 3)
})

test('确定性：相同输入产生相同输出', () => {
  const base = { ...INITIAL_STATE, updatedAt: 0 }
  assert.deepEqual(tick(base, 1000), tick(base, 1000))
  assert.deepEqual(feed(base, 1000), feed(base, 1000))
})
