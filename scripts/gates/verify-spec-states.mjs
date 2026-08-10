// 门禁：docs/sprites-spec.md 状态总表与 client STATE_NAMES 权威集合一致。
// 拒绝不变量：spec「状态总表（权威，N 状态）」声明数 ≠ 表格实际状态行数，
// 或表格状态集合 ≠ client/logic.mjs 的 STATE_NAMES（双向——新增/改名状态
// 必须同时改 spec 与 STATE_NAMES，任一漏改即红；防止文档漂移），
// 或 STATE_TABLE 行的状态（含 burst 的 resolve 值）不在 STATE_NAMES（文法漂移）。
// 只读、确定性。
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { STATE_NAMES, STATE_TABLE } from '../../client/logic.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
// 权威总表标题：`## 状态总表（权威，N 状态）`（N 由表格行数验证，防止手改标题数漂移）。
const TITLE_RE = /^## 状态总表（权威，(\d+) 状态）$/
// 表格状态行：`| \`name\` | ...`（表头/分隔行除外）。
const STATE_ROW_RE = /^\| `([a-z-]+)` \|/

/** 校验 spec 状态总表与 STATE_NAMES/STATE_TABLE 一致。返回 { ok, errors }。 */
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
  const nameSet = new Set(STATE_NAMES)
  for (const name of nameSet) {
    if (!specSet.has(name)) errors.push(`client STATE_NAMES 有 ${name}，spec 状态总表缺（须同步 docs/sprites-spec.md）`)
  }
  for (const name of specSet) {
    if (!nameSet.has(name)) errors.push(`spec 状态总表有 ${name}，client STATE_NAMES 缺（须同步 client/logic.mjs）`)
  }
  // STATE_TABLE 文法漂移：行状态（含 burst resolve 的动态值）必须在权威集合内。
  for (const row of STATE_TABLE) {
    if (row.state !== 'burst' && !nameSet.has(row.state)) {
      errors.push(`STATE_TABLE 行状态 ${row.state} 不在 STATE_NAMES（新增状态须同步权威集合与 spec）`)
    }
  }
  for (const dynamic of ['welcome', 'celebrate', 'error', 'disappointed']) {
    if (!nameSet.has(dynamic)) errors.push(`burst 动态解析值 ${dynamic} 不在 STATE_NAMES`)
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
  console.log(`[verify-spec-states] OK（${STATE_NAMES.length} 状态与 spec 总表一致）`)
}
