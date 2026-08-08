(() => {
  // client/logic.mjs
  var TRANSIENT_MS = 1500;
  var JOY_MS = 3e3;
  var EMOJI = {
    idle: "\u{1F423}",
    working: "\u{1F914}",
    celebrate: "\u{1F389}",
    error: "\u{1F631}",
    disappointed: "\u{1F61E}",
    joy: "\u{1F425}",
    eat: "\u{1F60B}",
    play: "\u{1F3BE}",
    drag: "\u{1F635}",
    sleep: "\u{1F4A4}",
    wake: "\u{1F62A}",
    welcome: "\u{1F44B}"
  };
  function pickState({ activity, dragging, transient, sleeping, joyUntil = 0, now = Date.now() }) {
    if (dragging) return "drag";
    if (transient !== null) return transient;
    if (activity.name !== "idle" && activity.name !== "working" && activity.until > now) {
      return activity.name;
    }
    if (activity.name === "working") return "working";
    if (now < joyUntil) return "joy";
    if (sleeping) return "sleep";
    return "idle";
  }

  // client/index.mjs
  var STATE_PATH = "/plugins/vlln/dsh-pet/state";
  var INTERACT_PATH = "/plugins/vlln/dsh-pet/interact";
  var ASSETS_URL = "/plugins/vlln/dsh-pet/assets";
  var MANIFEST_URL = `${ASSETS_URL}/manifest.json`;
  var POLL_MS = 3e3;
  var TICK_MS = 50;
  var SLEEP_AFTER_MS = 6e4;
  var SPRITE_MAX = 150;
  var CSS = `
[data-dsh-pet] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  font-family: system-ui, sans-serif; user-select: none; cursor: grab; touch-action: none; }
[data-dsh-pet] .pet-stage { width: 96px; height: 96px; display: grid; place-items: center;
  font-size: 56px; line-height: 1; text-align: center; animation: dsh-pet-bob 2s ease-in-out infinite;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25)); }
[data-dsh-pet] .pet-sprite { display: none; background-repeat: no-repeat; }
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
@keyframes dsh-pet-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes dsh-pet-float { 0% { opacity: 1; transform: translateY(0) scale(.7); }
  100% { opacity: 0; transform: translateY(-48px) scale(1.2); } }
@keyframes dsh-pet-pop { from { opacity: 0; transform: translateX(-50%) translateY(4px); } }
`;
  function apply() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    const host = document.createElement("div");
    host.setAttribute("data-dsh-pet", "");
    host.setAttribute("title", "dsh-pet\uFF1A\u70B9\u51FB\u4E92\u52A8\uFF0C\u62D6\u62FD\u79FB\u52A8");
    document.body.appendChild(host);
    const stage = document.createElement("div");
    stage.className = "pet-stage";
    const sprite = document.createElement("div");
    sprite.className = "pet-sprite";
    stage.appendChild(sprite);
    const status = document.createElement("div");
    status.className = "pet-status";
    status.innerHTML = `
    <div class="pet-meta"><span class="pet-lv">Lv.1</span><span class="pet-stats">0 \u4EFB\u52A1</span></div>
    <div class="pet-note">\u2026</div>`;
    const metaLv = status.querySelector(".pet-lv");
    const metaStats = status.querySelector(".pet-stats");
    const metaNote = status.querySelector(".pet-note");
    const menu = document.createElement("div");
    menu.className = "pet-menu";
    const feedBtn = document.createElement("button");
    feedBtn.textContent = "\u{1F357} \u5582\u98DF";
    const playBtn = document.createElement("button");
    playBtn.textContent = "\u{1F3BE} \u73A9\u800D";
    menu.append(feedBtn, playBtn);
    host.append(stage, status, menu);
    let pet = null;
    let activity = { name: "idle", until: 0 };
    let manifest = { states: {} };
    const loaded = /* @__PURE__ */ new Set();
    const sheetSize = /* @__PURE__ */ new Map();
    let dragging = false;
    let moved = false;
    let transient = null;
    let transientUntil = 0;
    let joyUntil = 0;
    let showingSprite = false;
    let lastActiveAt = Date.now();
    let sleeping = false;
    let wasSleeping = false;
    let animState = null;
    let frame = 0;
    let lastFrameAt = 0;
    const renderStatus = () => {
      if (pet) {
        metaLv.textContent = `Lv.${pet.level}`;
        metaStats.textContent = `${pet.stats.tasksDone} \u4EFB\u52A1 \xB7 ${pet.stats.failures} \u5931\u8D25`;
        const last = pet.memory[pet.memory.length - 1];
        metaNote.textContent = last ?? (pet.titles.length > 0 ? `\u79F0\u53F7\u300C${pet.titles.join("\u300D\u300C")}\u300D` : "\u2026");
      }
    };
    const showEmoji = (name) => {
      sprite.classList.remove("ready");
      stage.textContent = EMOJI[name] ?? "\u{1F423}";
    };
    const showSprite = (name, cfg) => {
      const size = sheetSize.get(cfg.sheet);
      if (!size) {
        showEmoji(name);
        return;
      }
      stage.textContent = "";
      const frameW = size.w / cfg.frames;
      const scale = Math.min(SPRITE_MAX / frameW, SPRITE_MAX / size.h, 1);
      sprite.className = "pet-sprite ready";
      sprite.style.backgroundImage = `url("${ASSETS_URL}/${cfg.sheet}")`;
      sprite.style.backgroundSize = `${size.w}px ${size.h}px`;
      sprite.style.width = `${frameW}px`;
      sprite.style.height = `${size.h}px`;
      sprite.style.transform = scale < 1 ? `scale(${scale})` : "none";
      applyFrame(frameW, frame);
    };
    const applyFrame = (frameW, idx) => {
      sprite.style.backgroundPosition = `-${frameW * idx}px 0`;
    };
    const setState = (name) => {
      if (name === animState) return;
      animState = name;
      frame = 0;
      lastFrameAt = 0;
      const cfg = manifest.states[name];
      if (cfg && loaded.has(cfg.sheet)) {
        showSprite(name, cfg);
        showingSprite = true;
      } else {
        showEmoji(name);
        showingSprite = false;
      }
    };
    const preload = (name, cfg) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        sheetSize.set(cfg.sheet, { w: img.naturalWidth, h: img.naturalHeight });
        loaded.add(cfg.sheet);
        resolve();
      };
      img.onerror = resolve;
      img.src = `${ASSETS_URL}/${cfg.sheet}`;
    });
    const loadAssets = async () => {
      try {
        const res = await fetch(MANIFEST_URL);
        if (!res.ok) return;
        manifest = await res.json();
        await Promise.all(Object.entries(manifest.states).map(([n, cfg]) => preload(n, cfg)));
      } catch {
      }
    };
    const resetTransient = (now) => {
      const wasFun = transient === "eat" || transient === "play";
      transient = null;
      transientUntil = 0;
      if (wasFun) joyUntil = now + JOY_MS;
    };
    const tick = () => {
      const now = Date.now();
      if (transient !== null && now >= transientUntil) {
        resetTransient(now);
      }
      const target = pickState({ activity, dragging, transient, sleeping, joyUntil, now });
      setState(target);
      const cfg = manifest.states[animState];
      if (cfg && loaded.has(cfg.sheet)) {
        const size = sheetSize.get(cfg.sheet);
        const frameW = size.w / cfg.frames;
        if (!showingSprite) {
          showSprite(animState, cfg);
          showingSprite = true;
          frame = 0;
          lastFrameAt = 0;
        }
        if (now - lastFrameAt >= 1e3 / cfg.fps) {
          lastFrameAt = now;
          frame += 1;
          if (frame >= cfg.frames) {
            if (cfg.loop) frame = 0;
            else {
              frame = cfg.frames - 1;
              if (transient !== null) {
                resetTransient(now);
              }
            }
          }
          applyFrame(frameW, frame);
        }
      }
    };
    const spawnHearts = () => {
      for (let i = 0; i < 4; i++) {
        const heart = document.createElement("div");
        heart.className = "pet-heart";
        heart.textContent = "\u{1F497}";
        heart.style.left = `${8 + Math.random() * 48}px`;
        heart.style.top = `${8 + Math.random() * 24}px`;
        stage.appendChild(heart);
        heart.addEventListener("animationend", () => heart.remove());
      }
    };
    const showReply = (text) => {
      const bubble = document.createElement("div");
      bubble.className = "pet-bubble";
      bubble.textContent = text;
      stage.appendChild(bubble);
      setTimeout(() => bubble.remove(), 2500);
    };
    const interact = async (action) => {
      transient = action === "feed" ? "eat" : "play";
      transientUntil = Date.now() + TRANSIENT_MS;
      lastActiveAt = Date.now();
      try {
        const res = await fetch(INTERACT_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action })
        });
        const body = await res.json().catch(() => null);
        if (body?.reply) showReply(body.reply);
        spawnHearts();
      } catch {
      }
      await refresh();
    };
    const refresh = async () => {
      try {
        const res = await fetch(STATE_PATH);
        if (!res.ok) return;
        const body = await res.json();
        pet = body.pet;
        activity = body.activity ?? { name: "idle", until: 0 };
        if (activity.name !== "idle" || activity.until > Date.now()) lastActiveAt = Date.now();
        sleeping = activity.name === "idle" && Date.now() - lastActiveAt > SLEEP_AFTER_MS;
        if (wasSleeping && !sleeping && transient === null) {
          transient = "wake";
          transientUntil = Date.now() + TRANSIENT_MS;
        }
        wasSleeping = sleeping;
        renderStatus();
      } catch {
      }
    };
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    host.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      lastActiveAt = Date.now();
      startX = e.clientX;
      startY = e.clientY;
      offsetX = e.clientX - host.offsetLeft;
      offsetY = e.clientY - host.offsetTop;
    });
    host.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
        if (!moved) host.setPointerCapture(e.pointerId);
        moved = true;
      }
      if (!moved) return;
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
    });
    host.addEventListener("pointerup", (e) => {
      dragging = false;
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      if (!moved && !e.target.closest("button")) menu.classList.toggle("open");
    });
    host.addEventListener("pointercancel", () => {
      dragging = false;
      moved = false;
    });
    feedBtn.addEventListener("click", () => interact("feed"));
    playBtn.addEventListener("click", () => interact("play"));
    loadAssets();
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const animTimer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(timer);
      clearInterval(animTimer);
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
