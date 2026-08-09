// dsh-pet 浏览器 half：纯 DOM 自渲染宠物层（A 模式——GUI 内悬浮宠物）。
// 契约：bundle 顶层调用 window.__ModuleLoader__.load({ id, factory })——id 必须等于插件 id
// （dsh.plugin.json 的 id），否则 loader 的 arrive() 抛 "loaded without registering"；
// factory(require) 返回 Cordis 插件导出面（name/inject/apply）；apply 返回 disposer，
// 绑定插件 fiber，disable 时清理。零平台模块依赖：CSS 内联注入，动画/拖拽/菜单全部自建。
//
// 视觉：sprite sheet 帧播放器（assets/manifest.json 声明 状态→sheet/frames/fps/loop，
// 每状态一张横排帧图，透明背景）；sheet 缺失/未加载时用 emoji 兜底，增量替换。
// 状态选择与表情映射是纯函数（client/logic.mjs，可单测）；本文件只做 DOM 与计时。
// 交互要点：瞬发 eat/play 由 TRANSIENT_MS 超时兜底复位（sheet 缺失也保证不卡死）；
// pointer capture 只在越过拖拽阈值后启用（纯点击不捕获，菜单按钮 click 正常派发）。

import { TRANSIENT_MS, WAKE_MS, JOY_MS, pickState, deriveSessionMood } from './logic.mjs'
import { parseCharacters, getCharacter, stateOf, listCharacters, emojiFor } from './character.mjs'

const STATE_PATH = '/plugins/vlln/dsh-pet/state'
const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'
const CONFIG_PATH = '/plugins/vlln/dsh-pet/config'
const ASSETS_URL = '/plugins/vlln/dsh-pet/assets'
const MANIFEST_URL = `${ASSETS_URL}/manifest.json`
// 客户端运行参数：默认值与 Node half 的 src/config.mjs DEFAULTS 一致（单一来源——
// 消费端不写第二份默认值，见 verify-config-sync 门禁）。/state 的 configRevision
// 变化时拉取新值（applyClientConfig），未配置时用默认值。
const CFG_DEFAULTS = {
  size: 110, opacity: 1,
  walk: { enabled: true, minWaitMs: 18000, maxWaitMs: 40000, minMs: 3000, maxMs: 6000, speedPxPerSec: 45 },
  sleepAfterMs: 60000, pollMs: 3000, idlePauseMs: 3500, bubbleMs: 2500,
}
let cfg = { ...CFG_DEFAULTS }
const TICK_MS = 50
// 拖拽放下缓冲时长：放下后短暂回 idle（1.5s）再进入底层状态，避免生硬切换。
const DRAG_RELEASE_MS = 1500

