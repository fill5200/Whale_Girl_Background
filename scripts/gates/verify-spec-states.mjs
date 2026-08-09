// 门禁：docs/sprites-spec.md 状态总表与 client EMOJI 兜底表逐名一致。
// 拒绝不变量：spec「状态总表（权威，N 状态）」声明数 ≠ 表格实际状态行数，
// 或表格状态集合 ≠ client/logic.mjs 的 EMOJI 键集合（双向——新增/改名状态
// 必须同时改 spec 与 EMOJI 表，任一漏改即红；防止文档漂移）。
// 只读、确定性。
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EMOJI } from '../../client/logic.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const SPEC = join(ROOT, 'docs', 'sprites-spec.md')
// 权威总表标题：`## 状态总表（权威，N 状态）`（N 由表格行数验证，防止手改标题数漂移）。
const TITLE_RE = /^## 状态总表（权威，(\d+) 状态）$/
// 表格状态行：`| \`name\` | ...`（表头/分隔行除外）。
const STATE_ROW_RE = /^\| `([a-z-]+)` \|/

/** 校验 spec 状态总表与 EMOJI 键集合一致。返回 { ok, errors }。 */
export function check(root = ROOT) {
  const errors = []
  const spec = join(root, 'docs', 'sprites-spec.md')
  let lines
  try {
    lines = readFileSync(spec, 'utf8').split('\n')
  } catch (error) {
    return { ok: false, errors: [`docs/sprites-spec.md 无法读取：${error instanceof Error ? error.message : String(error)}`] }
  }
  let declared = null
  let inTable = false
  const rows = []
  for (const line of lines) {
    const t = TITLE_RE.exec(line)
    if (t !== null) {
      declared = Number(t[1])
      inTable = true
      continue
    }
    if (inTable) {
      if (line.startsWith('## ')) break // 表格结束（下一小节）
      const m = STATE_ROW_RE.exec(line)
      if (m !== null && !line.includes('---')) rows.push(m[1])
    }
  }
  if (declared === null) {
    errors.push('docs/sprites-spec.md 缺少「状态总表（权威，N 状态）」标题')
    return { ok: false, errors }
  }
  if (rows.length !== declared) {
    errors.push(`状态总表声明 ${declared} 状态，表格实际 ${rows.length} 行（新增/删除状态须同步标题数字与表格）`)
  }
  const specSet = new Set(rows)
  const emojiKeys = Object.keys(EMOJI)
  for (const name of emojiKeys) {
    if (!specSet.has(name)) errors.push(`client EMOJI 有 ${name}，spec 状态总表缺（须同步 docs/sprites-spec.md）`)
  }
  for (const name of specSet) {
    if (!(name in EMOJI)) errors.push(`spec 状态总表有 ${name}，client EMOJI 缺（须同步 client/logic.mjs）`)
  }
  return { ok: errors.length === 0, errors }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ok, errors } = check()
  for (const e of errors) console.error(`[verify-spec-states] ${e}`)
  if (!ok) {
    console.error(`[verify-spec-states] ${errors.length} 处违规`)
    process.exit(1)
  }
  console.log(`[verify-spec-states] OK（${Object.keys(EMOJI).length} 状态与 spec 总表一致）`)
}
