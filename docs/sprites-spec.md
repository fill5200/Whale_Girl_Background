# Sprite 素材规格（生图契约）

本文是 dsh-pet 动画素材的**唯一权威规格**：状态清单、生图契约、运动配方、投放流程。README 只链接本文件；改动本清单必须同时改 [client/logic.mjs](../client/logic.mjs) 的状态选择、[client/index.mjs](../client/index.mjs) 的运动类与 `assets/manifest.json`（新增状态无 sheet 时以 emoji 兜底，可增量投放）。

## 机制原则（积累型伙伴）

**零负反馈**：宠物没有饥饿/心情等会衰减、会惩罚冷落的需求；失败只短暂失落（`disappointed` 瞬发），不持续不扣资历。**积累型**：一切向上积累，真实的共同经历（完成任务/会话/陪伴时长）→ 资历等级/称号/回忆。

## 素材管线（混合方案：关键姿势 + 过程动画/中间帧）

**每状态一张图**（一次生成一个状态类型，分多张图片），该图内可含该状态的 **2~4 帧**（横排，中间帧让动作有过渡）；静态姿势 1 帧即可。帧内一致天然保证（同一张图），状态间一致性靠参考图。已废弃"单张 2K 大图含全部状态"（网格切分对不上、单帧无中间过程）。

1. **生图**：每状态一张图（纯色背景，见提示模板），参考 [originals/鲸鱼娘.png](../originals/鲸鱼娘.png) 锁风格。
2. **切分/归一化**（`scripts/slice-sheet.py`，PIL）：纯色底色键 `--key R,G,B` → 裁透明边距 → 居中补边 → 统一 256×256；多帧横排图用 `--grid 1xN` 切帧。单帧图直接归一化。
3. **投放**：图进 `assets/`，`assets/manifest.json` 加条目（`frames: N` + 可选 `motion`；`verify-assets` 门禁保证引用存在）。

## 生图提示模板（每状态一张，纯色背景）

**背景要求（关键）**：**纯绿色 `#00FF00`**——鲸鱼娘配色（蓝/紫/粉）与洋红底在色域重叠（实测反复出现洋红残边/微斑），与绿色**完全不相交**（距离 360+），键抠零歧义。❌ 洋红/粉/紫底（与角色配色冲突）；❌ 白/浅灰底；❌ "透明背景"提示（Gemini 只画假透明棋盘格）。

> 生成一张 1024×1024 的贴纸插画：背景为**纯绿色（#00FF00）**，无渐变/纹理/杂色。角色是《鲸鱼娘》表情包角色，画风、配色、线条比例与参考图完全一致，角色本身**不得含洋红色**；全身取景、居中、占画面约 80%。**<状态画面描述>**。需要动感的状态加一句："画面为 **N 个动作帧横排**（从左到右依次为动作过程），帧间等宽、互不重叠、无分割线"。

| 状态 | 帧数 | 画面描述 |
|---|---|---|
| `idle` | 3 | 正面站立待机：第 1 帧睁眼、第 2 帧闭眼（眨眼）、第 3 帧微睁，身体呼吸起伏 |
| `working` | 3 | 一手托腮思考：头微倾、眼神专注、头顶小灯泡，三帧为思考的轻微晃动 |
| `celebrate` | 3 | 双手高举欢呼：三帧为跳起的起跳—腾空—落下，周围小星星 |
| `error` | 2 | 惊吓：第 1 帧正常、第 2 帧瞪眼张嘴呆毛炸起，一个感叹号 |
| `disappointed` | 2 | 低头垂肩：第 1 帧正常、第 2 帧低头含泪叹气 |
| `joy` | 2 | 眯眼咧嘴大笑，身体微倾，周围小爱心，两帧轻微摆动 |
| `eat` | 3 | 双手捧食物啃咬：咬下—咀嚼—咽下，腮帮鼓起 |
| `play` | 3 | 抛接小球：抛出—腾空—接住，身体蹦跳 |
| `drag` | 2 | 被斜向拉扯：第 1 帧正常、第 2 帧身体倾斜双手乱摆 |
| `walk` | 4 | **侧面行走**：左到右依次为迈步循环（抬左腿—落脚—抬右腿—落脚），身体微微起伏 |
| `sleep` | 2 | 蜷缩闭眼睡觉：身体随呼吸起伏两态，头顶 Zzz |
| `wake` | 2 | 伸懒腰：第 1 帧闭眼张嘴打哈欠、第 2 帧揉眼睛睁开 |
| `welcome` | 2 | 举手挥手打招呼：两帧为挥手上下摆动，周围小星星 |

