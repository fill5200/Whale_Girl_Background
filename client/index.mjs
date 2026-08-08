// dsh-pet 浏览器 half：纯 DOM 自渲染宠物层（A 模式——GUI 内悬浮宠物）。
// 契约：bundle 顶层调用 window.__ModuleLoader__.load({ id, factory })——id 必须等于插件 id
// （dsh.plugin.json 的 id），否则 loader 的 arrive() 抛 "loaded without registering"；
// factory(require) 返回 Cordis 插件导出面（name/inject/apply）；apply 返回 disposer，
// 绑定插件 fiber，disable 时清理。零平台模块依赖：CSS 内联注入，动画/拖拽/菜单全部自建。
//
// 视觉：sprite sheet 帧播放器（assets/manifest.json 声明 状态→sheet/frames/fps/loop，
// 每状态一张横排帧图，透明背景）；sheet 缺失/未加载时用 emoji 兜底，增量替换。
// 状态选择优先级：drag > 瞬发 eat/play > burst(celebrate/error) > working > sleep > hungry/sad > idle。

const STATE_PATH = '/plugins/vlln/dsh-pet/state'
const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'
const ASSETS_URL = '/plugins/vlln/dsh-pet/assets'
const MANIFEST_URL = `${ASSETS_URL}/manifest.json`
const POLL_MS = 3000
const TICK_MS = 50
const SLEEP_AFTER_MS = 60000
const SPRITE_MAX = 150

// 表情兜底（sheet 缺失/加载失败时）。
const EMOJI = {
  idle: '🐣', happy: '🐥', hungry: '🥺', sad: '😞', eat: '😋', play: '🎾',
  drag: '😵', sleep: '💤', working: '🤔', celebrate: '🎉', error: '😱',
}

const CSS = `
[data-dsh-pet] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  font-family: system-ui, sans-serif; user-select: none; cursor: grab; }
[data-dsh-pet] .pet-stage { width: 96px; height: 96px; display: grid; place-items: center;
  font-size: 56px; line-height: 1; text-align: center; animation: dsh-pet-bob 2s ease-in-out infinite;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25)); }
[data-dsh-pet] .pet-sprite { display: none; background-repeat: no-repeat; }
[data-dsh-pet] .pet-sprite.ready { display: block; }
[data-dsh-pet] .pet-status { min-width: 120px; margin-top: 6px; padding: 6px 8px;
  background: rgba(20,20,28,.72); color: #eee; border-radius: 8px; font-size: 11px;
  display: grid; gap: 3px; }
[data-dsh-pet] .pet-bar { height: 5px; border-radius: 3px; background: rgba(255,255,255,.18); overflow: hidden; }
[data-dsh-pet] .pet-bar > i { display: block; height: 100%; border-radius: 3px; transition: width .4s ease; }
[data-dsh-pet] .pet-bar.satiety > i { background: #4ade80; }
[data-dsh-pet] .pet-bar.mood > i { background: #facc15; }
[data-dsh-pet] .pet-meta { display: flex; justify-content: space-between; color: rgba(255,255,255,.75); }
[data-dsh-pet] .pet-menu { display: none; margin-top: 6px; gap: 6px; }
[data-dsh-pet] .pet-menu.open { display: flex; }
[data-dsh-pet] .pet-menu button { flex: 1; border: 0; border-radius: 6px; padding: 4px 8px;
  font-size: 12px; cursor: pointer; background: rgba(255,255,255,.14); color: #fff; }
[data-dsh-pet] .pet-menu button:hover { background: rgba(255,255,255,.28); }
[data-dsh-pet] .pet-heart { position: absolute; font-size: 18px; pointer-events: none;
  animation: dsh-pet-float 1s ease-out forwards; }
@keyframes dsh-pet-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes dsh-pet-float { 0% { opacity: 1; transform: translateY(0) scale(.7); }
  100% { opacity: 0; transform: translateY(-48px) scale(1.2); } }
`

