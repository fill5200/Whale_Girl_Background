// 门禁自证：verify-spec-states 必须证明它会拒绝（法则 2）。
// 归属：门禁源码改动跑本文件（node --test scripts/gates/）。
// v5：权威集合从 EMOJI 表改为 STATE_NAMES（素材全量契约），并校验 STATE_TABLE 行漂移。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { check } from './verify-spec-states.mjs'
import { STATE_NAMES } from '../../client/logic.mjs'

const names = [...STATE_NAMES]

/** 构造一份与当前 STATE_NAMES 完全一致的 spec 总表。 */
function goodSpec() {
  const rows = names.map((s) => `| \`${s}\` | 触发 | 1 | — | — | 画面 |`)
  return [
    '# Sprite 素材规格（生图契约）',
    '',
    '## 状态总表（权威，15 状态）',
    '',
    '| 状态 | 触发 | 帧数 | motion 配方 | loop | 画面 |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '## 其它小节',
    '',
  ].join('\n')
}

function makeTree(specContent) {
  const root = mkdtempSync(join(tmpdir(), 'vspec-'))
  const p = join(root, 'docs', 'sprites-spec.md')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, specContent)
  return root
}

test('接受：spec 总表与 STATE_NAMES 逐名一致、声明数正确', () => {
  const { ok, errors } = check(makeTree(goodSpec()))
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：STATE_NAMES 有但 spec 缺（新增状态漏同步 spec）', () => {
  const rows = names.filter((s) => s !== 'think').map((s) => `| \`${s}\` | 触发 | 1 | — | — | 画面 |`)
  const spec = [
    '## 状态总表（权威，14 状态）',
    '',
    '| 状态 | 帧数 |',
    '|---|---|',
    ...rows,
  ].join('\n')
  const { ok, errors } = check(makeTree(spec))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /client STATE_NAMES 有 think/)
})

test('拒绝：spec 有但 STATE_NAMES 缺（删除/改名状态漏同步 logic.mjs）', () => {
  const rows = [...names, 'teleport'].map((s) => `| \`${s}\` | 触发 | 1 | — | — | 画面 |`)
  const spec = [
    '## 状态总表（权威，16 状态）',
    '',
    '| 状态 | 帧数 |',
    '|---|---|',
    ...rows,
  ].join('\n')
  const { ok, errors } = check(makeTree(spec))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /spec 状态总表有 teleport/)
})

test('拒绝：声明数与表格行数不符（标题数字漂移）', () => {
  const spec = [
    '## 状态总表（权威，99 状态）',
    '',
    '| 状态 | 帧数 |',
    '|---|---|',
    ...names.map((s) => `| \`${s}\` | 1 |`),
  ].join('\n')
  const { ok, errors } = check(makeTree(spec))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /声明 99 状态，表格实际/)
})

test('拒绝：缺少权威总表标题', () => {
  const { ok, errors } = check(makeTree('# 只有标题\n\n没有总表\n'))
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /缺少「状态总表（权威，N 状态）」标题/)
})
