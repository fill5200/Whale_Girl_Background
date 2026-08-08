(() => {
  // client/index.mjs
  var STATE_PATH = "/plugins/vlln/dsh-pet/state";
  var INTERACT_PATH = "/plugins/vlln/dsh-pet/interact";
  var POLL_MS = 3e3;
  var CSS = `
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
`;
  function faceFor(state) {
    if (!state) return "\u{1F423}";
    if (state.hunger > 70) return "\u{1F97A}";
    if (state.mood < 30) return "\u{1F61E}";
    if (state.level >= 2) return "\u{1F425}";
    return "\u{1F423}";
  }
  function apply() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    const host = document.createElement("div");
    host.setAttribute("data-dsh-pet", "");
    host.setAttribute("title", "dsh-pet\uFF1A\u70B9\u51FB\u4E92\u52A8\uFF0C\u62D6\u62FD\u79FB\u52A8");
    document.body.appendChild(host);
    const face = document.createElement("div");
    face.className = "pet-face";
    face.textContent = "\u{1F423}";
    const status = document.createElement("div");
    status.className = "pet-status";
    status.innerHTML = `
    <div class="pet-bar satiety"><i style="width:0%"></i></div>
    <div class="pet-bar mood"><i style="width:0%"></i></div>
    <div class="pet-meta"><span class="pet-lv">Lv.1</span><span class="pet-note">\u2026</span></div>`;
    const barSatiety = status.querySelector(".pet-bar.satiety > i");
    const barMood = status.querySelector(".pet-bar.mood > i");
    const metaLv = status.querySelector(".pet-lv");
    const metaNote = status.querySelector(".pet-note");
    const menu = document.createElement("div");
    menu.className = "pet-menu";
    const feedBtn = document.createElement("button");
    feedBtn.textContent = "\u{1F357} \u5582\u98DF";
    const playBtn = document.createElement("button");
    playBtn.textContent = "\u{1F3BE} \u73A9\u800D";
    menu.append(feedBtn, playBtn);
    host.append(face, status, menu);
    let state = null;
    const render = () => {
      face.textContent = faceFor(state);
      if (state) {
        barSatiety.style.width = `${Math.round(100 - state.hunger)}%`;
        barMood.style.width = `${Math.round(state.mood)}%`;
        metaLv.textContent = `Lv.${state.level}`;
        metaNote.textContent = state.xp >= 0 ? `\u9971 ${Math.round(100 - state.hunger)}% \u5FC3 ${Math.round(state.mood)}` : "";
      }
    };
    const interact = async (action) => {
      try {
        await fetch(INTERACT_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action })
        });
      } catch {
      }
      await refresh();
    };
    const refresh = async () => {
      try {
        const res = await fetch(STATE_PATH);
        if (!res.ok) return;
        state = (await res.json()).pet;
        render();
      } catch {
      }
    };
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    host.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      offsetX = e.clientX - host.offsetLeft;
      offsetY = e.clientY - host.offsetTop;
      host.setPointerCapture(e.pointerId);
    });
    host.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) moved = true;
      if (!moved) return;
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
    });
    host.addEventListener("pointerup", () => {
      dragging = false;
      if (!moved) menu.classList.toggle("open");
    });
    feedBtn.addEventListener("click", () => interact("feed"));
    playBtn.addEventListener("click", () => interact("play"));
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      host.remove();
      style.remove();
    };
  }
  window.__ModuleLoader__.load({
    id: "vlln/dsh-pet",
    factory: (require2) => ({
      name: "dsh-pet-client",
      inject: [],
      apply
    })
  });
})();
