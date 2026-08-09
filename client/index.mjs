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

import { EMOJI, TRANSIENT_MS, WAKE_MS, JOY_MS, pickState, deriveSessionMood } from './logic.mjs'

const STATE_PATH = '/plugins/vlln/dsh-pet/state'
const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'
const ASSETS_URL = '/plugins/vlln/dsh-pet/assets'
const MANIFEST_URL = `${ASSETS_URL}/manifest.json`
const POLL_MS = 3000
const TICK_MS = 50
const SLEEP_AFTER_MS = 60000
const SPRITE_MAX = 150
// 游走行为：每 18~40s 沿视口底部散步 3~6s，速度 45px/s。
const WANDER_MIN_WAIT_MS = 18000
const WANDER_MAX_WAIT_MS = 40000
const WALK_MIN_MS = 3000
const WALK_MAX_MS = 6000
const WALK_SPEED_PX_S = 45
const IDLE_PAUSE_MS = 3500

const CSS = `
[data-dsh-pet] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  font-family: system-ui, sans-serif; user-select: none; cursor: grab; touch-action: none; }
[data-dsh-pet] .pet-stage { position: relative; width: 150px; height: 150px; display: grid; place-items: center;
  font-size: 56px; line-height: 1; text-align: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25)); }
[data-dsh-pet] .pet-sprite { display: none; background-repeat: no-repeat; transition: opacity .12s ease; }
[data-dsh-pet] .pet-sprite.ready { display: block; }
[data-dsh-pet] .pet-status { min-width: 120px; margin-top: 6px; padding: 6px 8px;
  background: rgba(20,20,28,.72); color: #eee; border-radius: 8px; font-size: 11px;
  display: grid; gap: 3px; }
[data-dsh-pet] .pet-bubble { position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%);
  background: rgba(20,20,28,.85); color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 8px;
  white-space: nowrap; pointer-events: none; animation: dsh-pet-pop .25s ease-out; }
[data-dsh-pet] .pet-meta { display: flex; justify-content: space-between; color: rgba(255,255,255,.75); }
[data-dsh-pet] .pet-menu { display: none; margin-top: 6px; gap: 6px; padding: 6px; border-radius: 8px;
  background: rgba(20,20,28,.72); }
[data-dsh-pet] .pet-menu.open { display: flex; }
[data-dsh-pet] .pet-menu button { flex: 1; border: 0; border-radius: 6px; padding: 4px 8px;
  font-size: 12px; cursor: pointer; background: rgba(255,255,255,.14); color: #fff; }
[data-dsh-pet] .pet-menu button:hover { background: rgba(255,255,255,.28); }
[data-dsh-pet] .pet-heart { position: absolute; font-size: 18px; pointer-events: none;
  animation: dsh-pet-float 1s ease-out forwards; }
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
  100% { opacity: 0; transform: translateY(-48px) scale(1.2); } }
@keyframes dsh-pet-pop { from { opacity: 0; transform: translateX(-50%) translateY(4px); } }
[data-dsh-pet][data-dsh-pet-inert] { opacity: .25; pointer-events: none; }
[data-dsh-pet] .pet-stage:focus-visible { outline: 2px solid rgba(255,255,255,.6); outline-offset: 2px; border-radius: 8px; }
@media (prefers-reduced-motion: reduce) {
  [data-dsh-pet] .pet-stage { animation: none !important; }
  [data-dsh-pet] .pet-sprite { animation: none !important; }
  [data-dsh-pet] .pet-heart { animation: none; opacity: 0; }
  [data-dsh-pet] .pet-bubble { animation: none; }
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
  host.setAttribute('title', 'dsh-pet：点击互动，拖拽移动')
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
  menu.append(feedBtn, playBtn)

  host.append(stage, status, menu)

  // 菜单开关（同步 aria-expanded；open 缺省时切换）。
  const toggleMenu = (open) => {
    const next = open ?? !menu.classList.contains('open')
    menu.classList.toggle('open', next)
    host.setAttribute('aria-expanded', String(next))
    if (next) lastActiveAt = Date.now() // 键盘/点击打开菜单也算活跃（防睡着）
    return next
  }

  // ---- 运行时状态 ----
  let pet = null
  let activity = { name: 'idle', until: 0 }
  let manifest = { states: {} }
  const loaded = new Set() // 已加载成功的 sheet 名
  const sheetSize = new Map() // sheet 名 → { w, h }（自然尺寸）
  let dragging = false
  let pressed = false
  let moved = false
  let transient = null // 'eat' | 'play' | 'wake' | null（点击/睡醒后播一次）
  let transientUntil = 0 // 超时兜底：sheet 缺失/未播完也保证复位
  let joyUntil = 0 // 互动后短时喜悦（JOY_MS）
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
      metaStats.textContent = `${pet.stats.tasksDone} 任务 · ${pet.stats.failures} 失败`
      const last = pet.memory[pet.memory.length - 1]
      metaNote.textContent = last ?? (pet.titles.length > 0 ? `称号「${pet.titles.join('」「')}」` : '…')
    }
  }

  const showEmoji = (name) => {
    sprite.classList.remove('ready')
    stage.textContent = EMOJI[name] ?? '🐣'
  }

  const showSprite = (name, cfg) => {
    const size = sheetSize.get(cfg.sheet)
    if (!size || size.w <= 0 || size.h <= 0) {
      showEmoji(name) // 未声明尺寸的 SVG（naturalWidth=0）→ 兜底，避免除零白屏
      return
    }
    // replaceChildren(sprite)：清掉 emoji 文本等其它子节点，并确保 sprite 在 DOM 里
    // （textContent='' 会把 sprite 也摘掉，样式作用在脱离 DOM 的节点上——空舞台 bug）。
    stage.replaceChildren(sprite)
    const frameW = size.w / cfg.frames
    const scale = Math.min(SPRITE_MAX / frameW, SPRITE_MAX / size.h, 1)
    sprite.className = 'pet-sprite ready'
    sprite.style.backgroundImage = `url("${ASSETS_URL}/${cfg.sheet}")`
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
    const motion = manifest.states[name]?.motion
    if (motion) stage.classList.add(`pet-motion-${motion}`)
    const cfg = manifest.states[name]
    if (cfg && loaded.has(cfg.sheet)) {
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
  const preload = (name, cfg) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      sheetSize.set(cfg.sheet, { w: img.naturalWidth, h: img.naturalHeight })
      loaded.add(cfg.sheet)
      resolve()
    }
    img.onerror = resolve
    img.src = `${ASSETS_URL}/${cfg.sheet}`
  })

  const loadAssets = async () => {
    try {
      const res = await fetch(MANIFEST_URL)
      if (!res.ok) return
      const next = await res.json()
      // 结构守卫：states 必须是对象（坏 manifest 不赋值，保持上次有效值或空对象 → 全 emoji 兜底）。
      if (next === null || typeof next !== 'object' || next.states === null || typeof next.states !== 'object' || Array.isArray(next.states)) return
      manifest = next
      await Promise.all(Object.entries(manifest.states).map(([n, cfg]) => preload(n, cfg)))
    } catch {
      // manifest 不可用 → 全 emoji 兜底
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
    const target = pickState({ activity, dragging, walking, transient, sleeping, joyUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting })
    setState(target)
    const states = manifest.states
    const cfg = states === undefined || states === null ? undefined : states[animState]
    if (cfg && loaded.has(cfg.sheet)) {
      const size = sheetSize.get(cfg.sheet)
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
            idlePausedUntil = now + IDLE_PAUSE_MS
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
      stage.appendChild(heart)
      heart.addEventListener('animationend', () => heart.remove())
      // 兜底超时移除：reduced-motion 下动画被禁用（animation: none），
      // animationend 永不触发 → 爱心永久残留 DOM（不可见但泄漏）。
      setTimeout(() => heart.remove(), 1100)
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
    stage.appendChild(bubble)
    activeBubble = bubble
    const timer = setTimeout(() => {
      bubbleTimers.delete(timer)
      if (activeBubble === bubble) activeBubble = null
      bubble.remove()
    }, 2500)
    bubbleTimers.add(timer)
  }

  const interact = async (action) => {
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
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      const res = await fetch(STATE_PATH)
      if (!res.ok) throw new Error(`state ${res.status}`)
      const body = await res.json()
      pet = body.pet
      activity = body.activity ?? { name: 'idle', until: 0 }
      if (activity.name !== 'idle' || activity.until > Date.now()) lastActiveAt = Date.now()
      sleeping = activity.name === 'idle' && Date.now() - lastActiveAt > SLEEP_AFTER_MS
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
  host.addEventListener('pointerdown', (e) => {
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
  host.addEventListener('pointermove', (e) => {
    if (!pressed) return
    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
      if (!moved) host.setPointerCapture(e.pointerId)
      moved = true
      dragging = true
      const nextFlip = e.clientX < lastPointerX ? -1 : 1
      if (nextFlip !== flip) {
        flip = nextFlip
        const dragCfg = manifest.states.drag
        if (animState === 'drag' && dragCfg && loaded.has(dragCfg.sheet)) showSprite('drag', dragCfg)
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
  host.addEventListener('pointerup', (e) => {
    pressed = false
    dragging = false
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
    if (moved) savePos() // 拖拽结束落盘位置
    // 点菜单按钮不切换菜单（按钮的 click 触发互动）。
    if (!moved && !e.target.closest('button')) toggleMenu()
  })
  host.addEventListener('pointercancel', () => {
    pressed = false
    dragging = false
    moved = false
  })
  // 捕获被系统强制释放（元素移除/其它元素抢捕获）时复位，防拖拽状态卡死。
  host.addEventListener('lostpointercapture', () => {
    pressed = false
    dragging = false
    moved = false
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
    const wait = WANDER_MIN_WAIT_MS + Math.random() * (WANDER_MAX_WAIT_MS - WANDER_MIN_WAIT_MS)
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
    const walkCfg = manifest.states.walk
    if (animState === 'walk' && walkCfg && loaded.has(walkCfg.sheet)) showSprite('walk', walkCfg)
    const duration = WALK_MIN_MS + Math.random() * (WALK_MAX_MS - WALK_MIN_MS)
    const start = performance.now()
    const maxX = Math.max(0, window.innerWidth - host.offsetWidth)
    const bottomY = Math.max(0, window.innerHeight - host.offsetHeight - 16)
    const savedLeft = parseFloat(host.style.left)
    const startLeft = Math.min(Math.max(Number.isFinite(savedLeft) ? savedLeft : maxX - 16, 0), maxX)
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    const step = (t) => {
      if (sleeping || dragging || sessionMood.thinking || sessionMood.waiting) {
        stopWalk()
        return
      }
      const x = startLeft + walkDir * WALK_SPEED_PX_S * ((t - start) / 1000)
      if (x <= 0 || x >= maxX || t - start >= duration) {
        host.style.left = `${Math.min(maxX, Math.max(0, x))}px`
        host.style.top = `${bottomY}px`
        stopWalk()
        return
      }
      host.style.left = `${x}px`
      host.style.top = `${bottomY}px`
      walkRaf = requestAnimationFrame(step)
    }
    walkRaf = requestAnimationFrame(step)
  }

  // ---- 启动 ----
  loadAssets()
  refresh()
  const timer = setInterval(refresh, POLL_MS)
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

  // 窗口缩放后把已拖拽的位置重新 clamp 进视口。
  const onResize = () => {
    if (!host.style.left) return // 默认右下角锚定无需处理
    const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth))
    const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
  }
  window.addEventListener('resize', onResize)

  // 弹窗感知：DSH 打开 dialog 时宠物降为 inert（不遮挡、不拦截点击）。
  // 边沿触发：只在 dialog 存在状态翻转时改属性——聊天 GUI 高频增删节点时不全量重扫。
  let dialogOpen = false
  const syncInert = () => {
    const open = document.querySelector('[role="dialog"]') !== null
    if (open !== dialogOpen) {
      dialogOpen = open
      host.toggleAttribute('data-dsh-pet-inert', open)
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
