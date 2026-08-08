// dsh-pet 浏览器 half：纯 DOM 自渲染宠物层（A 模式——GUI 内悬浮宠物）。
// 契约：bundle 顶层调用 window.__ModuleLoader__.load({ id, factory })——id 必须等于插件 id
// （dsh.plugin.json 的 id），否则 loader 的 arrive() 抛 "loaded without registering"；
// factory(require) 返回 Cordis 插件导出面（name/inject/apply）；apply 返回 disposer，
// 绑定插件 fiber，disable 时清理。零平台模块依赖：CSS 内联注入，动画/拖拽/菜单全部自建。

const STATE_PATH = '/plugins/vlln/dsh-pet/state'
const INTERACT_PATH = '/plugins/vlln/dsh-pet/interact'
const POLL_MS = 3000

const CSS = `
[data-dsh-pet] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  font-family: system-ui, sans-serif; user-select: none; cursor: grab; }
[data-dsh-pet] .pet-face { font-size: 56px; line-height: 1; text-align: center;
  animation: dsh-pet-bob 2s ease-in-out infinite; filter: drop-shadow(0 4px 6px rgba(0,0,0,.25)); }
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
@keyframes dsh-pet-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
`

/** 按状态选表情：饿极优先，其次低落，再次按等级成长。 */
function faceFor(state) {
  if (!state) return '🐣'
  if (state.hunger > 70) return '🥺'
  if (state.mood < 30) return '😞'
  if (state.level >= 2) return '🐥'
  return '🐣'
}

function apply() {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const host = document.createElement('div')
  host.setAttribute('data-dsh-pet', '')
  host.setAttribute('title', 'dsh-pet：点击互动，拖拽移动')
  document.body.appendChild(host)

  const face = document.createElement('div')
  face.className = 'pet-face'
  face.textContent = '🐣'

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

  host.append(face, status, menu)

  let state = null
  const render = () => {
    face.textContent = faceFor(state)
    if (state) {
      barSatiety.style.width = `${Math.round(100 - state.hunger)}%`
      barMood.style.width = `${Math.round(state.mood)}%`
      metaLv.textContent = `Lv.${state.level}`
      metaNote.textContent = state.xp >= 0 ? `饱 ${Math.round(100 - state.hunger)}% 心 ${Math.round(state.mood)}` : ''
    }
  }

  const interact = async (action) => {
    try {
      await fetch(INTERACT_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    } catch {
      // 瞬态网络错误：下轮轮询会恢复
    }
    await refresh()
  }

  const refresh = async () => {
    try {
      const res = await fetch(STATE_PATH)
      if (!res.ok) return
      state = (await res.json()).pet
      render()
    } catch {
      // 瞬态网络错误：保留上次状态
    }
  }

  // 拖拽（pointer 事件；位移 < 6px 视为点击切换菜单）
  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let offsetX = 0
  let offsetY = 0

  host.addEventListener('pointerdown', (e) => {
    dragging = true
    moved = false
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

  refresh()
  const timer = setInterval(refresh, POLL_MS)

  return () => {
    clearInterval(timer)
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
