// 门禁自证：verify-assets 必须证明它会拒绝（法则 2）。
// 归属：门禁源码改动跑本文件（node --test scripts/gates/）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { check } from './verify-assets.mjs'

const GOOD = { states: { idle: { sheet: 'idle.png', frames: 4, fps: 4, loop: true } } }

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'vass-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

test('接受：引用的 sheet 全部存在且字段合法', () => {
  const root = makeTree({ 'assets/manifest.json': GOOD, 'assets/idle.png': 'png-bytes' })
  const { ok, errors } = check(root)
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：manifest 引用不存在的 sheet（含状态名与路径）', () => {
  const root = makeTree({ 'assets/manifest.json': GOOD })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /manifest\.states\.idle/)
  assert.match(errors.join('\n'), /idle\.png/)
})

test('拒绝：manifest 不是合法 JSON', () => {
  const root = makeTree({ 'assets/manifest.json': '{broken' })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /无法解析/)
})

test('拒绝：frames 非法', () => {
  const bad = { states: { idle: { sheet: 'idle.png', frames: 0, fps: 4, loop: true } } }
  const root = makeTree({ 'assets/manifest.json': bad, 'assets/idle.png': 'x' })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /frames 必须是正整数/)
})

test('拒绝：sheet 扩展名不在 MIME 白名单', () => {
  const bad = { states: { idle: { sheet: 'idle.txt', frames: 4, fps: 4, loop: true } } }
  const root = makeTree({ 'assets/manifest.json': bad, 'assets/idle.txt': 'x' })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /扩展名不在白名单/)
})
