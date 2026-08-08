// 浏览器级冒烟：验证 client half 在真实浏览器里 apply 成功且宠物真的渲染。
// 用法：node scripts/verify-client-smoke.mjs <web-url>
// 前置：验证站 web 运行中；本机有 Chrome（CHROME_BIN 可覆盖路径）。
// 断言：无 "Failed to load plugins"（client apply 未抛错）；[data-dsh-pet] 存在；
//       舞台有可见内容（.pet-sprite.ready 或 emoji 文本）。
// 这是 curl 覆盖不到的 client-apply 验证（P6 缺口实操面）——改 client/ 后跑一次。
// 非门禁（依赖 Chrome 与运行中的 web）：人工验证步骤，见 AGENTS.md 按改动面选检查。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.argv[2]

if (!URL) {
  console.error('用法: node scripts/verify-client-smoke.mjs <web-url>')
  process.exit(2)
}
if (!existsSync(CHROME)) {
  console.error(`[verify-client-smoke] Chrome 不可用：${CHROME}（用 CHROME_BIN 覆盖）`)
  process.exit(2)
}

/** 元素级断言（避免 CSS 选择器/模块源码字符串假绿）。 */
function analyze(html) {
  const errors = []
  if (html.includes('Failed to load plugins') || html.includes('plugin tree failed to load')) {
    errors.push('页面出现 harness/插件树加载失败（client apply 失败）')
  }
  // 元素 vs CSS：host 元素是 <div data-dsh-pet=""（属性带 =），CSS 是 [data-dsh-pet]。
  if (!/<div data-dsh-pet[=> ]/.test(html)) errors.push('未找到 [data-dsh-pet] 元素（client half 未 apply）')
  if (!/<span class="pet-lv"/.test(html)) errors.push('状态条未渲染（apply 可能中途抛错）')
  // 舞台：sprite 元素（含 background-image）或非空 emoji 文本。
  const stageHasSprite = /<div class="pet-stage[^"]*"[^>]*>\s*<div class="pet-sprite[^>]*background-image/.test(html)
  const stageHasEmoji = /<div class="pet-stage[^"]*"[^>]*>([^<\s])/.test(html)
  if (!stageHasSprite && !stageHasEmoji) errors.push('宠物舞台为空（sprite 未渲染且无 emoji 兜底）')
  return { errors, stageHasSprite }
}

function dump() {
  const res = spawnSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=15000', '--dump-dom', URL],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return res.status === 0 ? res.stdout : ''
}

// 虚拟时间下资源加载时序不稳定：最多 3 次 dump，任一绿即过。
let last = null
for (let attempt = 1; attempt <= 3; attempt++) {
  last = analyze(dump())
  if (last.errors.length === 0) break
  if (attempt < 3) console.error(`[verify-client-smoke] 第 ${attempt} 次 dump 未绿，重试…`)
}
if (last.errors.length > 0) {
  for (const e of last.errors) console.error(`[verify-client-smoke] ${e}`)
  process.exit(1)
}
console.log('[verify-client-smoke] OK：client apply 成功，宠物已渲染（' + (last.stageHasSprite ? 'sprite' : 'emoji') + '）')