## 状态总表（权威，13 状态）

| 状态 | 触发 | 帧数 | motion 配方 | loop | 画面 |
|---|---|---|---|---|---|
| `idle` | 默认 | 2–3 | `bob`（呼吸） | ✓ | 待机站姿 |
| `working` | agent 任务 running | 2–3 | `wiggle`（思考晃） | ✓ | 托腮思考 |
| `celebrate` | 任务完成/升级/称号（burst 6s） | 2–3 | `squash`（弹跳） | ✗ | 举手欢呼 |
| `error` | 失败/`agent/request-error`（burst 4s） | 2 | `shake`（抖动） | ✗ | 惊吓瞪眼 |
| `disappointed` | 失败后短时失落（burst 12s 尾段） | 2 | `sigh`（叹气起伏） | ✗ | 垂头含泪 |
| `joy` | 投喂/玩耍后短时（3s） | 2 | `hop`（蹦跳） | ✗ | 眯眼笑 |
| `eat` | 点击投喂 | 3 | —（帧循环） | ✗ | 啃咬 |
| `play` | 点击玩耍 | 3 | —（帧循环） | ✗ | 抛接球 |
| `drag` | 拖拽中 | 2 | `tilt`（摇摆） | ✓ | 被扯斜 |
| `walk` | 周期性游走（18~40s 一次，3~6s） | 3–4 | —（帧循环） | ✓ | **侧面行走** |
| `sleep` | 空闲 ≥60s | 2 | `float`（浮动） | ✓ | 蜷睡 |
| `wake` | 睡醒过渡 | 2 | 无 | ✗ | 伸懒腰 |
| `welcome` | 新会话（burst 6s） | 2 | `wave`（挥手） | ✗ | 挥手打招呼 |

优先级：`drag` > `walk` > 瞬发（`eat`/`play`/`wake`）> burst（`welcome`/`error`/`disappointed`/`celebrate` 窗口内）> `working` > `joy` > `sleep` > `idle`。

## manifest 模板（全 13 状态）

```json
{
  "states": {
    "idle":         { "sheet": "idle.png",         "frames": 3, "fps": 3,  "loop": true },
    "working":      { "sheet": "working.png",      "frames": 3, "fps": 4,  "loop": true },
    "celebrate":    { "sheet": "celebrate.png",    "frames": 3, "fps": 8,  "loop": false },
    "error":        { "sheet": "error.png",        "frames": 2, "fps": 5,  "loop": false },
    "disappointed": { "sheet": "disappointed.png", "frames": 2, "fps": 2,  "loop": false },
    "joy":          { "sheet": "joy.png",          "frames": 2, "fps": 6,  "loop": false },
    "eat":          { "sheet": "eat.png",          "frames": 3, "fps": 8,  "loop": false },
    "play":         { "sheet": "play.png",         "frames": 3, "fps": 8,  "loop": false },
    "drag":         { "sheet": "drag.png",         "frames": 2, "fps": 6,  "loop": true },
    "walk":         { "sheet": "walk.png",         "frames": 4, "fps": 6,  "loop": true },
    "sleep":        { "sheet": "sleep.png",        "frames": 2, "fps": 1,  "loop": true,  "motion": "float" },
    "wake":         { "sheet": "wake.png",         "frames": 2, "fps": 5,  "loop": false },
    "welcome":      { "sheet": "welcome.png",      "frames": 2, "fps": 6,  "loop": false, "motion": "wave" }
  }
}
```

> 规则（verify-assets 门禁强制）：**`motion` 只允许配 `frames: 1`**——多帧状态由帧播放器动画，运动配方与帧播放器互斥（单帧状态才用 CSS 运动补充）。

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

1. 生图产物（每状态一张，纯色背景）放 `assets/raw/<状态>.png`（多帧为横排单图）。
2. `python3 scripts/slice-sheet.py assets/raw/<状态>.png --key 255,0,255 [--grid 1xN] --out assets/raw/slices/<状态>/` → 归一化子图；多帧用 `--grid 1xN` 切帧（如 walk 为 `--grid 1x4`）。
3. 子图复制进 `assets/`，`assets/manifest.json` 加条目（`verify-assets` 门禁保证引用存在，缺文件即红）。
4. 实况验证：`dsh registry uninstall vlln/dsh-pet && dsh registry install ./dsh-pet && dsh registry enable vlln/dsh-pet`，重启 web 后刷新（日志须无 `plugin tree failed to load`）；改 client 后跑 `node scripts/verify-client-smoke.mjs <web-url>`。
