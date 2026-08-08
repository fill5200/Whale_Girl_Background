# Sprite 素材规格（生图契约）

本文是 dsh-pet 动画素材的**唯一权威规格**：状态清单、生图提示、运动配方、投放流程。README 只链接本文件；改动本清单必须同时改 [client/logic.mjs](../client/logic.mjs) 的状态选择、[client/index.mjs](../client/index.mjs) 的运动类与 `assets/manifest.json`（新增状态无 sheet 时以 emoji 兜底，可增量投放）。

## 机制原则（积累型伙伴）

**零负反馈**：宠物没有饥饿/心情等会衰减、会惩罚冷落的需求；失败只短暂失落（`disappointed` 瞬发），不持续不扣资历。**积累型**：一切向上积累，真实的共同经历（完成任务/会话/陪伴时长）→ 资历等级/称号/回忆。

## 素材管线（混合方案：关键姿势 + 过程动画）

**不要为每个状态生成多帧**。AI 帧间角色会漂移、无法对齐，动画会抖。正确做法——**单张 2K 大图含全部关键姿势，由脚本切分**：

1. **生图**：用 gpt-image-2 一次性生成 **1 张 2048×2048 大图**，内含 **12 个关键姿势子图**（每状态 1 个，透明贴纸、网格排列、同一画布 → 角色一致性天然成立）。生成契约见下节模板。
2. **切分**：`python3 scripts/slice-sheet.py sheet.png --grid 4x3 --layout idle,working,... --out assets/raw/slices` → 按网格位置切出 12 张 256×256 归一化子图（裁透明边距、居中补边、统一尺寸；位置→状态映射由 `--layout` 声明，本机无视觉识别故按位置映射）。
3. **投放**：子图进 `assets/`，在 `assets/manifest.json` 加条目（`frames: 1` + `motion` 配方；`eat`/`play` 可单独出 2 帧小图）。`verify-assets` 门禁保证引用文件存在。

## 生图提示模板（单张大图 + 纯色背景）

**背景要求（关键）**：必须用**纯色背景**（强烈建议洋红 `#FF00FF` 或绿色 `#00FF00`——角色身上没有的饱和色）。
- ❌ 不要白/浅灰底：角色的皮肤/高光接近白色，色键会误删（实测"太苍白"）。
- ❌ 不要"透明背景"提示：Gemini 只会画**假透明棋盘格**（灰/白两色），灰度角色同样抠不干净。
- 纯色底 + 色键 `--key R,G,B` = 一键干净分割。

> 生成一张 2048×2048 的贴纸合集大图：**4 列 × 3 行网格，共 12 个子图**。背景为**纯洋红色（#FF00FF）**，无任何渐变/纹理/杂色。每个子图是《鲸鱼娘》表情包角色的一个姿势，画风、配色、线条比例完全一致（以参考图为准），角色本身**不得含有洋红色**。每个子图独立占一格、互不重叠、格子之间留明显空白（洋红背景）；子图在各自格子内居中、占格子约 80%，全身取景统一。**行优先顺序**（不要加文字标注）：
> - 第 1 行：idle（正面站立待机，表情平静）｜working（一手托腮思考，头顶小灯泡）｜celebrate（双手高举欢呼，周围小星星）｜error（惊吓瞪眼，呆毛炸起，一个感叹号）
> - 第 2 行：disappointed（低头垂肩含泪）｜joy（眯眼咧嘴大笑，周围小爱心）｜eat（双手捧食物啃咬）｜play（抛接小球蹦跳）
> - 第 3 行：drag（身体被斜向拉扯，惊讶慌张）｜sleep（蜷缩闭眼睡觉，头顶 Zzz）｜wake（伸懒腰揉眼睛打哈欠）｜welcome（举手挥手打招呼，周围小星星）

提示顺序与 `--layout` 参数一一对应；若模型打乱顺序，报告实际布局后改 `--layout` 即可（切分只认位置）。

## 状态总表（权威，12 状态）

