// src/activity.mjs 单测（node:test）。归属：活动推导逻辑改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveActivity, mergeBurst, BURST_MS } from '../src/activity.mjs'

test('无任务 → idle（working=false，无 burst）', () => {
  const r = deriveActivity({ tasks: [], nowMs: 1000 })
  assert.equal(r.working, false)
  assert.equal(r.burst, null)
})

test('存在 running 任务 → working', () => {
  const r = deriveActivity({ tasks: [{ id: 't1', status: 'running' }], nowMs: 1000 })
  assert.equal(r.working, true)
  assert.equal(r.burst, null)
  assert.equal(r.wasWorking, true)
})

test('running→completed 翻转 → celebrate burst 且 completed 带任务 id', () => {
  const known = new Map([['t1', 'running']])
  const r = deriveActivity({ tasks: [{ id: 't1', status: 'completed' }], nowMs: 1000, known })
  assert.equal(r.working, false)
  assert.equal(r.burst.name, 'celebrate')
  assert.equal(r.burst.until, 1000 + BURST_MS)
  assert.deepEqual(r.completed, ['t1'])
  assert.deepEqual(r.failed, [])
})

test('running→failed 翻转 → error burst 且 failed 带任务 id', () => {
  const known = new Map([['t1', 'running']])
  const r = deriveActivity({ tasks: [{ id: 't1', status: 'failed' }], nowMs: 1000, known })
  assert.equal(r.burst.name, 'error')
  assert.deepEqual(r.failed, ['t1'])
  assert.deepEqual(r.completed, [])
})

test('上次工作且任务消失（列表只留活跃）→ celebrate burst', () => {
  const r = deriveActivity({ tasks: [], nowMs: 1000, known: new Map([['t1', 'running']]), wasWorking: true })
  assert.equal(r.burst.name, 'celebrate')
})

test('记账推进：known 更新为最新状态', () => {
  const known = new Map()
  deriveActivity({ tasks: [{ id: 't1', status: 'running' }], nowMs: 1, known })
  deriveActivity({ tasks: [{ id: 't1', status: 'completed' }], nowMs: 2, known })
  assert.equal(known.get('t1'), 'completed')
})

test('任务列表为空时清空 known（防长会话泄漏）', () => {
  const known = new Map([['t1', 'completed'], ['t2', 'failed']])
  deriveActivity({ tasks: [], nowMs: 1, known, wasWorking: false })
  assert.equal(known.size, 0)
})

test('mergeBurst：取 until 更晚者；空值传播', () => {
  const a = { name: 'celebrate', until: 100 }
  const b = { name: 'error', until: 200 }
  assert.deepEqual(mergeBurst(a, b), b)
  assert.deepEqual(mergeBurst(null, a), a)
  assert.deepEqual(mergeBurst(a, null), a)
})