/** 状态选择：返回当前应播放的动画状态名。 */
function pickState({ activity, pet, dragging, transient, sleeping }) {
  if (dragging) return 'drag'
  if (transient !== null) return transient
  const now = Date.now()
  if (activity.name === 'celebrate' && activity.until > now) return 'celebrate'
  if (activity.name === 'error' && activity.until > now) return 'error'
  if (activity.name === 'working') return 'working'
  if (sleeping) return 'sleep'
  if (pet && pet.hunger > 70) return 'hungry'
  if (pet && pet.mood < 30) return 'sad'
  return 'idle'
}

export function apply() {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const host = document.createElement('div')
  host.setAttribute('data-dsh-pet', '')
  host.setAttribute('title', 'dsh-pet：点击互动，拖拽移动')
  host.style.position = 'relative'
  document.body.appendChild(host)

  const stage = document.createElement('div')
  stage.className = 'pet-stage'
  const sprite = document.createElement('div')
  sprite.className = 'pet-sprite'
  stage.appendChild(sprite)

  const status = document.createElement('div')
  status.className = 'pet-status'
  status.innerHTML = `
    <div class="pet-bar satiety"><i style="width:0%"></i></div>
    <div class="pet-bar mood"><i style="width:0%"></i></div>
    <div class="pet-meta"><span class="pet-lv">Lv.1</span><span class="pet-note">…</span></div>`
  const barSatiety = status.querySelector('.pet-bar.satiety > i')
  const barMood = status.querySelector('.pet-bar.mood > i')
  const metaLv = status.querySelector('.pet-lv')
  const metaNote = status.querySelector('.pet-note')

  const menu = document.createElement('div')
  menu.className = 'pet-menu'
  const feedBtn = document.createElement('button')
  feedBtn.textContent = '🍗 喂食'
  const playBtn = document.createElement('button')
  playBtn.textContent = '🎾 玩耍'
  menu.append(feedBtn, playBtn)

  host.append(stage, status, menu)

  // ---- 运行时状态 ----
  let pet = null
  let activity = { name: 'idle', until: 0 }
  let manifest = { states: {} }
  const loaded = new Set() // 已加载成功的 sheet 名
  const sheetSize = new Map() // sheet 名 → { w, h }（自然尺寸）
  let dragging = false
  let moved = false
  let transient = null // 'eat' | 'play' | null（点击后播一次）
  let lastActiveAt = Date.now()
  let sleeping = false
  let animState = null
  let frame = 0
  let lastFrameAt = 0

  // ---- 渲染 ----
  const renderStatus = () => {
    if (pet) {
      barSatiety.style.width = `${Math.round(100 - pet.hunger)}%`
      barMood.style.width = `${Math.round(pet.mood)}%`
      metaLv.textContent = `Lv.${pet.level}`
      metaNote.textContent = `饱 ${Math.round(100 - pet.hunger)}% 心 ${Math.round(pet.mood)}`
    }
  }

  const showEmoji = (name) => {
    sprite.classList.remove('ready')
    stage.textContent = EMOJI[name] ?? '🐣'
  }

  const showSprite = (name, cfg) => {
    const size = sheetSize.get(cfg.sheet)
    if (!size) {
      showEmoji(name)
      return
    }
    stage.textContent = ''
    const frameW = size.w / cfg.frames
    const scale = Math.min(SPRITE_MAX / frameW, SPRITE_MAX / size.h, 1)
    sprite.className = 'pet-sprite ready'
    sprite.style.backgroundImage = `url("${ASSETS_URL}/${cfg.sheet}")`
    sprite.style.backgroundSize = `${size.w}px ${size.h}px`
    sprite.style.width = `${frameW}px`
    sprite.style.height = `${size.h}px`
    sprite.style.transform = scale < 1 ? `scale(${scale})` : 'none'
    applyFrame(frameW, frame)
  }

  const applyFrame = (frameW, idx) => {
    sprite.style.backgroundPosition = `-${frameW * idx}px 0`
  }

  const setState = (name) => {
    if (name === animState) return
    animState = name
    frame = 0
    lastFrameAt = 0
    const cfg = manifest.states[name]
    if (cfg && loaded.has(cfg.sheet)) showSprite(name, cfg)
    else showEmoji(name)
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
      manifest = await res.json()
      await Promise.all(Object.entries(manifest.states).map(([n, cfg]) => preload(n, cfg)))
    } catch {
      // manifest 不可用 → 全 emoji 兜底
    }
  }

  // ---- 动画主循环 ----
  const tick = () => {
    const now = Date.now()
    const target = pickState({ activity, pet, dragging, transient, sleeping })
    setState(target)
    const cfg = manifest.states[animState]
    if (cfg && loaded.has(cfg.sheet)) {
      const size = sheetSize.get(cfg.sheet)
      const frameW = size.w / cfg.frames
      if (now - lastFrameAt >= 1000 / cfg.fps) {
        lastFrameAt = now
        frame += 1
        if (frame >= cfg.frames) {
          if (cfg.loop) frame = 0
          else {
            frame = cfg.frames - 1
            if (transient !== null) transient = null // 瞬发动画播完回到派生状态
          }
        }
        applyFrame(frameW, frame)
      }
    }
  }

  // ---- 互动 ----
  const spawnHearts = () => {
    for (let i = 0; i < 4; i++) {
      const heart = document.createElement('div')
      heart.className = 'pet-heart'
      heart.textContent = '💗'
      heart.style.left = `${8 + Math.random() * 48}px`
      heart.style.top = `${8 + Math.random() * 24}px`
      stage.appendChild(heart)
      heart.addEventListener('animationend', () => heart.remove())
    }
  }

  const interact = async (action) => {
    transient = action === 'feed' ? 'eat' : 'play'
    lastActiveAt = Date.now()
    try {
      await fetch(INTERACT_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      spawnHearts()
    } catch {
      // 瞬态网络错误：下轮轮询会恢复
    }
    await refresh()
  }

  const refresh = async () => {
    try {
      const res = await fetch(STATE_PATH)
      if (!res.ok) return
      const body = await res.json()
      pet = body.pet
      activity = body.activity ?? { name: 'idle', until: 0 }
      if (activity.name !== 'idle' || activity.until > Date.now()) lastActiveAt = Date.now()
      sleeping = activity.name === 'idle' && Date.now() - lastActiveAt > SLEEP_AFTER_MS
      renderStatus()
    } catch {
      // 瞬态网络错误：保留上次状态
    }
  }

  // ---- 拖拽（pointer 事件；位移 < 6px 视为点击切换菜单）----
  let startX = 0
  let startY = 0
  let offsetX = 0
  let offsetY = 0

  host.addEventListener('pointerdown', (e) => {
    dragging = true
    moved = false
    lastActiveAt = Date.now()
    startX = e.clientX
    startY = e.clientY
    offsetX = e.clientX - host.offsetLeft
    offsetY = e.clientY - host.offsetTop
    host.setPointerCapture(e.pointerId)
  })
  host.addEventListener('pointermove', (e) => {
    if (!dragging) return
    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) moved = true
    if (!moved) return
    const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth))
    const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
    host.style.right = 'auto'
    host.style.bottom = 'auto'
  })
  host.addEventListener('pointerup', () => {
    dragging = false
    if (!moved) menu.classList.toggle('open')
  })
  feedBtn.addEventListener('click', () => interact('feed'))
  playBtn.addEventListener('click', () => interact('play'))

  // ---- 启动 ----
  loadAssets()
  refresh()
  const timer = setInterval(refresh, POLL_MS)
  const animTimer = setInterval(tick, TICK_MS)

  return () => {
    clearInterval(timer)
    clearInterval(animTimer)
    host.remove()
    style.remove()
  }
}

// 加载器契约：id 必须等于插件 id（dsh.plugin.json 的 id）；factory 返回插件导出面。
window.__ModuleLoader__.load({
  id: 'vlln/dsh-pet',
  factory: (require) => ({
    name: 'dsh-pet-client',
    inject: [],
    apply,
  }),
})
