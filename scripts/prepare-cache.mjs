#!/usr/bin/env node
/**
 * 过渡安装辅助：预填充 RepositoryCache，让 whale-girl 在官方包未发布期间可安装。
 *
 * 背景：官方 `@deepseek-ai/dsh-repository-plugin`（`dsh-plugin-prepare` 的提供者）
 * 是 `private: true` 未发布到 npm——RepositoryCache 安装时在 `.dsh-plugin/` 跑
 * `pnpm install` 会因该 devDependency 404 失败；而 loader 又硬校验
 * `scripts.prepack` + devDependencies 声明（不能移除）。本脚本按 loader 的
 * cache 契约预填充 `$DSH_HOME/cache/repository-plugins/<sha256>`（拷贝已 prepared
 * 的 `.dsh-plugin` + 临时摘除不可解析 devDep 安装 runtime 依赖 + 写 marker），
 * loader 命中缓存后跳过 pnpm install、校验 metadata、加载 wrapper。
 *
 * 官方发布 @deepseek-ai/dsh-repository-plugin 后此脚本不再需要（移除即可）。
 *
 * 用法：
 *   node scripts/prepare-cache.mjs            # 默认 home=~/.dsh，ref=当前 HEAD
 *   node scripts/prepare-cache.mjs --home=/tmp/dsh-test-home --ref=<commit>
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const pluginDir = join(repoRoot, '.dsh-plugin')
const spec = 'github:dsh-external/whale-girl'
const args = process.argv.slice(2)
const opt = (key, dflt) => args.find(a => a.startsWith(`${key}=`))?.slice(key.length + 1) ?? dflt
const home = opt('--home', join(homedir(), '.dsh'))
const ref = opt('--ref', execSync('git -C ' + repoRoot + ' rev-parse HEAD').toString().trim())
const specifier = `${spec}#${ref}&path:/.dsh-plugin`
const key = createHash('sha256').update(specifier).digest('hex')
const cacheDir = join(home, 'cache', 'repository-plugins', key)
const repoNodeModules = join(cacheDir, 'node_modules', 'repository')
const markerFile = join(cacheDir, '.repository-cache.json')
const pkgFile = join(repoNodeModules, 'package.json')

if (existsSync(markerFile)) {
  const marker = JSON.parse(await readFile(markerFile, 'utf8'))
  if (marker.specifier === specifier) {
    console.log(`cache ready: ${cacheDir} (specifier matches, skip)`)
    process.exit(0)
  }
}

console.log(`preparing cache for ${specifier}`)
console.log(`cache dir: ${cacheDir}`)

await rm(cacheDir, { recursive: true, force: true })
await mkdir(repoNodeModules, { recursive: true })
// 1. 拷贝已 prepared 的 .dsh-plugin（含生成的 dsh-plugin.mjs / dsh-plugin-assets/）
await cp(pluginDir, repoNodeModules, { recursive: true })
// 2. 临时摘除不可解析的官方 devDep，仅装 runtime 依赖
const original = await readFile(pkgFile, 'utf8')
const pkg = JSON.parse(original)
const originalDev = pkg.devDependencies
delete pkg.devDependencies
await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
try {
  execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: repoNodeModules, stdio: 'inherit' })
} finally {
  pkg.devDependencies = originalDev
  await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
}
// 3. 写 loader 的 cache marker（specifier 精确匹配）
await writeFile(markerFile, JSON.stringify({ specifier }) + '\n')

console.log(`done. loader will hit this cache for ${specifier}`)
console.log(`to reset: rm -rf ${cacheDir}`)
