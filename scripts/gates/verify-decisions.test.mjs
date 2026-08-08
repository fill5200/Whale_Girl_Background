// 门禁自证：verify-decisions 必须证明它会拒绝（法则 2）。
// 归属：门禁源码改动跑本文件（node --test scripts/gates/）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { check } from './verify-decisions.mjs'

const GOOD = `# Decision: 测试决策

Status: implemented

## Problem

动机。

## Decision

已落地。

## Alternatives considered

**备选 A。** 为何落败。

## Consequences

后果。
`

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'vdec-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

test('接受：合法记录', () => {
  const root = makeTree({ 'decisions/implemented/process/2026-08-08-x.md': GOOD })
  const { ok, errors } = check(root)
  assert.equal(ok, true, errors.join('\n'))
})

test('拒绝：Status 与所在目录不一致', () => {
  const bad = GOOD.replace('Status: implemented', 'Status: proposed')
  const root = makeTree({ 'decisions/implemented/process/2026-08-08-x.md': bad })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /Status "proposed" 与所在目录 implemented/)
})

test('拒绝：已实施记录缺 Alternatives considered', () => {
  const bad = GOOD.replace('## Alternatives considered\n\n**备选 A。** 为何落败。\n\n', '')
  const root = makeTree({ 'decisions/implemented/process/2026-08-08-x.md': bad })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /缺必需章节 "## Alternatives considered"/)
})

test('拒绝：已实施记录出现规划语气标题', () => {
  const bad = GOOD.replace('## Decision', '## Proposal')
  const root = makeTree({ 'decisions/implemented/process/2026-08-08-x.md': bad })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /禁止规划语气标题 "## Proposal"/)
})

test('拒绝：分类不在封闭集合', () => {
  const root = makeTree({ 'decisions/implemented/nonsense/2026-08-08-x.md': GOOD })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /分类不在封闭集合/)
})

test('拒绝：文件名不带日期', () => {
  const root = makeTree({ 'decisions/implemented/process/no-date.md': GOOD })
  const { ok, errors } = check(root)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /文件名必须形如/)
})
