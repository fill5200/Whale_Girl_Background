// 生成器：.dsh-plugin/client/index.mjs → .dsh-plugin/client.js（bundle 产物，随插件分发）。
// 契约：--check 模式在内存生成后与已提交 .dsh-plugin/client.js 逐字节比对，不一致非零退出——
// 手改生成物禁止（改 client/index.mjs，勿改 client.js）。
// esbuild 经 .bin CLI 调用（pnpm 布局下 require.resolve 不可靠）；解析顺序：
// 本地 node_modules/.bin → $DSH_CHECKOUT/node_modules/.bin → /tmp/dsh-0808/node_modules/.bin；
// 全部缺失时明确跳过并说明（该门禁声明消费构建产物，缺失外部工具时跳过而非假装通过）。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = '.dsh-plugin/client/index.mjs'
const OUTPUT = join(ROOT, '.dsh-plugin', 'client.js')

function resolveEsbuildBin() {
  const candidates = [
    join(ROOT, 'node_modules/.bin/esbuild'),
    ...(process.env.DSH_CHECKOUT ? [join(process.env.DSH_CHECKOUT, 'node_modules/.bin/esbuild')] : []),
    '/tmp/dsh-0808/node_modules/.bin/esbuild',
  ]
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p
    } catch {
      // 下一个候选
    }
  }
  return null
}

/** esbuild 是否可用（自证测试据此决定跳过）。 */
export function esbuildAvailable() {
  return resolveEsbuildBin() !== null
}

/**
 * 生成 client.js（自执行 UI 脚本 bundle——官方 repository-plugin 形态，无 __ModuleLoader__
 * 契约；页面加载由 entry 的 UI 路由 + 注入缝驱动，见决策记录
 * 2026-08-10-migrate-to-official-repository-plugin.md）。
 * @param {{ check?: boolean, root?: string }} opts
 * @returns {{ ok: boolean, errors?: string[], skipped?: string }}
 */
export function generate({ check = false, root = ROOT } = {}) {
  const esbuildBin = resolveEsbuildBin()
  if (esbuildBin === null) {
    return { ok: true, skipped: 'esbuild 不可用：设置 DSH_CHECKOUT 指向 dsh checkout，或在仓库内安装 devDependencies' }
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'whale-girl-'))
  const tmpOut = join(tmpDir, 'client.js')
  const res = spawnSync(
    esbuildBin,
    [
      ENTRY,
      '--bundle',
      '--format=iife',
      '--platform=browser',
      '--target=es2020',
      `--outfile=${tmpOut}`,
    ],
    { cwd: root, encoding: 'utf8' },
  )
  if (res.status !== 0) {
    return { ok: false, errors: [`esbuild 失败：${res.stderr.trim()}`] }
  }
  const code = readFileSync(tmpOut)
  const outputPath = join(root, '.dsh-plugin', 'client.js')
  if (!check) {
    writeFileSync(outputPath, code)
    return { ok: true }
  }
  let committed = null
  try {
    committed = readFileSync(outputPath)
  } catch {
    return { ok: false, errors: [`${outputPath} 不存在：运行 node scripts/build-client.mjs 生成`] }
  }
  if (Buffer.compare(committed, code) !== 0) {
    return { ok: false, errors: ['client.js 与生成器输出不一致：运行 node scripts/build-client.mjs 重新生成（手改生成物禁止）'] }
  }
  return { ok: true }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check')
  const result = generate({ check })
  if (result.skipped !== undefined) {
    console.log(`[build-client] SKIP：${result.skipped}`)
    process.exit(0)
  }
  if (!result.ok) {
    for (const e of result.errors ?? []) console.error(`[build-client] ${e}`)
    process.exit(1)
  }
  console.log(check ? '[build-client] client.js 新鲜（--check OK）' : '[build-client] client.js 已生成')
}
