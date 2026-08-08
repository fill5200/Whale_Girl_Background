// 门禁：assets manifest 引用一致性。
// 拒绝不变量：assets/manifest.json 里每个 state 的 sheet 引用的文件必须真实存在、
// 扩展名在 MIME 白名单内（与 src/assets.mjs 一致）、frames/fps/loop 字段合法、
// motion 配方（若声明）在白名单内且 frames 必须为 1（帧播放器与运动配方互斥），
// 且 PNG 多帧 sheet 必须满足宽度 = frames × 高度（横排帧图契约——单姿势图配 frames>1
// 会把姿势劈成两半）。只读、确定性。
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')

/** 与 src/assets.mjs 的 MIME 表一致的扩展名白名单。 */
const ALLOWED_EXT = ['.png', '.svg', '.webp', '.jpg', '.jpeg', '.gif', '.json']

/** 与 client/index.mjs 的 pet-motion-* 类一致的运动配方白名单。 */
export const MOTION_WHITELIST = ['bob', 'wiggle', 'squash', 'shake', 'sigh', 'hop', 'tilt', 'float', 'wave']

/** 读 PNG 的 IHDR 宽高（无依赖）；非 PNG 返回 null。 */
function pngSize(file) {
  const buf = readFileSync(file)
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

/** 校验 assets manifest。返回 { ok, errors }。 */
export function check(root = ROOT) {
  const errors = []
  const manifestPath = join(root, 'assets', 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { ok: false, errors: [`assets/manifest.json 无法解析：${error instanceof Error ? error.message : String(error)}`] }
  }
  if (manifest.states === undefined || typeof manifest.states !== 'object' || Array.isArray(manifest.states)) {
    return { ok: false, errors: ['assets/manifest.json 缺 states 对象'] }
  }
  for (const [name, cfg] of Object.entries(manifest.states)) {
    if (cfg === null || typeof cfg !== 'object' || typeof cfg.sheet !== 'string' || cfg.sheet === '') {
      errors.push(`manifest.states.${name}: 缺 sheet 字段`)
      continue
    }
    const file = join(root, 'assets', cfg.sheet)
    try {
      if (!statSync(file).isFile()) throw new Error('not a file')
    } catch {
      errors.push(`manifest.states.${name}: sheet "${cfg.sheet}" 文件不存在（期望 assets/${cfg.sheet}）`)
    }
    const dot = cfg.sheet.lastIndexOf('.')
    const ext = dot === -1 ? '' : cfg.sheet.slice(dot).toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) {
      errors.push(`manifest.states.${name}: sheet "${cfg.sheet}" 扩展名不在白名单 ${ALLOWED_EXT.join('/')}`)
    }
    if (!Number.isInteger(cfg.frames) || cfg.frames < 1) errors.push(`manifest.states.${name}: frames 必须是正整数`)
    if (typeof cfg.fps !== 'number' || cfg.fps <= 0) errors.push(`manifest.states.${name}: fps 必须是正数`)
    if (typeof cfg.loop !== 'boolean') errors.push(`manifest.states.${name}: loop 必须是布尔值`)
    if (cfg.motion !== undefined) {
      if (!MOTION_WHITELIST.includes(cfg.motion)) {
        errors.push(`manifest.states.${name}: motion "${cfg.motion}" 不在白名单 ${MOTION_WHITELIST.join('/')}`)
      }
      if (cfg.frames !== 1) errors.push(`manifest.states.${name}: motion 配方要求 frames === 1（帧播放器与运动配方互斥）`)
    }
    // PNG 多帧契约：宽度 = frames × 高度（横排、帧等宽同高）。
    // 单姿势 256×256 图配 frames:2 → 256 ≠ 512 → 拒绝（帧播放器会把姿势劈成两半）。
    if (cfg.frames > 1 && cfg.sheet.toLowerCase().endsWith('.png')) {
      try {
        const size = pngSize(file)
        if (size !== null && size.w !== cfg.frames * size.h) {
          errors.push(`manifest.states.${name}: frames ${cfg.frames} 要求 PNG 宽度 = ${cfg.frames} × 高度（当前 ${size.w}×${size.h}——单姿势图勿配 frames>1）`)
        }
      } catch {
        // 文件不可读（statSync 已报错）：跳过尺寸校验
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

// CLI 入口（被 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ok, errors } = check()
  for (const e of errors) console.error(`[verify-assets] ${e}`)
  if (!ok) {
    console.error(`[verify-assets] ${errors.length} 处违规`)
    process.exit(1)
  }
  console.log('[verify-assets] OK')
}
