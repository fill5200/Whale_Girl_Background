// /interact 纯逻辑单测（node:test）。归属：src/interact.mjs 的行为改动跑本文件。
// v2：投喂/玩耍是纯乐趣互动——状态不变，只回话（零负反馈，无数值影响）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, isCrossOrigin } from '../src/interact.mjs'
import { INITIAL_STATE } from '../src/pet-state.mjs'

const base = { ...INITIAL_STATE, updatedAt: 0 }

test('applyAction: feed 返回 200 + 回话，状态不变', () => {
  const r = applyAction(base, 'feed')
  assert.equal(r.status, 200)
  assert.equal(r.body.pet, base)
  assert.match(r.body.reply, /「/)
})

test('applyAction: play 返回 200 + 回话，状态不变', () => {
  const r = applyAction(base, 'play')
  assert.equal(r.status, 200)
  assert.equal(r.body.pet, base)
  assert.match(r.body.reply, /「/)
})

test('applyAction: 未知动作返回 400 且不产生新状态', () => {
  const r = applyAction(base, 'dance')
  assert.equal(r.status, 400)
  assert.equal(r.body.pet, undefined)
  assert.match(r.body.error, /unknown action "dance"/)
})

test('isCrossOrigin: Sec-Fetch-Site 优先', () => {
  assert.equal(isCrossOrigin({ 'sec-fetch-site': 'same-origin' }, '127.0.0.1:1'), false)
  assert.equal(isCrossOrigin({ 'sec-fetch-site': 'none' }, '127.0.0.1:1'), false)
  assert.equal(isCrossOrigin({ 'sec-fetch-site': 'cross-site' }, '127.0.0.1:1'), true)
})

test('isCrossOrigin: 无 Sec-Fetch-Site 时用 Origin', () => {
  assert.equal(isCrossOrigin({ origin: 'http://127.0.0.1:60135' }, '127.0.0.1:60135'), false)
  assert.equal(isCrossOrigin({ origin: 'http://evil.example' }, '127.0.0.1:60135'), true)
  assert.equal(isCrossOrigin({ origin: 'not a url' }, '127.0.0.1:60135'), true)
})

test('isCrossOrigin: 无头（非浏览器客户端）视为同源', () => {
  assert.equal(isCrossOrigin({}, '127.0.0.1:60135'), false)
})
