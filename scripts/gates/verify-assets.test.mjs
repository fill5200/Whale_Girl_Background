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
    writeFileSync(p, content instanceof Buffer ? content : typeof content === 'string' ? content : JSON.stringify(content))
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

test('接受：frames:1 + 白名单 motion 配方', () => {
  const good = { states: { idle: { sheet: 'idle.png', frames: 1, fps: 4, loop: true, motion: 'bob' } } }
  const root = makeTree({ 'assets/manifest.json': good, 'assets/idle.png': 'x' })
  const { ok, errors } = check(root)
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：motion 不在白名单', () => {
  const bad = { states: { idle: { sheet: 'idle.png', frames: 1, fps: 4, loop: true, motion: 'teleport' } } }
  const root = makeTree({ 'assets/manifest.json': bad, 'assets/idle.png': 'x' })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /motion "teleport" 不在白名单/)
})

test('拒绝：motion 配 frames>1（与帧播放器互斥）', () => {
  const bad = { states: { idle: { sheet: 'idle.png', frames: 2, fps: 4, loop: true, motion: 'bob' } } }
  const root = makeTree({ 'assets/manifest.json': bad, 'assets/idle.png': 'x' })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /motion 配方要求 frames === 1/)
})

/** 构造最小 PNG 头（宽高可指定；门禁只读 IHDR 尺寸）。 */
function fakePng(w, h) {
  const buf = Buffer.alloc(24)
  buf.writeUInt32BE(0x89504e47, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12)
  buf.writeUInt32BE(w, 16)
  buf.writeUInt32BE(h, 20)
  return buf
}

test('拒绝：单姿势 256×256 配 frames:2（宽度 ≠ 2×高度，姿势会被劈开）', () => {
  const bad = { states: { eat: { sheet: 'eat.png', frames: 2, fps: 10, loop: false } } }
  const root = makeTree({ 'assets/manifest.json': bad, 'assets/eat.png': fakePng(256, 256) })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /frames 2 要求 PNG 宽度 = 2 × 高度/)
})

test('接受：真两帧横排 sheet（512×256 配 frames:2）', () => {
  const good = { states: { eat: { sheet: 'eat.png', frames: 2, fps: 10, loop: false } } }
  const root = makeTree({ 'assets/manifest.json': good, 'assets/eat.png': fakePng(512, 256) })
  const { ok, errors } = check(root)
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：manifest 状态不在 client EMOJI 兜底表', () => {
  const bad = { states: { teleport: { sheet: 'idle.png', frames: 1, fps: 4, loop: true } } }
  const root = makeTree({ 'assets/manifest.json': bad, 'assets/idle.png': 'x' })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /状态不在 client EMOJI 兜底表/)
})
