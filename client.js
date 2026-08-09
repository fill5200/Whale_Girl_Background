(() => {
  // client/logic.mjs
  var TRANSIENT_MS = 1500;
  var WAKE_MS = 3e3;
  var JOY_MS = 1600;
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
    walk: "\u{1F6B6}",
    sleep: "\u{1F4A4}",
    wake: "\u{1F62A}",
    welcome: "\u{1F44B}",
    think: "\u{1F4AD}",
    wait: "\u{1F440}"
  };
  var STATE_TABLE = [
    { state: "drag", when: (c) => c.dragging },
    // 事件 burst（welcome/celebrate/error/disappointed）：Node half 窗口级联输出，until 有效期内优先。
    { state: "burst", when: (c) => c.activity.name !== "idle" && c.activity.name !== "working" && c.activity.until > c.now, resolve: (c) => c.activity.name },
    { state: "eat", when: (c) => c.transient === "eat" },
    { state: "play", when: (c) => c.transient === "play" },
    { state: "wake", when: (c) => c.transient === "wake" },
    { state: "wait", when: (c) => c.sessionWait },
    { state: "think", when: (c) => c.sessionThink },
    { state: "working", when: (c) => c.activity.name === "working" },
    { state: "joy", when: (c) => c.now < c.joyUntil },
    { state: "sleep", when: (c) => c.sleeping },
    { state: "walk", when: (c) => c.walking },
    { state: "idle", when: () => true }
  ];
  function pickState(input) {
    const ctx = { ...input, now: input.now ?? Date.now(), joyUntil: input.joyUntil ?? 0, sessionThink: input.sessionThink ?? false, sessionWait: input.sessionWait ?? false };
    for (const row of STATE_TABLE) {
      if (row.when(ctx)) return row.resolve ? row.resolve(ctx) : row.state;
    }
    return "idle";
  }
  function deriveSessionMood(snapshot) {
    const byId = snapshot?.byId ?? {};
    let thinking = false;
    let waiting = false;
    const titles = [];
    for (const id of Object.keys(byId)) {
      const s = byId[id];
      if (s === void 0 || s === null) continue;
      if (s.running === true) {
        thinking = true;
        titles.push(s.displayTitle ?? id);
      }
      if (s.pendingInteraction !== void 0) waiting = true;
    }
    return { thinking, waiting, titles };
  }

  // client/character.mjs
  var DEFAULT_ROLE_ID = "whale-girl";
  function parseCharacters(manifest) {
    const raw = manifest?.characters;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const characters = {};
      for (const [id, ch] of Object.entries(raw)) {
        if (ch === null || typeof ch !== "object") continue;
        characters[id] = {
          id,
          name: typeof ch.name === "string" ? ch.name : id,
          credit: typeof ch.credit === "string" ? ch.credit : void 0,
          meta: ch.meta !== null && typeof ch.meta === "object" ? ch.meta : {},
          states: ch.states !== null && typeof ch.states === "object" ? ch.states : {}
        };
      }
      const defaultId = typeof manifest.default === "string" && manifest.default in characters ? manifest.default : Object.keys(characters)[0] ?? DEFAULT_ROLE_ID;
      return { characters, defaultId };
    }
    return {
      characters: {
        [DEFAULT_ROLE_ID]: {
          id: DEFAULT_ROLE_ID,
          name: DEFAULT_ROLE_ID,
          credit: void 0,
          meta: {},
          states: manifest?.states !== null && typeof manifest?.states === "object" ? manifest.states : {}
        }
      },
      defaultId: DEFAULT_ROLE_ID
    };
  }
  function listCharacters(manifest) {
    return Object.keys(parseCharacters(manifest).characters);
  }
  function getCharacter(manifest, id) {
    return parseCharacters(manifest).characters[id] ?? null;
  }
  function stateOf(character, stateName) {
    return character?.states?.[stateName];
  }
  function emojiFor(character, stateName) {
    const overrides = character?.meta?.emojiOverrides;
    if (overrides !== null && typeof overrides === "object" && typeof overrides[stateName] === "string") {
      return overrides[stateName];
    }
    return EMOJI[stateName] ?? "\u{1F423}";
  }

  // client/index.mjs
  var STATE_PATH = "/plugins/vlln/dsh-pet/state";
  var INTERACT_PATH = "/plugins/vlln/dsh-pet/interact";
  var CONFIG_PATH = "/plugins/vlln/dsh-pet/config";
  var ASSETS_URL = "/plugins/vlln/dsh-pet/assets";
  var MANIFEST_URL = `${ASSETS_URL}/manifest.json`;
  var CFG_DEFAULTS = {
    size: 110,
    opacity: 1,
    walk: { enabled: true, minWaitMs: 18e3, maxWaitMs: 4e4, minMs: 3e3, maxMs: 6e3, speedPxPerSec: 45 },
    sleepAfterMs: 6e4,
    pollMs: 3e3,
    idlePauseMs: 3500,
    bubbleMs: 2500
  };
  var cfg = { ...CFG_DEFAULTS };
  var TICK_MS = 50;
  var CSS = `
[data-dsh-pet] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  font-family: system-ui, sans-serif; user-select: none; cursor: grab; touch-action: none;
  opacity: var(--pet-opacity, 1); }
[data-dsh-pet] .pet-stage { position: relative; width: var(--pet-size, 110px); height: var(--pet-size, 110px); display: grid; place-items: center;
  font-size: calc(var(--pet-size, 110px) * 0.4); line-height: 1; text-align: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.25));
  /* \u89C6\u89C9\u5C42\u4E0D\u63A5\u6536\u6307\u9488\uFF1Asprite \u6EA2\u51FA\u5E03\u5C40\u76D2\uFF08256 \u903B\u8F91\xD7scale\uFF09\uFF0Cpointer \u7531 hitarea \u72EC\u5360\uFF0C
     \u6D88\u9664\u5C42\u53E0\u6B67\u4E49\uFF08stage \u53CA\u5B50\u5143\u7D20\u4E0D\u62E6\u622A\u70B9\u51FB\uFF09\u3002 */
  pointer-events: none; }
[data-dsh-pet] .pet-effects { position: absolute; left: 0; top: 0; width: var(--pet-size, 110px); height: var(--pet-size, 110px);
  pointer-events: none; overflow: visible; z-index: 2; }
[data-dsh-pet] .pet-hitarea { position: absolute; cursor: grab; touch-action: none; z-index: 3;
  border-radius: 8px; }
[data-dsh-pet] .pet-sprite { display: none; background-repeat: no-repeat; transition: opacity .12s ease; }
[data-dsh-pet] .pet-sprite.ready { display: block; }
/* \u72B6\u6001\u5361\uFF1A\u9ED8\u8BA4\u7F6E\u4E8E\u5BA0\u7269\u4E0B\u65B9\uFF0C\u95F4\u8DDD\u8DB3\u591F\uFF08\u89D2\u8272 bob \u6D6E\u52A8 \xB14px \u4E0D\u89E6\u5230\uFF09+ \u8D34\u5E95\u65F6\u7FFB\u4E0A\u65B9\u3002 */
[data-dsh-pet] .pet-status { position: absolute; left: 50%; top: calc(100% + 18px); transform: translateX(-50%);
  width: max-content; min-width: 96px; max-width: calc(100vw - 24px); padding: 5px 8px;
  background: rgba(27,30,40,.94); backdrop-filter: blur(10px) saturate(1.15);
  border: 1px solid rgba(255,255,255,.10); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.38), 0 3px 8px rgba(0,0,0,.28);
  color: #E8EBF2; font-size: 11px; display: grid; gap: 4px; z-index: 1;
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .15s ease-out, transform .15s ease-out, visibility 0s linear .2s; }
[data-dsh-pet] .pet-status::after { /* \u8FDE\u63A5\u5C3E\uFF1A\u547D\u4E2D\u533A\u8986\u76D6\u5BA0\u7269\u2194\u5361\u7247\u95F4\u9699\uFF0Chover \u8FDE\u7EED\u4E0D\u95EA\u65AD */
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
/* \u5DE6\u53F3\u5BF9\u9F50\u53D8\u4F53\uFF1A\u5BA0\u7269\u8D34\u89C6\u53E3\u8FB9\u7F18\u65F6\u5361\u8FB9\u7F18\u5BF9\u9F50\uFF0C\u907F\u514D\u6A2A\u5411\u6EA2\u51FA\u3002 */
[data-dsh-pet] .pet-status.pet-status-left { left: 0; transform: translateX(0); }
[data-dsh-pet] .pet-status.pet-status-right { left: auto; right: 0; transform: translateX(0); }
[data-dsh-pet]:hover .pet-status.pet-status-left,
[data-dsh-pet]:focus-within .pet-status.pet-status-left,
[data-dsh-pet]:hover .pet-status.pet-status-right,
[data-dsh-pet]:focus-within .pet-status.pet-status-right { transform: translateX(0); }
/* \u8D34\u5E95\u7FFB\u8F6C\uFF1A\u5BA0\u7269\u9760\u8FD1\u89C6\u53E3\u5E95\u90E8\u65F6\u72B6\u6001\u5361\u7FFB\u5230\u4E0A\u65B9\uFF08\u4E0B\u65B9\u662F\u5C4F\u5E55\u8FB9\u7F18\uFF0C\u5361\u4F1A\u6EA2\u51FA/\u88AB\u88C1\uFF09\u3002 */
[data-dsh-pet] .pet-status.pet-status-above { top: auto; bottom: calc(100% + 18px); }
[data-dsh-pet] .pet-status.pet-status-above::after { top: auto; bottom: -5px; }
/* \u6C14\u6CE1\u6FC0\u6D3B\u6216\u83DC\u5355\u6253\u5F00\u65F6\u72B6\u6001\u5361\u8BA9\u4F4D\u9690\u85CF\uFF08\u6C14\u6CE1/\u83DC\u5355\u4F18\u5148\uFF0C\u89C1\u5171\u5B58\u7B56\u7565\uFF09\u3002 */
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
/* \u72B6\u6001\u8FD0\u52A8\u914D\u65B9\uFF08manifest.motion \u2192 \u821E\u53F0 CSS \u7C7B\uFF1Bframes>1 \u8D70\u5E27\u64AD\u653E\u5668\uFF0Cframes=1 \u8D70\u6B64\u52A8\u753B\uFF09\u3002
   \u52A8\u753B\u4F5C\u7528\u4E8E\u821E\u53F0\uFF08\u65E0\u5185\u8054 transform\uFF09\uFF0C\u4E0E sprite \u7684\u5185\u8054 scale \u4E0D\u51B2\u7A81\u3002
   \u5E45\u5EA6\u514B\u5236\uFF08\xB12~6px/deg\uFF09+ \u4E2D\u95F4\u5173\u952E\u5E27\uFF080\u21921/4\u21921/2\u21923/4\u21921\uFF09\uFF1A\u65E0\u7A81\u53D8\u7684\u5F80\u590D\u3002 */
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
`;
  function apply(ctx = {}) {
    if (document.querySelector("[data-dsh-pet]") !== null) {
      console.warn("[dsh-pet] apply \u5DF2\u5B58\u5728\u5B9E\u4F8B\uFF0C\u8DF3\u8FC7\u91CD\u590D\u6302\u8F7D");
      return () => {
      };
    }
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    const host = document.createElement("div");
    host.setAttribute("data-dsh-pet", "");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "\u684C\u9762\u5BA0\u7269");
    host.setAttribute("aria-expanded", "false");
    document.body.appendChild(host);
    const stage = document.createElement("div");
    stage.className = "pet-stage";
    stage.setAttribute("role", "button");
    stage.setAttribute("tabindex", "0");
    stage.setAttribute("aria-label", "\u4E92\u52A8\u83DC\u5355\uFF1A\u56DE\u8F66\u6216\u7A7A\u683C\u6253\u5F00");
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
    const roleBtn = document.createElement("button");
    roleBtn.textContent = "\u{1F3AD} \u6362\u89D2\u8272";
    menu.append(feedBtn, playBtn, roleBtn);
    const effects = document.createElement("div");
    effects.className = "pet-effects";
    const hitarea = document.createElement("div");
    hitarea.className = "pet-hitarea";
    host.append(effects, stage, hitarea, status, menu);
    const layoutStatus = () => {
      if (activeBubble !== null || dragging || menu.classList.contains("open")) {
        status.classList.add("pet-status-hidden");
        return;
      }
      status.classList.remove("pet-status-hidden");
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = host.getBoundingClientRect();
      const cardW = status.offsetWidth || 160;
      const cardH = status.offsetHeight || 60;
      const nearLeft = rect.left < cardW / 2 - 8;
      const nearRight = rect.right > vw - (cardW / 2 - 8);
      const nearBottom = rect.bottom > vh - cardH - 20;
      status.classList.remove("pet-status-left", "pet-status-right", "pet-status-above");
      if (nearBottom) status.classList.add("pet-status-above");
      if (nearLeft && !nearRight) status.classList.add("pet-status-left");
      else if (nearRight && !nearLeft) status.classList.add("pet-status-right");
    };
    const onHostEnter = () => layoutStatus();
    const onHostLeave = () => {
      if (menu.classList.contains("open")) return;
      status.classList.remove("pet-status-left", "pet-status-right", "pet-status-above", "pet-status-hidden");
    };
    host.addEventListener("mouseenter", onHostEnter);
    host.addEventListener("mouseleave", onHostLeave);
    const onBubbleShown = () => {
      if (document.querySelector(":hover") === host) layoutStatus();
    };
    const toggleMenu = (open) => {
      const next = open ?? !menu.classList.contains("open");
      menu.classList.toggle("open", next);
      status.classList.toggle("pet-status-hidden", next);
      host.setAttribute("aria-expanded", String(next));
      if (next) lastActiveAt = Date.now();
      return next;
    };
    let pet = null;
    let activity = { name: "idle", until: 0 };
    let manifest = { states: {} };
    let character = { id: "whale-girl", states: {} };
    let characterId = "whale-girl";
    const loaded = /* @__PURE__ */ new Set();
    const sheetSize = /* @__PURE__ */ new Map();
    let dragging = false;
    let pressed = false;
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
    let frameDirection = 1;
    let idlePausedUntil = 0;
    let lastFrameAt = 0;
    let walking = false;
    let walkDir = 1;
    let flip = 1;
    let wanderTimer = null;
    let walkRaf = null;
    let sessionMood = { thinking: false, waiting: false, titles: [] };
    let sessionsUnsub = null;
    const renderStatus = () => {
      if (pet) {
        metaLv.textContent = `Lv.${pet.level}`;
        metaStats.textContent = pet.stats.failures > 0 ? `${pet.stats.tasksDone} \u4EFB\u52A1 \xB7 ${pet.stats.failures} \u5931\u8D25` : `${pet.stats.tasksDone} \u4EFB\u52A1`;
        const last = pet.memory[pet.memory.length - 1];
        metaNote.textContent = last ?? (pet.titles.length > 0 ? `\u79F0\u53F7\u300C${pet.titles.join("\u300D\u300C")}\u300D` : "\u2026");
      }
    };
    const showEmoji = (name) => {
      sprite.classList.remove("ready");
      const emoji = document.createElement("span");
      emoji.className = "pet-emoji";
      emoji.textContent = emojiFor(character, name);
      stage.replaceChildren(emoji);
    };
    const sheetKey = (sheet) => `${characterId}:${sheet}`;
    const sheetUrl = (sheet) => `${ASSETS_URL}/characters/${characterId}/${sheet}`;
    const showSprite = (name, anim) => {
      const key = sheetKey(anim.sheet);
      const size = sheetSize.get(key);
      if (!size || size.w <= 0 || size.h <= 0) {
        showEmoji(name);
        return;
      }
      stage.replaceChildren(sprite);
      const frameW = size.w / anim.frames;
      const target = host.offsetWidth || 110;
      const scale = Math.min(target / frameW, target / size.h, 1);
      sprite.className = "pet-sprite ready";
      sprite.style.backgroundImage = `url("${sheetUrl(anim.sheet)}")`;
      sprite.style.backgroundSize = `${size.w}px ${size.h}px`;
      sprite.style.width = `${frameW}px`;
      sprite.style.height = `${size.h}px`;
      sprite.style.transform = `scale(${scale}) scaleX(${flip})`;
      applyFrame(frameW, frame);
    };
    const applyFrame = (frameW, idx) => {
      sprite.style.backgroundPosition = `-${frameW * idx}px 0`;
    };
    const setState = (name) => {
      if (name === animState) return;
      animState = name;
      frame = 0;
      frameDirection = 1;
      idlePausedUntil = 0;
      lastFrameAt = 0;
      for (const cls of [...stage.classList]) if (cls.startsWith("pet-motion-")) stage.classList.remove(cls);
      const cfg2 = stateOf(character, name);
      const motion = cfg2?.motion;
      if (motion) stage.classList.add(`pet-motion-${motion}`);
      if (cfg2 && loaded.has(sheetKey(cfg2.sheet))) {
        showSprite(name, cfg2);
        showingSprite = true;
      } else {
        showEmoji(name);
        showingSprite = false;
      }
      stage.style.opacity = "0";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        stage.style.opacity = "1";
      }));
    };
    let contentBox = null;
    const mergeContentBox = (box) => {
      if (contentBox === null) {
        contentBox = { ...box };
        return;
      }
      const nx = Math.min(contentBox.x, box.x);
      const ny = Math.min(contentBox.y, box.y);
      const nr = Math.max(contentBox.x + contentBox.w, box.x + box.w);
      const nb = Math.max(contentBox.y + contentBox.h, box.y + box.h);
      contentBox = { x: nx, y: ny, w: nr - nx, h: nb - ny };
    };
    const applyHitArea = () => {
      if (hitarea === null) return;
      const size = parseFloat(getComputedStyle(host).getPropertyValue("--pet-size")) || 110;
      const box = contentBox ?? { x: 0, y: 0, w: 1, h: 1 };
      const hitW = Math.max(40, size * box.w);
      const hitH = Math.max(40, size * box.h);
      const offX = (size - hitW) / 2;
      const offY = (size - hitH) / 2;
      hitarea.style.left = `${offX}px`;
      hitarea.style.top = `${offY}px`;
      hitarea.style.width = `${hitW}px`;
      hitarea.style.height = `${hitH}px`;
    };
    const resetContentBox = () => {
      contentBox = null;
    };
    const analyzeSheet = (img, frames) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx2 = canvas.getContext("2d", { willReadFrequently: true });
      ctx2.drawImage(img, 0, 0);
      const data = ctx2.getImageData(0, 0, canvas.width, canvas.height).data;
      const fw = img.naturalWidth / frames;
      let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
      for (let y = 0; y < img.naturalHeight; y++) {
        for (let x = 0; x < img.naturalWidth; x++) {
          if (data[(y * img.naturalWidth + x) * 4 + 3] > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return null;
      return {
        x: minX / img.naturalWidth,
        y: minY / img.naturalHeight,
        w: (maxX - minX + 1) / img.naturalWidth,
        h: (maxY - minY + 1) / img.naturalHeight
      };
    };
    const preload = (name, cfg2) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        sheetSize.set(sheetKey(cfg2.sheet), { w: img.naturalWidth, h: img.naturalHeight });
        loaded.add(sheetKey(cfg2.sheet));
        const box = analyzeSheet(img, cfg2.frames);
        if (box !== null) mergeContentBox(box);
        applyHitArea();
        resolve();
      };
      img.onerror = resolve;
      img.src = sheetUrl(cfg2.sheet);
    });
    const loadAssets = async () => {
      try {
        const res = await fetch(MANIFEST_URL);
        if (!res.ok) return;
        const next = await res.json();
        if (next === null || typeof next !== "object") return;
        manifest = next;
        resetContentBox();
        const pref = (() => {
          try {
            return localStorage.getItem("dsh-pet:character") ?? null;
          } catch {
            return null;
          }
        })();
        const roles = parseCharacters(manifest);
        const nextId = pref !== null && pref in roles.characters ? pref : roles.defaultId;
        characterId = nextId;
        character = getCharacter(manifest, nextId) ?? { id: nextId, states: {} };
        const stageSize = character.meta?.stageSize;
        if (typeof stageSize === "number" && lastConfigRevision === 0) {
          host.style.setProperty("--pet-size", `${stageSize}px`);
        }
        await Promise.all(Object.entries(character.states).map(([n, cfg2]) => preload(n, cfg2)));
      } catch {
      }
    };
    const switchCharacter = async (id) => {
      const target = getCharacter(manifest, id);
      if (target === null || id === characterId) return;
      try {
        resetContentBox();
        const nextLoaded = /* @__PURE__ */ new Set();
        const nextSize = /* @__PURE__ */ new Map();
        await Promise.all(Object.entries(target.states).map(([n, cfg2]) => new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            nextSize.set(`${id}:${cfg2.sheet}`, { w: img.naturalWidth, h: img.naturalHeight });
            nextLoaded.add(`${id}:${cfg2.sheet}`);
            const box = analyzeSheet(img, cfg2.frames);
            if (box !== null) mergeContentBox(box);
            applyHitArea();
            resolve();
          };
          img.onerror = resolve;
          img.src = `${ASSETS_URL}/characters/${id}/${cfg2.sheet}`;
        })));
        characterId = id;
        character = target;
        loaded.clear();
        sheetSize.clear();
        for (const k of nextLoaded) loaded.add(k);
        for (const [k, v] of nextSize) sheetSize.set(k, v);
        const stageSize = target.meta?.stageSize;
        if (typeof stageSize === "number" && lastConfigRevision === 0) {
          host.style.setProperty("--pet-size", `${stageSize}px`);
        }
        try {
          localStorage.setItem("dsh-pet:character", id);
        } catch {
        }
        transient = null;
        transientUntil = 0;
        joyUntil = 0;
        animState = null;
        frame = 0;
        lastFrameAt = 0;
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
      const target = pickState({ activity, dragging, walking, transient, sleeping, joyUntil, now, sessionThink: sessionMood.thinking, sessionWait: sessionMood.waiting });
      setState(target);
      const cfg2 = stateOf(character, animState);
      if (cfg2 && loaded.has(sheetKey(cfg2.sheet))) {
        const size = sheetSize.get(sheetKey(cfg2.sheet));
        const frameW = size.w / cfg2.frames;
        if (!showingSprite) {
          showSprite(animState, cfg2);
          showingSprite = true;
          frame = 0;
          lastFrameAt = 0;
        }
        if (cfg2.frames > 1 && now - lastFrameAt >= 1e3 / cfg2.fps) {
          if (animState === "idle" && idlePausedUntil > now) return;
          if (animState === "idle" && idlePausedUntil !== 0 && now >= idlePausedUntil) {
            frame = 0;
            frameDirection = 1;
            idlePausedUntil = 0;
            lastFrameAt = now;
            applyFrame(frameW, frame);
            return;
          }
          lastFrameAt = now;
          frame += frameDirection;
          if ((animState === "idle" || animState === "walk") && cfg2.loop && cfg2.frames > 1) {
            if (frame >= cfg2.frames - 1 || frame <= 0) frameDirection *= -1;
            frame = Math.max(0, Math.min(cfg2.frames - 1, frame));
            if (animState === "idle" && frame === 0 && frameDirection === 1) {
              idlePausedUntil = now + cfg2.idlePauseMs;
            }
          } else if (frame >= cfg2.frames) {
            if (cfg2.loop) frame = 0;
            else {
              frame = cfg2.frames - 1;
              if (transient !== null && transient !== "wake") {
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
        heart.style.left = `${20 + Math.random() * 110}px`;
        heart.style.top = `${30 + Math.random() * 80}px`;
        effects.appendChild(heart);
        heart.addEventListener("animationend", () => heart.remove());
        setTimeout(() => heart.remove(), 2e3);
      }
    };
    const bubbleTimers = /* @__PURE__ */ new Set();
    let activeBubble = null;
    const clearBubble = () => {
      if (activeBubble !== null) {
        activeBubble.remove();
        activeBubble = null;
      }
    };
    const showReply = (text) => {
      clearBubble();
      const bubble = document.createElement("div");
      bubble.className = "pet-bubble";
      bubble.textContent = text;
      effects.appendChild(bubble);
      activeBubble = bubble;
      if (typeof onBubbleShown === "function") onBubbleShown();
      const timer2 = setTimeout(() => {
        bubbleTimers.delete(timer2);
        if (activeBubble === bubble) activeBubble = null;
        bubble.remove();
        if (typeof onBubbleShown === "function") onBubbleShown();
      }, 2500);
      bubbleTimers.add(timer2);
    };
    const interact = async (action) => {
      stopWalk();
      transient = action === "feed" ? "eat" : "play";
      transientUntil = Date.now() + TRANSIENT_MS;
      lastActiveAt = Date.now();
      try {
        const res = await fetch(INTERACT_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action })
        });
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (body?.reply) showReply(body.reply);
        spawnHearts();
      } catch {
      }
      await refresh();
    };
    let refreshing = false;
    let failStreak = 0;
    let lastConfigRevision = 0;
    const fetchConfig = async () => {
      try {
        const res = await fetch(CONFIG_PATH);
        if (!res.ok) return null;
        const body = await res.json();
        return body !== null && typeof body === "object" ? body.config : null;
      } catch {
        return null;
      }
    };
    const applyClientConfig = (config) => {
      if (config === null || typeof config !== "object") return;
      cfg = { ...CFG_DEFAULTS, ...config };
      if (typeof config.size === "number") {
        host.style.setProperty("--pet-size", `${config.size}px`);
        if (host.style.left) {
          const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth));
          const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight));
          host.style.left = `${x}px`;
          host.style.top = `${y}px`;
        }
      }
      if (typeof config.opacity === "number") host.style.setProperty("--pet-opacity", String(config.opacity));
      scheduleWander();
    };
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const res = await fetch(STATE_PATH);
        if (!res.ok) throw new Error(`state ${res.status}`);
        const body = await res.json();
        if (body !== null && typeof body === "object" && body.pet !== null && typeof body.pet === "object") {
          pet = body.pet;
        }
        const act = body?.activity;
        if (act !== null && typeof act === "object" && typeof act.name === "string") {
          activity = act;
        }
        if (activity.name !== "idle" || activity.until > Date.now()) lastActiveAt = Date.now();
        sleeping = activity.name === "idle" && Date.now() - lastActiveAt > cfg.sleepAfterMs;
        if (typeof body?.configRevision === "number" && body.configRevision !== lastConfigRevision) {
          lastConfigRevision = body.configRevision;
          const config = await fetchConfig();
          if (config !== null) applyClientConfig(config);
        }
        if (wasSleeping && !sleeping && transient === null && !["welcome", "celebrate", "error", "disappointed", "working"].includes(activity.name)) {
          transient = "wake";
          transientUntil = Date.now() + WAKE_MS;
        }
        wasSleeping = sleeping;
        failStreak = 0;
        renderStatus();
      } catch {
        failStreak += 1;
        if (failStreak >= 3) metaNote.textContent = "\u{1F4E1} \u79BB\u7EBF\u2026";
      } finally {
        refreshing = false;
      }
    };
    let startX = 0;
    let startY = 0;
    let lastPointerX = 0;
    let offsetX = 0;
    let offsetY = 0;
    const POS_KEY = "dsh-pet:pos";
    const savePos = () => {
      try {
        if (host.style.left && host.style.top) {
          localStorage.setItem(POS_KEY, JSON.stringify({ x: parseFloat(host.style.left), y: parseFloat(host.style.top) }));
        }
      } catch {
      }
    };
    try {
      const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
      if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
        const x = Math.max(0, Math.min(raw.x, window.innerWidth - host.offsetWidth));
        const y = Math.max(0, Math.min(raw.y, window.innerHeight - host.offsetHeight));
        host.style.left = `${x}px`;
        host.style.top = `${y}px`;
        host.style.right = "auto";
        host.style.bottom = "auto";
      }
    } catch {
    }
    hitarea.addEventListener("pointerdown", (e) => {
      pressed = true;
      dragging = false;
      moved = false;
      stopWalk();
      lastActiveAt = Date.now();
      startX = e.clientX;
      startY = e.clientY;
      lastPointerX = e.clientX;
      offsetX = e.clientX - host.offsetLeft;
      offsetY = e.clientY - host.offsetTop;
    });
    hitarea.addEventListener("pointermove", (e) => {
      if (!pressed) return;
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
        if (!moved) hitarea.setPointerCapture(e.pointerId);
        moved = true;
        dragging = true;
        transient = null;
        transientUntil = 0;
        joyUntil = 0;
        layoutStatus();
        const nextFlip = e.clientX < lastPointerX ? -1 : 1;
        if (nextFlip !== flip) {
          flip = nextFlip;
          const dragCfg = stateOf(character, "drag");
          if (animState === "drag" && dragCfg && loaded.has(sheetKey(dragCfg.sheet))) showSprite("drag", dragCfg);
        }
      }
      lastPointerX = e.clientX;
      if (!moved) return;
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - host.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - host.offsetHeight));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
    });
    hitarea.addEventListener("pointerup", (e) => {
      pressed = false;
      dragging = false;
      if (hitarea.hasPointerCapture(e.pointerId)) hitarea.releasePointerCapture(e.pointerId);
      if (moved) savePos();
      layoutStatus();
      if (!moved && !e.target.closest("button")) toggleMenu();
    });
    hitarea.addEventListener("pointercancel", () => {
      pressed = false;
      dragging = false;
      moved = false;
      layoutStatus();
    });
    hitarea.addEventListener("lostpointercapture", () => {
      pressed = false;
      dragging = false;
      moved = false;
      layoutStatus();
    });
    stage.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMenu();
      }
    });
    const onDocPointerDown = (e) => {
      if (!host.contains(e.target)) toggleMenu(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") toggleMenu(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    feedBtn.addEventListener("click", () => interact("feed"));
    playBtn.addEventListener("click", () => interact("play"));
    roleBtn.addEventListener("click", () => {
      const roles = listCharacters(manifest);
      if (roles.length < 2) return;
      const idx = roles.indexOf(characterId);
      const next = roles[(idx + 1) % roles.length];
      switchCharacter(next);
      toggleMenu(false);
    });
    const onPetSay = (e) => {
      if (e.detail && typeof e.detail.text === "string" && e.detail.text.length > 0) showReply(e.detail.text);
    };
    const onPetFx = (e) => {
      if (e.detail?.type === "hearts") spawnHearts();
    };
    const onPetStatus = (e) => {
      if (e.detail && typeof e.detail.text === "string") {
        const prev = metaNote.textContent;
        metaNote.textContent = e.detail.text;
        setTimeout(() => {
          if (metaNote.textContent === e.detail.text) renderStatus();
        }, 2500);
      }
    };
    document.addEventListener("dsh-pet:say", onPetSay);
    document.addEventListener("dsh-pet:fx", onPetFx);
    document.addEventListener("dsh-pet:status", onPetStatus);
    const stopWalk = () => {
      walking = false;
      if (walkRaf !== null) {
        cancelAnimationFrame(walkRaf);
        walkRaf = null;
      }
      scheduleWander();
    };
    const scheduleWander = () => {
      clearTimeout(wanderTimer);
      if (!cfg.walk.enabled) return;
      const wait = cfg.walk.minWaitMs + Math.random() * (cfg.walk.maxWaitMs - cfg.walk.minWaitMs);
      wanderTimer = setTimeout(() => {
        if (sleeping || sessionMood.thinking || sessionMood.waiting) {
          scheduleWander();
          return;
        }
        wander();
      }, wait);
    };
    const wander = () => {
      walking = true;
      walkDir = Math.random() < 0.5 ? 1 : -1;
      flip = walkDir;
      const walkCfg = stateOf(character, "walk");
      if (animState === "walk" && walkCfg && loaded.has(sheetKey(walkCfg.sheet))) showSprite("walk", walkCfg);
      const duration = cfg.walk.minMs + Math.random() * (cfg.walk.maxMs - cfg.walk.minMs);
      const start = performance.now();
      const maxX = Math.max(0, window.innerWidth - host.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - host.offsetHeight);
      const rect = host.getBoundingClientRect();
      const startLeft = Math.min(Math.max(rect.left, 0), maxX);
      const startTop = Math.min(Math.max(rect.top, 0), maxY);
      host.style.right = "auto";
      host.style.bottom = "auto";
      const step = (t) => {
        if (sleeping || dragging || sessionMood.thinking || sessionMood.waiting) {
          stopWalk();
          return;
        }
        const x = startLeft + walkDir * cfg.walk.speedPxPerSec * ((t - start) / 1e3);
        if (x <= 0 || x >= maxX || t - start >= duration) {
          host.style.left = `${Math.min(maxX, Math.max(0, x))}px`;
          host.style.top = `${startTop}px`;
          stopWalk();
          return;
        }
        host.style.left = `${x}px`;
        host.style.top = `${startTop}px`;
        walkRaf = requestAnimationFrame(step);
      };
      walkRaf = requestAnimationFrame(step);
    };
    loadAssets();
    refresh();
    const timer = setInterval(refresh, cfg.pollMs);
    const animTimer = setInterval(tick, TICK_MS);
    scheduleWander();
    const sessions = ctx.sessions ?? (typeof ctx.get === "function" ? ctx.get("sessions") : void 0);
    if (sessions?.list && typeof sessions.list.getSnapshot === "function") {
      const seenCompleted = /* @__PURE__ */ new Set();
      let seeded = false;
      const onSessions = () => {
        try {
          const snap = sessions.list.getSnapshot();
          sessionMood = deriveSessionMood(snap);
          if (seeded) {
            const byId = snap?.byId ?? {};
            for (const id of Object.keys(byId)) {
              const s = byId[id];
              if (s?.completed === true && !seenCompleted.has(id) && id !== snap?.current) {
                seenCompleted.add(id);
                const title = s.displayTitle ?? id;
                showReply(`\u2728 ${title} \u5B8C\u6210\u4E86`);
              }
            }
          }
          for (const id of Object.keys(snap?.byId ?? {})) {
            if (snap.byId[id]?.completed === true) seenCompleted.add(id);
          }
          seeded = true;
        } catch {
        }
      };
      onSessions();
      sessionsUnsub = sessions.list.subscribe(onSessions);
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onResize = () => {
      if (!host.style.left) return;
      const x = Math.max(0, Math.min(parseFloat(host.style.left) || 0, window.innerWidth - host.offsetWidth));
      const y = Math.max(0, Math.min(parseFloat(host.style.top) || 0, window.innerHeight - host.offsetHeight));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      layoutStatus();
    };
    window.addEventListener("resize", onResize);
    let pageHidden = false;
    const syncInert = () => {
      const onboarding = document.querySelector('[class*="onboarding"]') !== null;
      const dialog = document.querySelector('[role="dialog"]') !== null;
      const next = onboarding ? "onboarding" : dialog ? "dialog" : null;
      if (next !== pageHidden) {
        pageHidden = next;
        if (next === null) {
          host.removeAttribute("data-dsh-pet-inert");
          host.removeAttribute("data-dsh-pet-hidden");
        } else if (next === "onboarding") {
          host.removeAttribute("data-dsh-pet-inert");
          host.setAttribute("data-dsh-pet-hidden", "");
        } else {
          host.removeAttribute("data-dsh-pet-hidden");
          host.setAttribute("data-dsh-pet-inert", "");
        }
      }
    };
    const dialogObserver = new MutationObserver(syncInert);
    dialogObserver.observe(document.body, { childList: true, subtree: true });
    syncInert();
    return () => {
      clearInterval(timer);
      clearInterval(animTimer);
      clearTimeout(wanderTimer);
      if (walkRaf !== null) cancelAnimationFrame(walkRaf);
      if (sessionsUnsub !== null) sessionsUnsub();
      for (const t of bubbleTimers) clearTimeout(t);
      bubbleTimers.clear();
      clearBubble();
      dialogObserver.disconnect();
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("dsh-pet:say", onPetSay);
      document.removeEventListener("dsh-pet:fx", onPetFx);
      document.removeEventListener("dsh-pet:status", onPetStatus);
      host.removeEventListener("mouseenter", onHostEnter);
      host.removeEventListener("mouseleave", onHostLeave);
      window.removeEventListener("resize", onResize);
      host.remove();
      style.remove();
    };
  }
  window.__ModuleLoader__.load({
    id: "vlln/dsh-pet",
    factory: (require2) => ({
      name: "dsh-pet-client",
      inject: ["sessions"],
      apply
    })
  });
})();
