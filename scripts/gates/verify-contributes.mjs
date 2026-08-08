// 门禁：contributes.tools 与 index.mjs 注册的工具逐名一致（清单契约）。
// 拒绝不变量：dsh.plugin.json 声明的工具与入口 defineTool 注册名集合不相等。
// 只读、确定性；扫描限定 defineTool({ ... name: '...' }) 内的 name 属性，
// 避免误匹配 activity 等普通对象字面量里的 name 字段。
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')
const TOOL_NAME_RE = /defineTool\(\{[\s\S]*?name:\s*['"]([a-z_]+)['"]/g

/** 从入口源码提取注册的工具名集合。 */
export function registeredToolNames(entrySource) {
  const names = new Set()
  let m
  while ((m = TOOL_NAME_RE.exec(entrySource)) !== null) names.add(m[1])
  return names
}

/** 校验 manifest 声明与入口注册一致。返回 { ok, errors }。 */
export function check(root = ROOT) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, 'dsh.plugin.json'), 'utf8'))
  } catch (error) {
    return { ok: false, errors: [`dsh.plugin.json 无法解析：${error.message}`] }
  }
  const declared = new Set(manifest.contributes?.tools ?? [])
  const registered = registeredToolNames(readFileSync(join(root, 'index.mjs'), 'utf8'))
  const errors = []
  for (const name of declared) {
    if (!registered.has(name)) errors.push(`contributes.tools 声明 "${name}" 但 index.mjs 未注册`)
  }
  for (const name of registered) {
    if (!declared.has(name)) errors.push(`index.mjs 注册 "${name}" 但 contributes.tools 未声明`)
  }
  return { ok: errors.length === 0, errors }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ok, errors } = check()
  for (const e of errors) console.error(`[verify-contributes] ${e}`)
  if (!ok) {
    console.error(`[verify-contributes] ${errors.length} 处不一致`)
    process.exit(1)
  }
  console.log('[verify-contributes] OK')
}