const CSS = `
[data-dsh-pet] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  font-family: system-ui, sans-serif; user-select: none; cursor: grab; touch-action: none;
  opacity: var(--pet-opacity, 1); }
[data-dsh-pet] .pet-stage { position: relative; width: var(--pet-size, 110px); height: var(--pet-size, 110px); display: grid; place-items: center;
  font-size: calc(var(--pet-size, 110px) * 0.4); line-height: 1; text-align: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25));
  /* 视觉层不接收指针：sprite 溢出布局盒（256 逻辑×scale），pointer 由 hitarea 独占，
     消除层叠歧义（stage 及子元素不拦截点击）。 */
  pointer-events: none; }
[data-dsh-pet] .pet-effects { position: absolute; left: 0; top: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  pointer-events: none; overflow: visible; z-index: 2; }
[data-dsh-pet] .pet-hitarea { position: absolute; cursor: grab; touch-action: none; z-index: 3;
  border-radius: 8px; }
[data-dsh-pet] .pet-sprite { display: none; background-repeat: no-repeat; transition: opacity .12s ease; }
[data-dsh-pet] .pet-sprite.ready { display: block; }
/* 状态卡：默认置于宠物下方，间距足够（角色 bob 浮动 ±4px 不触到）+ 贴底时翻上方。 */
[data-dsh-pet] .pet-status { position: absolute; left: 50%; top: calc(100% + 18px); transform: translateX(-50%);
  width: max-content; min-width: 96px; max-width: calc(100vw - 24px); padding: 5px 8px;
  background: rgba(27,30,40,.94); backdrop-filter: blur(10px) saturate(1.15);
  border: 1px solid rgba(255,255,255,.10); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.38), 0 3px 8px rgba(0,0,0,.28);
  color: #E8EBF2; font-size: 11px; display: grid; gap: 4px; z-index: 1;
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .15s ease-out, transform .15s ease-out, visibility 0s linear .2s; }
[data-dsh-pet] .pet-status::after { /* 连接尾：命中区覆盖宠物↔卡片间隙，hover 连续不闪断 */
  content: ''; position: absolute; left: 50%; top: -5px; width: 10px; height: 10px;
  transform: translateX(-50%) rotate(45deg); background: rgba(27,30,40,.94);
  border-top: 1px solid rgba(255,255,255,.10); border-left: 1px solid rgba(255,255,255,.10);
  border-top-left-radius: 3px; pointer-events: auto; }
[data-dsh-pet]:hover .pet-status,
[data-dsh-pet]:focus-within .pet-status {
  opacity: 1; visibility: visible; pointer-events: auto;
  transform: translateX(-50%) translateY(0);
  transition: opacity .2s cubic-bezier(.16,1,.3,1), transform .2s cubic-bezier(.16,1,.3,1), visibility 0s;
  transition-delay: .06s; }
[data-dsh-pet] .pet-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
[data-dsh-pet] .pet-lv { background: rgba(86,134,254,.16); color: #B7C8FE; border-radius: 5px;
  padding: 2px 6px; font-size: 10px; font-weight: 600; line-height: 16px; white-space: nowrap; }
[data-dsh-pet] .pet-stats { color: #AEB6C4; font-size: 11px; line-height: 16px;
  font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-dsh-pet] .pet-note { color: #AEB6C4; font-size: 11px; line-height: 15px;
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
/* 左右对齐变体：宠物贴视口边缘时卡边缘对齐，避免横向溢出。 */
[data-dsh-pet] .pet-status.pet-status-left { left: 0; transform: translateX(0); }
[data-dsh-pet] .pet-status.pet-status-right { left: auto; right: 0; transform: translateX(0); }
[data-dsh-pet]:hover .pet-status.pet-status-left,
[data-dsh-pet]:focus-within .pet-status.pet-status-left,
[data-dsh-pet]:hover .pet-status.pet-status-right,
[data-dsh-pet]:focus-within .pet-status.pet-status-right { transform: translateX(0); }
/* 贴底翻转：宠物靠近视口底部时状态卡翻到上方（下方是屏幕边缘，卡会溢出/被裁）。 */
[data-dsh-pet] .pet-status.pet-status-above { top: auto; bottom: calc(100% + 18px); }
[data-dsh-pet] .pet-status.pet-status-above::after { top: auto; bottom: -5px; }
/* 气泡激活或菜单打开时状态卡让位隐藏（气泡/菜单优先，见共存策略）。 */
[data-dsh-pet] .pet-status.pet-status-hidden { opacity: 0 !important; visibility: hidden !important; }
[data-dsh-pet] .pet-menu { display: none; position: absolute; left: 50%; top: calc(100% + 12px); transform: translateX(-50%);
  width: max-content; gap: 6px; padding: 6px; border-radius: 8px;
  background: rgba(20,20,28,.72); }
[data-dsh-pet] .pet-bubble { position: absolute; left: 50%; top: calc(100% + 12px); transform: translateX(-50%);
  background: rgba(20,20,28,.85); color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 8px;
  white-space: nowrap; pointer-events: none; animation: dsh-pet-pop .25s ease-out;
  z-index: 3; }
[data-dsh-pet] .pet-menu.open { display: flex; }
[data-dsh-pet] .pet-menu button { flex: 1; border: 0; border-radius: 6px; padding: 4px 8px;
  font-size: 12px; cursor: pointer; background: rgba(255,255,255,.14); color: #fff; }
[data-dsh-pet] .pet-menu button:hover { background: rgba(255,255,255,.28); }
[data-dsh-pet] .pet-heart { position: absolute; font-size: 20px; pointer-events: none;
  animation: dsh-pet-float 1.8s ease-out forwards; }
/* 状态运动配方（manifest.motion → 舞台 CSS 类；frames>1 走帧播放器，frames=1 走此动画）。
   动画作用于舞台（无内联 transform），与 sprite 的内联 scale 不冲突。
   幅度克制（±2~6px/deg）+ 中间关键帧（0→1/4→1/2→3/4→1）：无突变的往复。 */
[data-dsh-pet] .pet-stage.pet-motion-bob { animation: dsh-pet-m-bob 2.4s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-wiggle { animation: dsh-pet-m-wiggle .9s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-squash { animation: dsh-pet-m-squash .7s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-shake { animation: dsh-pet-m-shake .3s linear infinite; }
[data-dsh-pet] .pet-stage.pet-motion-sigh { animation: dsh-pet-m-sigh 1.6s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-hop { animation: dsh-pet-m-hop .6s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-tilt { animation: dsh-pet-m-tilt 1.2s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-float { animation: dsh-pet-m-float 3.2s ease-in-out infinite; }
[data-dsh-pet] .pet-stage.pet-motion-wave { animation: dsh-pet-m-wave 1s ease-in-out infinite; }
@keyframes dsh-pet-m-bob { 0%,100% { transform: translateY(0); } 30% { transform: translateY(-3px); } 60% { transform: translateY(-4px); } }
@keyframes dsh-pet-m-wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-2deg); } 75% { transform: rotate(2deg); } }
@keyframes dsh-pet-m-squash { 0%,100% { transform: scale(1,1); } 25% { transform: scale(1.06,.94); } 50% { transform: scale(.96,1.04); } 75% { transform: scale(1.03,.97); } }
@keyframes dsh-pet-m-shake { 0%,100% { transform: translateX(0); } 30% { transform: translateX(-2px); } 60% { transform: translateX(2px); } 80% { transform: translateX(-1px); } }
@keyframes dsh-pet-m-sigh { 0%,100% { transform: translateY(0) scale(1,1); } 40% { transform: translateY(1.5px) scale(1,.98); } }
@keyframes dsh-pet-m-hop { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-6px); } 70% { transform: translateY(0); } }
@keyframes dsh-pet-m-tilt { 0%,100% { transform: rotate(0); } 30% { transform: rotate(-4deg); } 70% { transform: rotate(4deg); } }
@keyframes dsh-pet-m-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes dsh-pet-m-wave { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-6deg); } 40% { transform: rotate(6deg); } 60% { transform: rotate(-4deg); } 80% { transform: rotate(4deg); } }
@keyframes dsh-pet-float { 0% { opacity: 1; transform: translateY(0) scale(.7); }
  70% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-72px) scale(1.25); } }
@keyframes dsh-pet-pop { from { opacity: 0; transform: translateX(-50%) translateY(4px); } }
[data-dsh-pet][data-dsh-pet-inert] { opacity: .25; pointer-events: none; }
[data-dsh-pet][data-dsh-pet-hidden] { display: none; }
[data-dsh-pet] .pet-stage:focus-visible { outline: 2px solid rgba(255,255,255,.6); outline-offset: 2px; border-radius: 8px; }
@media (prefers-reduced-motion: reduce) {
  [data-dsh-pet] .pet-stage { animation: none !important; }
  [data-dsh-pet] .pet-sprite { animation: none !important; }
  [data-dsh-pet] .pet-heart { animation: none; opacity: 0; }
  [data-dsh-pet] .pet-bubble { animation: none; }
  [data-dsh-pet] .pet-status { transition: none !important; }
}
`

