// client 纯逻辑单测（node:test）。归属：client/logic.mjs 的行为改动跑本文件。
// v2：零负反馈——无 hunger/mood 属性状态；情绪只由事件瞬发 + 互动喜悦。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickState, TRANSIENT_MS, JOY_MS, EMOJI } from '../client/logic.mjs'

const IDLE = { activity: { name: 'idle', until: 0 }, dragging: false, transient: null, sleeping: false, joyUntil: 0, now: 1000 }

test('拖拽优先于一切', () => {
  assert.equal(pickState({ ...IDLE, dragging: true, transient: 'eat' }), 'drag')
})

test('瞬发 transient 覆盖派生状态（eat/play/wake）', () => {
  assert.equal(pickState({ ...IDLE, transient: 'eat' }), 'eat')
  assert.equal(pickState({ ...IDLE, transient: 'play' }), 'play')
  assert.equal(pickState({ ...IDLE, transient: 'wake' }), 'wake')
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
  assert.equal(JOY_MS, 3000)
  for (const s of ['idle', 'working', 'celebrate', 'error', 'disappointed', 'joy', 'eat', 'play', 'drag', 'sleep', 'wake', 'welcome']) {
    assert.ok(EMOJI[s] !== undefined, `EMOJI 缺 ${s}`)
  }
})
