// 门禁自证：check-generated（client.js 新鲜度）必须证明它会拒绝（法则 2）。
// 在临时根构造最小 client 源 → 生成 → 篡改 → 断言 --check 拒绝；未篡改则通过。
// esbuild 不可用时跳过（该门禁声明消费构建产物，缺失外部工具时明确跳过）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate, esbuildAvailable } from '../build-client.mjs'

const ENTRY = `window.__ModuleLoader__.load({ id: 'vlln/whale-girl', factory: () => ({ name: 'x', inject: [], apply() {} }) })`
const PLUGIN_JSON = JSON.stringify({ id: 'vlln/whale-girl', main: './index.mjs', contributes: { tools: [], skills: [] } }, null, 2)

function makeRoot({ entry = ENTRY } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gen-'))
  mkdirSync(join(root, 'client'))
  writeFileSync(join(root, 'client/index.mjs'), entry)
  writeFileSync(join(root, 'dsh.plugin.json'), PLUGIN_JSON)
  return root
}

test('拒绝：client.js 与生成器输出不一致（含修复提示）', { skip: !esbuildAvailable() }, async () => {
  const root = makeRoot()
  await generate({ check: false, root })
  writeFileSync(join(root, 'client.js'), readFileSync(join(root, 'client.js'), 'utf8') + '\n// tampered')
  const result = await generate({ check: true, root })
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /不一致/)
  assert.match(result.errors.join('\n'), /build-client\.mjs/)
})

test('接受：client.js 与生成器输出一致', { skip: !esbuildAvailable() }, async () => {
  const root = makeRoot()
  await generate({ check: false, root })
  const result = await generate({ check: true, root })
  assert.equal(result.ok, true)
})

test('拒绝：client.js 缺失', { skip: !esbuildAvailable() }, async () => {
  const root = makeRoot()
  const result = await generate({ check: true, root })
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /不存在/)
})

test('拒绝：bundle 缺 __ModuleLoader__.load 契约', { skip: !esbuildAvailable() }, async () => {
  const root = makeRoot({ entry: 'export function apply() {}\n' })
  const result = await generate({ check: false, root })
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /__ModuleLoader__\.load/)
})

test('拒绝：bundle 注册 id 与插件 id 不一致', { skip: !esbuildAvailable() }, async () => {
  const root = makeRoot({ entry: ENTRY.replace("'vlln/whale-girl'", "'vlln/other'") })
  const result = await generate({ check: false, root })
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /id 必须等于插件 id/)
})
