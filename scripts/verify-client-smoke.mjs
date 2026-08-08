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

const res = spawnSync(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=12000', '--dump-dom', URL],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
if (res.status !== 0) {
  console.error(`[verify-client-smoke] Chrome 失败：${String(res.stderr).slice(0, 500)}`)
  process.exit(1)
}
const html = res.stdout
const errors = []
if (html.includes('Failed to load plugins')) errors.push('页面出现 "Failed to load plugins"（client apply 失败）')
if (!html.includes('data-dsh-pet')) errors.push('未找到 [data-dsh-pet]（client half 未 apply）')
const stageHasSprite = html.includes('pet-sprite ready')
const stageHasEmoji = /<div class="pet-stage"[^>]*>[^<]/.test(html)
if (!stageHasSprite && !stageHasEmoji) errors.push('宠物舞台为空（sprite 未渲染且无 emoji 兜底）')
if (errors.length > 0) {
  for (const e of errors) console.error(`[verify-client-smoke] ${e}`)
  process.exit(1)
}
console.log('[verify-client-smoke] OK：client apply 成功，宠物已渲染（' + (stageHasSprite ? 'sprite' : 'emoji') + '）')
