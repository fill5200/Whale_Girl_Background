// /interact 纯逻辑单测（node:test）。归属：src/interact.mjs 的行为改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, isCrossOrigin } from '../src/interact.mjs'
import { INITIAL_STATE, levelFor } from '../src/pet-state.mjs'

const base = { ...INITIAL_STATE, updatedAt: 0 }

test('applyAction: feed 返回 200 与新状态', () => {
  const r = applyAction({ ...base, updatedAt: 1000 }, 'feed', 1000)
  assert.equal(r.status, 200)
  assert.equal(r.body.pet.hunger, 0)
  assert.equal(r.body.pet.xp, 10)
})

test('applyAction: play 返回 200 与新状态', () => {
  const r = applyAction({ ...base, updatedAt: 1000 }, 'play', 1000)
  assert.equal(r.status, 200)
  assert.equal(r.body.pet.mood, 85)
  assert.equal(r.body.pet.xp, 15)
})

test('applyAction: 未知动作返回 400 且不产生新状态', () => {
  const r = applyAction(base, 'dance', 1000)
  assert.equal(r.status, 400)
  assert.equal(r.body.pet, undefined)
  assert.match(r.body.error, /unknown action "dance"/)
})

test('applyAction: 传 stale 状态也吸收流逝衰减', () => {
  const stale = { ...base, updatedAt: 0 }
  const r = applyAction(stale, 'feed', 2 * 3_600_000)
  // 先 tick：hunger +16；再 feed -35 → clamp 0
  assert.equal(r.body.pet.hunger, 0)
  // 先 tick：mood -4；再 feed +5 → 61
  assert.equal(r.body.pet.mood, 61)
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
