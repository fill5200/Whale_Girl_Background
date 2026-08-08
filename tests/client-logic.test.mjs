// client 纯逻辑单测（node:test）。归属：client/logic.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickState, TRANSIENT_MS, EMOJI } from '../client/logic.mjs'

const IDLE = { activity: { name: 'idle', until: 0 }, pet: { hunger: 0, mood: 60 }, dragging: false, transient: null, sleeping: false, now: 1000 }

test('拖拽优先于一切', () => {
  assert.equal(pickState({ ...IDLE, dragging: true, transient: 'eat' }), 'drag')
})

test('瞬发 transient 覆盖派生状态', () => {
  assert.equal(pickState({ ...IDLE, transient: 'eat' }), 'eat')
})

test('burst 在窗口内生效、过期后回退', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'celebrate', until: 2000 } }), 'celebrate')
  assert.equal(pickState({ ...IDLE, activity: { name: 'error', until: 2000 } }), 'error')
  assert.notEqual(pickState({ ...IDLE, activity: { name: 'celebrate', until: 500 } }), 'celebrate')
})

test('working 与 sleeping', () => {
  assert.equal(pickState({ ...IDLE, activity: { name: 'working', until: 0 } }), 'working')
  assert.equal(pickState({ ...IDLE, sleeping: true }), 'sleep')
})

test('状态优先级：hungry > sad > happy > idle', () => {
  assert.equal(pickState({ ...IDLE, pet: { hunger: 80, mood: 90 } }), 'hungry')
  assert.equal(pickState({ ...IDLE, pet: { hunger: 0, mood: 10 } }), 'sad')
  assert.equal(pickState({ ...IDLE, pet: { hunger: 10, mood: 90 } }), 'happy')
  assert.equal(pickState(IDLE), 'idle')
})

test('happy 接线：mood>=80 且 hunger<40', () => {
  assert.equal(pickState({ ...IDLE, pet: { hunger: 39, mood: 80 } }), 'happy')
  assert.notEqual(pickState({ ...IDLE, pet: { hunger: 40, mood: 90 } }), 'happy')
  assert.notEqual(pickState({ ...IDLE, pet: { hunger: 10, mood: 79 } }), 'happy')
})

test('确定性：显式 now 时相同输入相同输出', () => {
  assert.deepEqual(pickState(IDLE), pickState(IDLE))
})

test('TRANSIENT_MS 与 EMOJI 完整性（每个可达状态都有兜底表情）', () => {
  assert.equal(TRANSIENT_MS, 1500)
  for (const s of ['idle', 'happy', 'hungry', 'sad', 'eat', 'play', 'drag', 'sleep', 'working', 'celebrate', 'error']) {
    assert.ok(EMOJI[s] !== undefined, `EMOJI 缺 ${s}`)
  }
})