export function apply(ctx = {}) {
  // 幂等守卫：bundle 重复执行（dev/HMR 重建、loader 重跑）时不双宠物双 style。
  if (document.querySelector('[data-dsh-pet]') !== null) {
    console.warn('[dsh-pet] apply 已存在实例，跳过重复挂载')
    return () => {}
  }
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const host = document.createElement('div')
  host.setAttribute('data-dsh-pet', '')
  host.setAttribute('role', 'group')
  host.setAttribute('aria-label', '桌面宠物')
  host.setAttribute('aria-expanded', 'false')
  document.body.appendChild(host)

  const stage = document.createElement('div')
  stage.className = 'pet-stage'
  stage.setAttribute('role', 'button')
  stage.setAttribute('tabindex', '0')
  stage.setAttribute('aria-label', '互动菜单：回车或空格打开')
  const sprite = document.createElement('div')
  sprite.className = 'pet-sprite'
  stage.appendChild(sprite)

  const status = document.createElement('div')
  status.className = 'pet-status'
  status.innerHTML = `
    <div class="pet-meta"><span class="pet-lv">Lv.1</span><span class="pet-stats">0 任务</span></div>
    <div class="pet-note">…</div>`
  const metaLv = status.querySelector('.pet-lv')
  const metaStats = status.querySelector('.pet-stats')
  const metaNote = status.querySelector('.pet-note')

  const menu = document.createElement('div')
  menu.className = 'pet-menu'
  const feedBtn = document.createElement('button')
  feedBtn.textContent = '🍗 喂食'
  const playBtn = document.createElement('button')
  playBtn.textContent = '🎾 玩耍'
  const roleBtn = document.createElement('button')
  roleBtn.textContent = '🎭 换角色'
  menu.append(feedBtn, playBtn, roleBtn)

  // 特效层：爱心/气泡的独立容器（覆盖在舞台上方，不参与舞台内容切换——
  // stage 的 replaceChildren/textContent 不会清掉正在播放的特效）。
  const effects = document.createElement('div')
  effects.className = 'pet-effects'
  // 点击热区层：覆盖在角色内容上（贴合内容 bbox），pointer 事件绑此而非 stage——
  // 拖拽/点击热区 = 角色实际轮廓，四周透明边缘不可点。
  const hitarea = document.createElement('div')
  hitarea.className = 'pet-hitarea'
  host.append(effects, stage, hitarea, status, menu)

  // ---- 状态卡布局（视口感知：左右对齐，hover 显示时调用）----
  // status 绝对定位锚定宠物下方（始终不覆盖角色）；宠物贴左右缘 → 边缘对齐防横向溢出。
  // 气泡激活（activeBubble）或拖拽中 → 隐藏让位（气泡/移动是主角）。
  const layoutStatus = () => {
    if (activeBubble !== null || dragging || menu.classList.contains('open')) {
      status.classList.add('pet-status-hidden')
      return
    }
    status.classList.remove('pet-status-hidden')
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = host.getBoundingClientRect()
    const cardW = status.offsetWidth || 160
    const cardH = status.offsetHeight || 60
    const nearLeft = rect.left < cardW / 2 - 8
    const nearRight = rect.right > vw - (cardW / 2 - 8)
    const nearBottom = rect.bottom > vh - cardH - 20 // 下方放不下卡（屏幕边缘）→ 翻上方
    // 翻转/对齐类互斥：先清再设。
    status.classList.remove('pet-status-left', 'pet-status-right', 'pet-status-above')
    if (nearBottom) status.classList.add('pet-status-above')
    if (nearLeft && !nearRight) status.classList.add('pet-status-left')
    else if (nearRight && !nearLeft) status.classList.add('pet-status-right')
  }
  const onHostEnter = () => layoutStatus()
  const onHostLeave = () => {
    if (menu.classList.contains('open')) return
    status.classList.remove('pet-status-left', 'pet-status-right', 'pet-status-above', 'pet-status-hidden')
  }
  host.addEventListener('mouseenter', onHostEnter)
  host.addEventListener('mouseleave', onHostLeave)
  // 气泡出现时让状态卡让位：showReply 后立即重排（气泡是主角）。
  const onBubbleShown = () => {
    if (document.querySelector(':hover') === host) layoutStatus()
  }

  // 菜单开关（同步 aria-expanded；open 缺省时切换）。
  const toggleMenu = (open) => {
    const next = open ?? !menu.classList.contains('open')
    menu.classList.toggle('open', next)
    status.classList.toggle('pet-status-hidden', next)
    host.setAttribute('aria-expanded', String(next))
    if (next) lastActiveAt = Date.now() // 键盘/点击打开菜单也算活跃（防睡着）
    return next
  }

  // ---- 运行时状态 ----
  let pet = null
  let activity = { name: 'idle', until: 0 }
  let manifest = { states: {} }
  // 角色上下文：manifest 角色索引 → 当前角色（whale-girl 默认）。角色 id 决定
  // sheet 的目录前缀（assets/characters/<id>/）；缓存 key 含角色 id 防串图。
  let character = { id: 'whale-girl', states: {} }
  let characterId = 'whale-girl'
  const loaded = new Set() // 已加载成功的 `${id}:${sheet}` 键
  const sheetSize = new Map() // 同上 → { w, h }（自然尺寸）
  let dragging = false
  let pressed = false
  let moved = false
  let transient = null // 'eat' | 'play' | 'wake' | null（点击/睡醒后播一次）
  let transientUntil = 0 // 超时兜底：sheet 缺失/未播完也保证复位
  let joyUntil = 0 // 互动后短时喜悦（JOY_MS）
  let dragReleaseUntil = 0 // 拖拽放下缓冲：短暂回 idle（1.5s）再进入底层状态
  let showingSprite = false // 当前 animState 是否以 sprite 呈现（迟到加载后换肤）
  let lastActiveAt = Date.now()
  let sleeping = false
  let wasSleeping = false // 睡醒过渡（wake 瞬发）触发依据
  let animState = null
  let frame = 0
  let frameDirection = 1
  let idlePausedUntil = 0
  let lastFrameAt = 0
  // 游走（walk）：周期性沿视口底部散步。
  let walking = false
  let walkDir = 1
  let flip = 1 // sprite 水平翻转（scaleX），行走方向
  let wanderTimer = null
  let walkRaf = null
  // 会话感知（P2 思考态）：由 host sessions 服务快照派生的陪伴信号。
  let sessionMood = { thinking: false, waiting: false, titles: [] }
  let sessionsUnsub = null

  // ---- 渲染 ----
  const renderStatus = () => {
    if (pet) {
      metaLv.textContent = `Lv.${pet.level}`
      // 任务计数：失败为 0 时省略「· 0 失败」（保持安静，不抢眼）。
      metaStats.textContent = pet.stats.failures > 0
        ? `${pet.stats.tasksDone} 任务 · ${pet.stats.failures} 失败`
        : `${pet.stats.tasksDone} 任务`
      const last = pet.memory[pet.memory.length - 1]
      metaNote.textContent = last ?? (pet.titles.length > 0 ? `称号「${pet.titles.join('」「')}」` : '…')
    }
  }

  const showEmoji = (name) => {
    // 舞台只承载一个视觉节点；互动 props/气泡放在 effects，不能残留在状态层。
    sprite.classList.remove('ready')
    const emoji = document.createElement('span')
    emoji.className = 'pet-emoji'
    emoji.textContent = emojiFor(character, name) // 角色 emojiOverrides 优先，回退通用表
    stage.replaceChildren(emoji)
  }

  // sheet 缓存键：含角色 id 命名空间（防切角色显示旧图）。
  const sheetKey = (sheet) => `${characterId}:${sheet}`
  // sheet URL：角色目录前缀（assets/characters/<id>/）；角色 id 经 ROLE_ID_RE 校验
  // （parseCharacters 已过滤非法 id），assets 路由另有路径净化兜底。
  const sheetUrl = (sheet) => `${ASSETS_URL}/characters/${characterId}/${sheet}`

  // showSprite 参数名 anim（manifest 状态动画集），避免遮蔽模块级客户端配置 cfg——
  // 曾用 cfg.size（undefined）算 scale → NaN → transform 被浏览器丢弃（尺寸变大 + flip 失效）。
  const showSprite = (name, anim) => {
    const key = sheetKey(anim.sheet)
    const size = sheetSize.get(key)
    if (!size || size.w <= 0 || size.h <= 0) {
      showEmoji(name) // 未声明尺寸的 SVG（naturalWidth=0）→ 兜底，避免除零白屏
      return
    }
    // 清掉前一状态的 emoji/sprite，确保 eat/play 不会在状态结束后残留。
    stage.replaceChildren(sprite)
    const frameW = size.w / anim.frames
    // 目标尺寸用宿主实际盒（--pet-size/配置 size 生效后的真实值），而非状态集里的
    // 悬空 size 字段——配置 size 走 CSS 变量路径，不进 manifest 状态条目。
    const target = host.offsetWidth || 110
    const scale = Math.min(target / frameW, target / size.h, 1)
    sprite.className = 'pet-sprite ready'
    sprite.style.backgroundImage = `url("${sheetUrl(anim.sheet)}")`
    sprite.style.backgroundSize = `${size.w}px ${size.h}px`
    sprite.style.width = `${frameW}px`
    sprite.style.height = `${size.h}px`
    // scaleX(flip) 支持行走方向翻转（方向由游走行为维护，默认 1 不翻转）。
    sprite.style.transform = `scale(${scale}) scaleX(${flip})`
    applyFrame(frameW, frame)
  }

  const applyFrame = (frameW, idx) => {
    sprite.style.backgroundPosition = `-${frameW * idx}px 0`
  }

  const setState = (name) => {
    if (name === animState) return
    animState = name
    frame = 0
    frameDirection = 1
    idlePausedUntil = 0
    lastFrameAt = 0
    // 运动配方：manifest.motion → 舞台类（emoji 与 sprite 路径都生效；无 motion 时清类）。
    // 快照迭代再删：活 DOMTokenList 边遍历边删可能跳项（当前单类无碍，加固免踩）。
    for (const cls of [...stage.classList]) if (cls.startsWith('pet-motion-')) stage.classList.remove(cls)
    const cfg = stateOf(character, name)
    const motion = cfg?.motion
    if (motion) stage.classList.add(`pet-motion-${motion}`)
    if (cfg && loaded.has(sheetKey(cfg.sheet))) {
      showSprite(name, cfg)
      showingSprite = true
    } else {
      showEmoji(name)
      showingSprite = false
    }
    // 状态切换淡入：快速过渡掩盖姿势硬切（sprite 有 opacity transition）。
    stage.style.opacity = '0'
    requestAnimationFrame(() => requestAnimationFrame(() => { stage.style.opacity = '1' }))
  }

  // ---- 资产加载 ----
  // 角色内容 bbox（0-1 归一化比例）：所有状态 sheet 的不透明像素并集——
  // 驱动点击热区贴合角色实际轮廓（四周透明边缘不算可点击，见手测反馈）。
  // 初始为「空」而非「全图」：合并首个真实 bbox 时不被默认值污染。
  let contentBox = null
  const mergeContentBox = (box) => {
    if (contentBox === null) {
      contentBox = { ...box }
      return
    }
    const nx = Math.min(contentBox.x, box.x)
    const ny = Math.min(contentBox.y, box.y)
    const nr = Math.max(contentBox.x + contentBox.w, box.x + box.w)
    const nb = Math.max(contentBox.y + contentBox.h, box.y + box.h)
    contentBox = { x: nx, y: ny, w: nr - nx, h: nb - ny }
  }
  // 应用点击热区：hitarea 层贴合角色内容 bbox（--pet-hit 驱动）。
  // 角色内容约占帧的 74-90%（四周透明边缘），热区收窄到内容——不点透明区。
  const applyHitArea = () => {
    if (hitarea === null) return
    const size = parseFloat(getComputedStyle(host).getPropertyValue('--pet-size')) || 110
    const box = contentBox ?? { x: 0, y: 0, w: 1, h: 1 } // 未分析完成时用全图
    const hitW = Math.max(40, size * box.w)
    const hitH = Math.max(40, size * box.h)
    const offX = (size - hitW) / 2 // 内容居中于 host
    const offY = (size - hitH) / 2
    hitarea.style.left = `${offX}px`
    hitarea.style.top = `${offY}px`
    hitarea.style.width = `${hitW}px`
    hitarea.style.height = `${hitH}px`
  }
  // 换角色/重载时重置内容 bbox（新角色的轮廓不同）。
  const resetContentBox = () => {
    contentBox = null
  }

  // 用离屏 canvas 读 sheet 的不透明像素范围（仅首帧采样，性能可接受）。
  const analyzeSheet = (img, frames) => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const fw = img.naturalWidth / frames
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
    for (let y = 0; y < img.naturalHeight; y++) {
      for (let x = 0; x < img.naturalWidth; x++) {
        if (data[(y * img.naturalWidth + x) * 4 + 3] > 10) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null // 全透明
    return {
      x: minX / img.naturalWidth, y: minY / img.naturalHeight,
      w: (maxX - minX + 1) / img.naturalWidth, h: (maxY - minY + 1) / img.naturalHeight,
    }
  }

  const preload = (name, cfg) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      sheetSize.set(sheetKey(cfg.sheet), { w: img.naturalWidth, h: img.naturalHeight })
      loaded.add(sheetKey(cfg.sheet))
      const box = analyzeSheet(img, cfg.frames)
      if (box !== null) mergeContentBox(box)
      applyHitArea()
      resolve()
    }
    img.onerror = resolve
    img.src = sheetUrl(cfg.sheet)
  })

  const loadAssets = async () => {
    try {
      const res = await fetch(MANIFEST_URL)
      if (!res.ok) return
      const next = await res.json()
      // 结构守卫：manifest 必须是对象且可解析出角色（坏 manifest 不赋值 → 全 emoji 兜底）。
      if (next === null || typeof next !== 'object') return
      manifest = next
      resetContentBox() // 新角色轮廓：重置内容 bbox（preload 逐步合并）
      // 角色解析：默认角色 + 当前角色（localStorage 偏好，ROLE_ID_RE 已由 parseCharacters 过滤）。
      const pref = (() => { try { return localStorage.getItem('dsh-pet:character') ?? null } catch { return null } })()
      const roles = parseCharacters(manifest)
      const nextId = pref !== null && pref in roles.characters ? pref : roles.defaultId
      characterId = nextId
      character = getCharacter(manifest, nextId) ?? { id: nextId, states: {} }
      // 角色尺寸：meta.stageSize 作为 --pet-size 默认（仅用户未配置 size 时生效——
      // 配置系统 size 是权威，lastConfigRevision===0 表示未拉取过配置）。
      const stageSize = character.meta?.stageSize
      if (typeof stageSize === 'number' && lastConfigRevision === 0) {
        host.style.setProperty('--pet-size', `${stageSize}px`)
      }
      await Promise.all(Object.entries(character.states).map(([n, cfg]) => preload(n, cfg)))
    } catch {
      // manifest 不可用 → 全 emoji 兜底
    }
  }

  // 换角色：预加载目标角色全部 sheet → 原子替换（清旧缓存、换 id、复位状态）。
  // 缺 sheet 状态走 emoji 兜底（现有降级机制）；失败时保留当前角色。
  const switchCharacter = async (id) => {
    const target = getCharacter(manifest, id)
    if (target === null || id === characterId) return
    try {
      resetContentBox() // 新角色轮廓：重置内容 bbox
      const nextLoaded = new Set()
      const nextSize = new Map()
      await Promise.all(Object.entries(target.states).map(([n, cfg]) => new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          nextSize.set(`${id}:${cfg.sheet}`, { w: img.naturalWidth, h: img.naturalHeight })
          nextLoaded.add(`${id}:${cfg.sheet}`)
          const box = analyzeSheet(img, cfg.frames)
          if (box !== null) mergeContentBox(box)
          applyHitArea()
          resolve()
        }
        img.onerror = resolve
        img.src = `${ASSETS_URL}/characters/${id}/${cfg.sheet}`
      })))
      // 原子替换
      characterId = id
      character = target
      loaded.clear()
      sheetSize.clear()
      for (const k of nextLoaded) loaded.add(k)
      for (const [k, v] of nextSize) sheetSize.set(k, v)
      // 角色尺寸：meta.stageSize 作为 --pet-size 默认（用户未配置 size 时生效）。
      const stageSize = target.meta?.stageSize
      if (typeof stageSize === 'number' && lastConfigRevision === 0) {
        host.style.setProperty('--pet-size', `${stageSize}px`)
      }
      try { localStorage.setItem('dsh-pet:character', id) } catch { /* 隐私模式忽略 */ }
      transient = null
      transientUntil = 0
      joyUntil = 0
      animState = null // 强制重选状态（下一帧 setState 生效）
      frame = 0
      lastFrameAt = 0
    } catch {
      // 预加载失败：保留当前角色
    }
  }

  // ---- 动画主循环 ----
  // 瞬发复位（eat/play/wake 播完或超时）→ 互动类瞬发后接短时喜悦（joy）。
  const resetTransient = (now) => {
    const wasFun = transient === 'eat' || transient === 'play'
    transient = null
    transientUntil = 0
    if (wasFun) joyUntil = now + JOY_MS
  }
  const tick = () => {
    const now = Date.now()
    // 瞬发动画超时兜底：无论 sheet 是否存在/是否播完，到点必复位（不卡死）。
    if (transient !== null && now >= transientUntil) {
      resetTransient(now)
    }
    const target = pickState({ activity, dragging, walking, transient, sleeping, joyUntil, dragReleaseUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting })
    setState(target)
    const cfg = stateOf(character, animState)
    if (cfg && loaded.has(sheetKey(cfg.sheet))) {
      const size = sheetSize.get(sheetKey(cfg.sheet))
      const frameW = size.w / cfg.frames
      if (!showingSprite) {
        // sprite 迟到加载完成：当前状态仍以 emoji 显示 → 换肤。
        showSprite(animState, cfg)
        showingSprite = true
        frame = 0
        lastFrameAt = 0
      }
      // frames>1 才走帧循环；frames=1 的单图状态由 manifest.motion 的 CSS 动画驱动，不推进帧
      // （否则会推进到 -width 位置闪空白）。
      if (cfg.frames > 1 && now - lastFrameAt >= 1000 / cfg.fps) {
        if (animState === 'idle' && idlePausedUntil > now) return
        if (animState === 'idle' && idlePausedUntil !== 0 && now >= idlePausedUntil) {
          frame = 0
          frameDirection = 1
          idlePausedUntil = 0
          lastFrameAt = now
          applyFrame(frameW, frame)
          return
        }
        lastFrameAt = now
        frame += frameDirection
        if ((animState === 'idle' || animState === 'walk') && cfg.loop && cfg.frames > 1) {
          if (frame >= cfg.frames - 1 || frame <= 0) frameDirection *= -1
          frame = Math.max(0, Math.min(cfg.frames - 1, frame))
          if (animState === 'idle' && frame === 0 && frameDirection === 1) {
            idlePausedUntil = now + cfg.idlePauseMs
          }
        } else if (frame >= cfg.frames) {
          if (cfg.loop) frame = 0
          else {
            frame = cfg.frames - 1
            if (transient !== null && transient !== 'wake') {
              resetTransient(now) // 非循环 sheet 播完即复位（早于超时）
            }
          }
        }
        applyFrame(frameW, frame)
      }
    }
  }

  // ---- 互动 ----
  // 互动爱心爆发：围绕角色本体（stage 中心区域）散开上浮，不贴角。
  // stage 是 position:relative 锚点；偏移取角色所在的中上部区域，避免缩进左上角。
  const spawnHearts = () => {
    for (let i = 0; i < 4; i++) {
      const heart = document.createElement('div')
      heart.className = 'pet-heart'
      heart.textContent = '💗'
      heart.style.left = `${20 + Math.random() * 110}px`
      heart.style.top = `${30 + Math.random() * 80}px`
      effects.appendChild(heart)
      heart.addEventListener('animationend', () => heart.remove())
      // 兜底超时移除：reduced-motion 下动画被禁用（animation: none），
      // animationend 永不触发 → 爱心永久残留 DOM（不可见但泄漏）。
      setTimeout(() => heart.remove(), 2000)
    }
  }

  // 宠物回话气泡（互动后显示，2.5s 消失；超时记入清理表，dispose 时一并清）。
  // 一次只显示一个气泡：新气泡替换旧的（互动回话与回合完成提示不堆叠覆盖——
  // 多会话同时完成时快照循环里后者替换前者，避免同位置重叠）。
  const bubbleTimers = new Set()
  let activeBubble = null
  const clearBubble = () => {
    if (activeBubble !== null) {
      activeBubble.remove()
      activeBubble = null
    }
  }
  const showReply = (text) => {
    clearBubble()
    const bubble = document.createElement('div')
    bubble.className = 'pet-bubble'
    bubble.textContent = text
    effects.appendChild(bubble)
    activeBubble = bubble
    if (typeof onBubbleShown === 'function') onBubbleShown()
    const timer = setTimeout(() => {
      bubbleTimers.delete(timer)
      if (activeBubble === bubble) activeBubble = null
      bubble.remove()
      if (typeof onBubbleShown === 'function') onBubbleShown() // 气泡消失后恢复状态卡
    }, 2500)
    bubbleTimers.add(timer)
  }

  const interact = async (action) => {
    stopWalk() // 互动即停下游走：eat/play 动画期间位置保持不动（点击时 walking 未停会继续移动）
    transient = action === 'feed' ? 'eat' : 'play'
    transientUntil = Date.now() + TRANSIENT_MS
    lastActiveAt = Date.now()
    try {
      const res = await fetch(INTERACT_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) return // 403/413/500 不当作互动成功（不撒心）
      const body = await res.json().catch(() => null)
      if (body?.reply) showReply(body.reply)
      spawnHearts()
    } catch {
      // 瞬态网络错误：下轮轮询会恢复
    }
    await refresh()
  }

  // 互斥：并发 refresh（visibilitychange 与定时器）乱序回写会制造假 wake 边沿。
  let refreshing = false
  // 离线指示：连续失败 ≥3 次后状态条显示离线标记，成功即清除。
  let failStreak = 0
  // 配置热更新：configRevision 门控（变化才拉取/重应用，避免每 3s 重置游走计时器）。
  let lastConfigRevision = 0
  const fetchConfig = async () => {
    try {
      const res = await fetch(CONFIG_PATH)
      if (!res.ok) return null
      const body = await res.json()
      return (body !== null && typeof body === 'object') ? body.config : null
    } catch {
      return null // 瞬态错误：保持当前配置，下轮重试
    }
  }
  // 应用客户端配置：尺寸/透明度走 CSS 变量；游走/睡眠/轮询参数更新 cfg（下次行为生效）。
  const applyClientConfig = (config) => {
    if (config === null || typeof config !== 'object') return
    cfg = { ...CFG_DEFAULTS, ...config }
    if (typeof config.size === 'number') {
      host.style.setProperty('--pet-size', `${config.size}px`)
      // 布局尺寸变化后重新 clamp 位置（防止变大后被推出边缘）。
      if (host.style.left) {
        const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth))
        const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight))
        host.style.left = `${x}px`
        host.style.top = `${y}px`
      }
    }
    if (typeof config.opacity === 'number') host.style.setProperty('--pet-opacity', String(config.opacity))
    scheduleWander() // 游走参数可能变化：重排下一次游走
  }
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      const res = await fetch(STATE_PATH)
      if (!res.ok) throw new Error(`state ${res.status}`)
      const body = await res.json()
      // 结构守卫：pet/activity 缺字段或类型错误时保持上次有效值（响应损坏不崩轮询）。
      if (body !== null && typeof body === 'object' && body.pet !== null && typeof body.pet === 'object') {
        pet = body.pet
      }
      const act = body?.activity
      if (act !== null && typeof act === 'object' && typeof act.name === 'string') {
        activity = act
      }
      if (activity.name !== 'idle' || activity.until > Date.now()) lastActiveAt = Date.now()
      sleeping = activity.name === 'idle' && Date.now() - lastActiveAt > cfg.sleepAfterMs
      // 配置热更新：/state 的 configRevision 变化 → 拉取 /config 应用（尺寸/透明度/游走/睡眠）。
      if (typeof body?.configRevision === 'number' && body.configRevision !== lastConfigRevision) {
        lastConfigRevision = body.configRevision
        const config = await fetchConfig()
        if (config !== null) applyClientConfig(config)
      }
      // 睡醒过渡：sleep → 非 sleep 时播一次 wake（受 TRANSIENT_MS 超时兜底）。
      // wake 不抢占 burst/working：睡醒撞上庆祝/错误/欢迎/工作直接播对应状态，伸懒腰让位。
      if (wasSleeping && !sleeping && transient === null
        && !['welcome', 'celebrate', 'error', 'disappointed', 'working'].includes(activity.name)) {
        transient = 'wake'
        transientUntil = Date.now() + WAKE_MS
      }
      wasSleeping = sleeping
      failStreak = 0
      renderStatus()
    } catch {
      // 瞬态网络错误：保留上次状态；连续失败则提示离线（宠物冻结时用户有感知）。
      failStreak += 1
      if (failStreak >= 3) metaNote.textContent = '📡 离线…'
    } finally {
      refreshing = false
    }
  }

  // ---- 拖拽（pointer 事件；位移 < 6px 视为点击切换菜单）----
  let startX = 0
  let startY = 0
  let lastPointerX = 0
  let offsetX = 0
  let offsetY = 0

  // 位置持久化（localStorage；损坏数据忽略，回退默认右下角）。
  const POS_KEY = 'dsh-pet:pos'
  const savePos = () => {
    try {
      if (host.style.left && host.style.top) {
        localStorage.setItem(POS_KEY, JSON.stringify({ x: parseFloat(host.style.left), y: parseFloat(host.style.top) }))
      }
    } catch {
      // localStorage 不可用（隐私模式）忽略
    }
  }
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null')
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      // 恢复时立即 clamp：窗口变小后直接恢复旧坐标会永久离屏（resize 事件不触发）。
      const x = Math.max(0, Math.min(raw.x, window.innerWidth - host.offsetWidth))
      const y = Math.max(0, Math.min(raw.y, window.innerHeight - host.offsetHeight))
      host.style.left = `${x}px`
      host.style.top = `${y}px`
      host.style.right = 'auto'
      host.style.bottom = 'auto'
    }
  } catch {
    // 损坏数据忽略
  }

  // capture 只在越过拖拽阈值后启用：纯点击不捕获，菜单按钮的 click 正常派发。
  // 热区只绑舞台本体（110×110）：状态条/菜单区不参与拖拽与点击切换，减少误触与遮挡。
  hitarea.addEventListener('pointerdown', (e) => {
    pressed = true
    dragging = false
    moved = false
    stopWalk() // 被拖走即停下游走
    lastActiveAt = Date.now()
    startX = e.clientX
    startY = e.clientY
    lastPointerX = e.clientX
    offsetX = e.clientX - host.offsetLeft
    offsetY = e.clientY - host.offsetTop
  })
  hitarea.addEventListener('pointermove', (e) => {
    if (!pressed) return
    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
      if (!moved) hitarea.setPointerCapture(e.pointerId)
      moved = true
      dragging = true
      // 拖拽打断当前互动：清掉 eat/play/wake 瞬发与互动喜悦——释放后回到拖拽前
      // 的底层状态（如 idle/think），而不是继续播放被打断的 play。
      transient = null
      transientUntil = 0
      joyUntil = 0
      layoutStatus() // 拖拽中隐藏状态卡（宠物是主角，卡片跟随移动会闪）
      const nextFlip = e.clientX < lastPointerX ? -1 : 1
      if (nextFlip !== flip) {
        flip = nextFlip
        const dragCfg = stateOf(character, 'drag')
        if (animState === 'drag' && dragCfg && loaded.has(sheetKey(dragCfg.sheet))) showSprite('drag', dragCfg)
      }
    }
    lastPointerX = e.clientX
    if (!moved) return
    const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth))
    const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
    host.style.right = 'auto'
    host.style.bottom = 'auto'
  })
  hitarea.addEventListener('pointerup', (e) => {
    pressed = false
    dragging = false
    if (hitarea.hasPointerCapture(e.pointerId)) hitarea.releasePointerCapture(e.pointerId)
    if (moved) {
      savePos() // 拖拽结束落盘位置
      dragReleaseUntil = Date.now() + DRAG_RELEASE_MS // 放下缓冲：短暂回 idle
    }
    layoutStatus() // 拖拽结束：状态卡恢复（若仍在 hover）
    // 点菜单按钮不切换菜单（按钮的 click 触发互动）。
    if (!moved && !e.target.closest('button')) toggleMenu()
  })
  hitarea.addEventListener('pointercancel', () => {
    pressed = false
    dragging = false
    moved = false
    layoutStatus()
  })
  // 捕获被系统强制释放（元素移除/其它元素抢捕获）时复位，防拖拽状态卡死。
  hitarea.addEventListener('lostpointercapture', () => {
    pressed = false
    dragging = false
    moved = false
    layoutStatus()
  })
  // 键盘（a11y）：Enter/Space 切换菜单；Esc 关闭；点外部关闭。
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleMenu()
    }
  })
  const onDocPointerDown = (e) => {
    if (!host.contains(e.target)) toggleMenu(false)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') toggleMenu(false)
  }
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeyDown)
  feedBtn.addEventListener('click', () => interact('feed'))
  playBtn.addEventListener('click', () => interact('play'))
  roleBtn.addEventListener('click', () => {
    // 循环切换：当前角色 → 清单中下一个（manifest 已加载时；单角色无操作）。
    const roles = listCharacters(manifest)
    if (roles.length < 2) return
    const idx = roles.indexOf(characterId)
    const next = roles[(idx + 1) % roles.length]
    switchCharacter(next)
    toggleMenu(false)
  })

  // ---- 开放契约（CustomEvent，第三方插件自建缝驱动显示层）----
  // 文档化事件（detail 见 docs/architecture-evolution.md 开放性节）：
  //   dsh-pet:say    { text }          → 气泡说话
  //   dsh-pet:fx     { type: 'hearts' } → 爱心爆发
  //   dsh-pet:status { text }          → 状态卡 note 覆盖（临时，2.5s 恢复）
  // 派发方式：window.dispatchEvent(new CustomEvent('dsh-pet:say', { detail: { text } }))
  // 零耦合：事件在 document 冒泡，第三方无需依赖 dsh-pet 模块；detail 校验后消费。
  const onPetSay = (e) => {
    if (e.detail && typeof e.detail.text === 'string' && e.detail.text.length > 0) showReply(e.detail.text)
  }
  const onPetFx = (e) => {
    if (e.detail?.type === 'hearts') spawnHearts()
  }
  const onPetStatus = (e) => {
    if (e.detail && typeof e.detail.text === 'string') {
      const prev = metaNote.textContent
      metaNote.textContent = e.detail.text
      setTimeout(() => {
        if (metaNote.textContent === e.detail.text) renderStatus()
      }, 2500)
    }
  }
  document.addEventListener('dsh-pet:say', onPetSay)
  document.addEventListener('dsh-pet:fx', onPetFx)
  document.addEventListener('dsh-pet:status', onPetStatus)

  // ---- 游走（walk 行为）：周期性沿视口底部散步 ----
  const stopWalk = () => {
    walking = false
    if (walkRaf !== null) {
      cancelAnimationFrame(walkRaf)
      walkRaf = null
    }
    scheduleWander()
  }
  const scheduleWander = () => {
    clearTimeout(wanderTimer)
    if (!cfg.walk.enabled) return // 游走开关关闭：不排程（walk.enabled 配置）
    const wait = cfg.walk.minWaitMs + Math.random() * (cfg.walk.maxWaitMs - cfg.walk.minWaitMs)
    wanderTimer = setTimeout(() => {
      if (sleeping || sessionMood.thinking || sessionMood.waiting) {
        scheduleWander() // 睡着了或会话活跃（思考陪伴/等待批准）不走，延后重排
        return
      }
      wander()
    }, wait)
  }
  const wander = () => {
    walking = true
    walkDir = Math.random() < 0.5 ? 1 : -1
    flip = walkDir // sprite scaleX 翻转（showSprite 应用）
    // walk 可能已经是当前状态；此时 setState 会短路，必须主动刷新
    // sprite transform，否则新一轮游走仍沿用上一轮朝向。
    const walkCfg = stateOf(character, 'walk')
    if (animState === 'walk' && walkCfg && loaded.has(sheetKey(walkCfg.sheet))) showSprite('walk', walkCfg)
    const duration = cfg.walk.minMs + Math.random() * (cfg.walk.maxMs - cfg.walk.minMs)
    const start = performance.now()
    const maxX = Math.max(0, window.innerWidth - host.offsetWidth)
    const maxY = Math.max(0, window.innerHeight - host.offsetHeight)
    // 从当前位置开始走（不跳位）：垂直保持宠物当前 top，水平从当前 left 起步。
    // 默认锚定（right/bottom 无内联样式）时 getBoundingClientRect 给出真实位置。
    const rect = host.getBoundingClientRect()
    const startLeft = Math.min(Math.max(rect.left, 0), maxX)
    const startTop = Math.min(Math.max(rect.top, 0), maxY)
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    const step = (t) => {
      if (sleeping || dragging || sessionMood.thinking || sessionMood.waiting) {
        stopWalk()
        return
      }
      const x = startLeft + walkDir * cfg.walk.speedPxPerSec * ((t - start) / 1000)
      if (x <= 0 || x >= maxX || t - start >= duration) {
        host.style.left = `${Math.min(maxX, Math.max(0, x))}px`
        host.style.top = `${startTop}px`
        stopWalk()
        return
      }
      host.style.left = `${x}px`
      host.style.top = `${startTop}px`
      walkRaf = requestAnimationFrame(step)
    }
    walkRaf = requestAnimationFrame(step)
  }

  // ---- 启动 ----
  loadAssets()
  refresh()
  const timer = setInterval(refresh, cfg.pollMs)
  const animTimer = setInterval(tick, TICK_MS)
  scheduleWander()

  // ---- 会话感知订阅（P2 思考态）----
  // 订阅 host sessions 列表：任一活跃会话的 running/pending 驱动陪伴状态（think/wait）。
  // sessions 服务由 bundle 导出面 inject 声明等待；缺失时降级——宠物照常跑，只是没有思考陪伴。
  // 回合完成提示：completed 从无到有（翻转）且非当前会话 → 一次气泡轻提示，不重复播报。
  const sessions = ctx.sessions ?? (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined)
  if (sessions?.list && typeof sessions.list.getSnapshot === 'function') {
    const seenCompleted = new Set()
    let seeded = false
    const onSessions = () => {
      try {
        const snap = sessions.list.getSnapshot()
        sessionMood = deriveSessionMood(snap)
        // completed 翻转检测：仅对「从未见过」的 completed 会话播报，且跳过当前会话（用户在看，无需提醒）。
        if (seeded) {
          const byId = snap?.byId ?? {}
          for (const id of Object.keys(byId)) {
            const s = byId[id]
            if (s?.completed === true && !seenCompleted.has(id) && id !== snap?.current) {
              seenCompleted.add(id)
              const title = s.displayTitle ?? id
              showReply(`✨ ${title} 完成了`)
            }
          }
        }
        for (const id of Object.keys(snap?.byId ?? {})) {
          if (snap.byId[id]?.completed === true) seenCompleted.add(id)
        }
        seeded = true
      } catch {
        // 快照异常（服务中途消失）：保留上次 mood，下一轮重试
      }
    }
    onSessions()
    sessionsUnsub = sessions.list.subscribe(onSessions)
  }

  // 回前台立即刷新（后台标签轮询被节流，状态可能陈旧）。
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  document.addEventListener('visibilitychange', onVisibility)

  // 窗口缩放后把已拖拽的位置重新 clamp 进视口，并重算状态卡布局（视口边界变化）。
  const onResize = () => {
    if (!host.style.left) return // 默认右下角锚定无需处理
    const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth))
    const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
    layoutStatus()
  }
  window.addEventListener('resize', onResize)

  // 页面状态感知：DSH 处于初始配置/欢迎页（onboarding）时宠物**完全隐藏**（不遮向导）；
  // 打开 dialog 时宠物降为 inert（半透明、不挡点击）。onboarding 是 CSS module 哈希
  // 类名，用 [class*="onboarding"] 子串匹配；边沿触发只在状态翻转时改属性。
  let pageHidden = false
  const syncInert = () => {
    const onboarding = document.querySelector('[class*="onboarding"]') !== null
    const dialog = document.querySelector('[role="dialog"]') !== null
    const next = onboarding ? 'onboarding' : dialog ? 'dialog' : null
    if (next !== pageHidden) {
      pageHidden = next
      if (next === null) {
        host.removeAttribute('data-dsh-pet-inert')
        host.removeAttribute('data-dsh-pet-hidden')
      } else if (next === 'onboarding') {
        host.removeAttribute('data-dsh-pet-inert')
        host.setAttribute('data-dsh-pet-hidden', '')
      } else {
        host.removeAttribute('data-dsh-pet-hidden')
        host.setAttribute('data-dsh-pet-inert', '')
      }
    }
  }
  const dialogObserver = new MutationObserver(syncInert)
  dialogObserver.observe(document.body, { childList: true, subtree: true })
  syncInert()

  return () => {
    clearInterval(timer)
    clearInterval(animTimer)
    clearTimeout(wanderTimer)
    if (walkRaf !== null) cancelAnimationFrame(walkRaf)
    if (sessionsUnsub !== null) sessionsUnsub()
    for (const t of bubbleTimers) clearTimeout(t) // 气泡残留计时器一并清
    bubbleTimers.clear()
    clearBubble() // 活动气泡引用清空（DOM 随 host.remove() 移除）
    dialogObserver.disconnect()
    document.removeEventListener('pointerdown', onDocPointerDown)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('dsh-pet:say', onPetSay)
    document.removeEventListener('dsh-pet:fx', onPetFx)
    document.removeEventListener('dsh-pet:status', onPetStatus)
    host.removeEventListener('mouseenter', onHostEnter)
    host.removeEventListener('mouseleave', onHostLeave)
    window.removeEventListener('resize', onResize)
    host.remove()
    style.remove()
  }
}

// 加载器契约：id 必须等于插件 id（dsh.plugin.json 的 id）；factory 返回插件导出面。
// inject 声明浏览器 fiber 等待的服务（sessions：会话感知——思考陪伴/等待批准/回合完成提示）。
window.__ModuleLoader__.load({
  id: 'vlln/dsh-pet',
  factory: (require) => ({
    name: 'dsh-pet-client',
    inject: ['sessions'],
    apply,
  }),
})
