// 门禁：defineTool 的 value-schema DSL 兼容性（两个已知拒绝模式）。
// 拒绝不变量：index.mjs 的 defineTool 块内出现 DSL 不支持的 schema 形态——
// (a) `required: [...]` 数组（DSL 只支持属性级 required: true）；
// (b) `type: 'object'` 未在附近显式声明 additionalProperties（DSL 要求显式 true/false）。
// 只读、确定性。局限：窗口启发式（对象字面量不跨 >120 字符窗口），完整校验在宿主
// defineTool 编译期——本门禁把两类已知错误前置到提交前。
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')
const BLOCK_START = /defineTool\(\{/g
const REQUIRED_ARRAY = /required:\s*\[/
const OBJECT_TYPE = /type:\s*['"]object['"]/
const ADDITIONAL_PROPS = /additionalProperties\s*:/

/** 提取 defineTool({...}) 块（括号平衡）。 */
export function toolBlocks(source) {
  const blocks = []
  BLOCK_START.lastIndex = 0
  let m
  while ((m = BLOCK_START.exec(source)) !== null) {
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    blocks.push(source.slice(m.index, i + 1))
  }
  return blocks
}

/** 校验 defineTool 块的 schema DSL 兼容性。返回 { ok, errors }。 */
export function check(root = ROOT) {
  const source = readFileSync(join(root, '.dsh-plugin', 'index.mjs'), 'utf8')
  const errors = []
  for (const block of toolBlocks(source)) {
    if (REQUIRED_ARRAY.test(block)) {
      errors.push('defineTool schema 使用了 required 数组——DSL 不支持，用属性级 required: true')
    }
    // 每个 type: 'object' 的 120 字符窗口内须有 additionalProperties。
    let from = 0
    let o
    while ((o = OBJECT_TYPE.exec(block.slice(from))) !== null) {
      const at = from + o.index
      const window = block.slice(at, at + 120)
      if (!ADDITIONAL_PROPS.test(window)) {
        errors.push('object schema 未显式声明 additionalProperties（DSL 要求 true/false 二选一）')
      }
      from = at + 1
    }
  }
  return { ok: errors.length === 0, errors }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ok, errors } = check()
  for (const e of errors) console.error(`[verify-tool-schemas] ${e}`)
  if (!ok) {
    console.error(`[verify-tool-schemas] ${errors.length} 处违规`)
    process.exit(1)
  }
  console.log('[verify-tool-schemas] OK')
}
