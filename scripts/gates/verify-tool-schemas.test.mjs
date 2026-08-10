// 门禁自证：verify-tool-schemas 必须证明它会拒绝（法则 2）。
// 归属：门禁源码改动跑本文件（node --test scripts/gates/*.test.mjs）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolBlocks, check } from './verify-tool-schemas.mjs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeRoot(entry) {
  const root = mkdtempSync(join(tmpdir(), 'vts-'))
  mkdirSync(join(root, '.dsh-plugin'), { recursive: true })
  writeFileSync(join(root, '.dsh-plugin', 'index.mjs'), entry)
  return root
}

test('toolBlocks 提取 defineTool 块（括号平衡）', () => {
  const src = "register(defineTool({ name: 'a', output: { schema: { type: 'string' } } }))\nregister(defineTool({ name: 'b' }))"
  const blocks = toolBlocks(src)
  assert.equal(blocks.length, 2)
  assert.match(blocks[0], /name: 'a'/)
  assert.match(blocks[1], /name: 'b'/)
})

test('接受：标量输出 + 显式 additionalProperties 的 object schema', () => {
  const entry = "register(defineTool({ name: 'a', output: { schema: { type: 'object', additionalProperties: false, properties: {} } } }))"
  const { ok, errors } = check(makeRoot(entry))
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：required 数组', () => {
  const entry = "register(defineTool({ name: 'a', output: { schema: { type: 'object', required: ['x'], additionalProperties: false } } }))"
  const { ok, errors } = check(makeRoot(entry))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /required 数组/)
})

test('拒绝：object schema 未声明 additionalProperties', () => {
  const entry = "register(defineTool({ name: 'a', output: { schema: { type: 'object', properties: {} } } }))"
  const { ok, errors } = check(makeRoot(entry))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /additionalProperties/)
})
