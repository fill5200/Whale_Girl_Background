// 门禁自证：verify-contributes 必须证明它会拒绝（法则 2）。
// 归属：门禁源码改动跑本文件（node --test scripts/gates/*.test.mjs）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, registeredToolNames } from './verify-contributes.mjs'

function makeRoot({ manifest = '{"id":"x/y","contributes":{"tools":["pet_a"]}}', entry = "ctx.tools.register(defineTool({ name: 'pet_a', ... }))" } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vcon-'))
  writeFileSync(join(root, 'dsh.plugin.json'), manifest)
  writeFileSync(join(root, 'index.mjs'), entry)
  return root
}

test('registeredToolNames 只提取 name: 属性（工具名）', () => {
  const src = `export const name = 'x/y'\nctx.tools.register(defineTool({ name: 'pet_a' }))\nctx.effect(fn, 'x/y: label')`
  assert.deepEqual([...registeredToolNames(src)], ['pet_a'])
})

test('接受：声明与注册逐名一致', () => {
  const { ok, errors } = check(makeRoot())
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：contributes 声明但未注册', () => {
  const { ok, errors } = check(makeRoot({ entry: "ctx.tools.register(defineTool({ name: 'pet_b', ... }))" }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /声明 "pet_a" 但 index\.mjs 未注册/)
})

test('拒绝：注册但未声明', () => {
  const { ok, errors } = check(makeRoot({ manifest: '{"id":"x/y","contributes":{"tools":[]}}' }))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /注册 "pet_a" 但 contributes\.tools 未声明/)
})