| 状态 | 触发 | 帧数 | motion 配方 | loop | 画面 |
|---|---|---|---|---|---|
| `idle` | 默认 | 1 | `bob`（呼吸） | ✓ | 待机站姿 |
| `working` | agent 任务 running | 1 | `wiggle`（思考晃） | ✓ | 托腮思考 |
| `celebrate` | 任务完成/升级/称号（burst 6s） | 1 | `squash`（弹跳） | ✗ | 举手欢呼 |
| `error` | 失败/`agent/request-error`（burst 4s） | 1 | `shake`（抖动） | ✗ | 惊吓瞪眼 |
| `disappointed` | 失败后短时失落（burst 12s 尾段） | 1 | `sigh`（叹气起伏） | ✗ | 垂头含泪 |
| `joy` | 投喂/玩耍后短时（3s） | 1 | `hop`（蹦跳） | ✗ | 眯眼笑 |
| `eat` | 点击投喂 | 2 | —（帧循环） | ✗ | 啃咬两态 |
| `play` | 点击玩耍 | 2 | —（帧循环） | ✗ | 抛接两态 |
| `drag` | 拖拽中 | 1 | `tilt`（摇摆） | ✓ | 被扯斜 |
| `sleep` | 空闲 ≥60s | 1 | `float`（浮动）+ Zzz 粒子 | ✓ | 蜷睡 |
| `wake` | 睡醒过渡 | 1 | 无 | ✗ | 伸懒腰 |
| `welcome` | 新会话（burst 6s） | 1 | `wave`（挥手） | ✗ | 挥手打招呼 |

优先级：`drag` > 瞬发（`eat`/`play`/`wake`）> burst（`welcome`/`error`/`disappointed`/`celebrate` 窗口内）> `working` > `joy` > `sleep` > `idle`。

## manifest 模板（全 12 状态）

```json
{
  "states": {
    "idle":         { "sheet": "idle.png",         "frames": 1, "fps": 4,  "loop": true,  "motion": "bob" },
    "working":      { "sheet": "working.png",      "frames": 1, "fps": 6,  "loop": true,  "motion": "wiggle" },
    "celebrate":    { "sheet": "celebrate.png",    "frames": 1, "fps": 10, "loop": false, "motion": "squash" },
    "error":        { "sheet": "error.png",        "frames": 1, "fps": 6,  "loop": false, "motion": "shake" },
    "disappointed": { "sheet": "disappointed.png", "frames": 1, "fps": 2,  "loop": false, "motion": "sigh" },
    "joy":          { "sheet": "joy.png",          "frames": 1, "fps": 8,  "loop": false, "motion": "hop" },
    "eat":          { "sheet": "eat.png",          "frames": 2, "fps": 10, "loop": false },
    "play":         { "sheet": "play.png",         "frames": 2, "fps": 10, "loop": false },
    "drag":         { "sheet": "drag.png",         "frames": 1, "fps": 8,  "loop": true,  "motion": "tilt" },
    "sleep":        { "sheet": "sleep.png",        "frames": 1, "fps": 1,  "loop": true,  "motion": "float" },
    "wake":         { "sheet": "wake.png",         "frames": 1, "fps": 6,  "loop": false },
    "welcome":      { "sheet": "welcome.png",      "frames": 1, "fps": 8,  "loop": false, "motion": "wave" }
  }
}
```

## 资历与称号（积累型）

- **XP 来源**：完成任务 +10、新会话 +5；**无任何衰减/惩罚**。
- **等级**：xp 三角数列（L2=50，L3=150，L4=300…），纯派生。
- **称号**（里程碑解锁，封闭集合在 [src/pet-state.mjs](../src/pet-state.mjs)）：

| id | 名称 | 解锁条件 |
|---|---|---|
| first-task | 初次协作 | 完成 1 个任务 |
| helper | 勤劳伙伴 | 完成 20 个任务 |
| veteran | 百炼成钢 | 完成 100 个任务 |
| regular | 常驻伙伴 | 累计活跃 ≥6 小时 |
| resilient | 越挫越勇 | 失败 ≥5 次 |
| social | 广结善缘 | 开启 ≥10 个会话 |

- **回忆**：最近 8 条共同事件（"完成任务「…」（第 N 个）""升到 Lv.N 🎉"），状态条展示。

## 投放与验证

1. 生图产物（单张 2K 大图，纯色背景）放 `assets/raw/sheet.png`（或任意路径）。
2. `python3 scripts/slice-sheet.py <sheet.png> --key 255,0,255 --grid 3x4 --layout idle,working,celebrate,error,disappointed,joy,eat,play,drag,sleep,wake,welcome --out assets/raw/slices`
   - 纯色底用 `--key R,G,B`（如洋红 `255,0,255`、绿 `0,255,0`）；假透明棋盘格用 `--key gray [--repair]`（灰度角色皮肤会失真，不推荐）。
3. 子图复制进 `assets/`，`assets/manifest.json` 加条目（`verify-assets` 门禁保证引用存在，缺文件即红）。
4. 实况验证：`dsh registry uninstall vlln/dsh-pet && dsh registry install ./dsh-pet && dsh registry enable vlln/dsh-pet`，重启 web 后刷新（日志须无 `plugin tree failed to load`）；改 client 后跑 `node scripts/verify-client-smoke.mjs <web-url>`。
