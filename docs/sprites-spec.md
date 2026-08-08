# Sprite 素材规格（生图契约）

本文是 dsh-pet 动画素材的**唯一权威规格**：状态清单、生图契约、运动配方、投放流程。README 只链接本文件；改动本清单必须同时改 [client/logic.mjs](../client/logic.mjs) 的状态选择、[client/index.mjs](../client/index.mjs) 的运动类与 `assets/manifest.json`（新增状态无 sheet 时以 emoji 兜底，可增量投放）。

## 机制原则（积累型伙伴）

**零负反馈**：宠物没有饥饿/心情等会衰减、会惩罚冷落的需求；失败只短暂失落（`disappointed` 瞬发），不持续不扣资历。**积累型**：一切向上积累，真实的共同经历（完成任务/会话/陪伴时长）→ 资历等级/称号/回忆。

## 素材管线（3×3 网格生图 → 帧 sheet）

**每张生图 = 3×3 网格**（行 = 状态、列 = 帧；静态姿势 1 帧占 1 格，行内帧横排、格间留白）。帧内一致天然保证（同一张图），状态间一致性靠参考图。已废弃"单张 2K 大图含全部状态"（网格切分对不上、单帧无中间过程）。

1. **生图**：3×3 网格图（纯色背景，见提示模板），参考 [originals/鲸鱼娘.png](../originals/鲸鱼娘.png) 锁风格。
2. **切分/归一化**（`scripts/slice-sheet.py`，PIL）：`--sheet 3x3 --states 行状态名 --frames 每行帧数`（更细粒度用 `--regions state@row:colStart-colEnd`）→ 行带连通域分离 → 逐帧裁切 → 质心配准（±2px 钳制）→ 底中对齐 → 帧横排 sheet；纯色底色键 `--key R,G,B`（多色 `|` 分隔）或 `--auto` 取边框色。
3. **投放**：sheet 进 `assets/`，`assets/manifest.json` 加条目（`frames: N` + 可选 `motion`；`verify-assets` 门禁保证引用存在）。

## 生图提示模板（每状态一行，纯色背景）

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
| `drag` | 1 | 被斜向拉扯：单帧身体倾斜双手乱摆（拖拽态由 `tilt` 运动配方持续摇摆） |
| `walk` | 3 | **侧面行走**：左到右依次为迈步循环（抬左腿—落脚—抬右腿），身体微微起伏 |
| `sleep` | 2 | 蜷缩闭眼睡觉：身体随呼吸起伏两态，头顶 Zzz |
| `wake` | 2 | 伸懒腰：第 1 帧闭眼张嘴打哈欠、第 2 帧揉眼睛睁开 |
| `welcome` | 2 | 举手挥手打招呼：两帧为挥手上下摆动，周围小星星 |

## 状态总表（权威，13 状态）

窗口时长不在此重复：burst/瞬发窗口的毫秒值只存 [index.mjs](../index.mjs)（本表触发列只写事件来源）。motion 配方与帧播放器默认互斥（`motion` 只配 `frames:1`）；`error` 是唯一多帧+运动叠加的定向例外（见下方规则）。

| 状态 | 触发 | 帧数 | motion 配方 | loop | 画面 |
|---|---|---|---|---|---|
| `idle` | 默认 | 3 | — | ✓ | 待机站姿（眨眼+呼吸） |
| `working` | agent 任务 running | 3 | — | ✓ | 托腮思考 |
| `celebrate` | 任务完成/升级/称号（burst） | 3 | — | ✓ | 举手欢呼 |
| `error` | 失败/`agent/request-error`（burst） | 2 | `shake`（定向例外） | ✗ | 正常→惊吓，僵住颤抖 |
| `disappointed` | 失败后短时失落（burst 尾段） | 2 | — | ✓ | 垂头含泪 |
| `joy` | 投喂/玩耍后短时 | 2 | — | ✓ | 眯眼笑 |
| `eat` | 点击投喂（瞬发） | 3 | — | ✓ | 啃咬循环 |
| `play` | 点击玩耍（瞬发） | 3 | — | ✓ | 抛接球循环 |
| `drag` | 拖拽中 | 1 | `tilt` | ✓ | 被斜向拉扯 |
| `walk` | 周期性游走 | 3 | — | ✓ | 侧面行走 |
| `sleep` | 空闲 ≥60s | 2 | — | ✓ | 蜷睡 |
| `wake` | 睡醒过渡（瞬发） | 2 | — | ✗ | 伸懒腰 |
| `welcome` | 新会话（burst） | 2 | — | ✓ | 挥手打招呼 |

优先级（[client/logic.mjs](../client/logic.mjs)）：`drag` > `walk` > 瞬发（`eat`/`play`/`wake`）> burst（`error`/`disappointed` 窗口内，`welcome`/`celebrate` 不打断负面尾段）> `working` > `joy` > `sleep` > `idle`。

## manifest 模板（全 13 状态，与部署实况一致）

```json
{
  "states": {
    "idle":         { "sheet": "idle.png",         "frames": 3, "fps": 2,  "loop": true },
    "working":      { "sheet": "working.png",      "frames": 3, "fps": 4,  "loop": true },
    "celebrate":    { "sheet": "celebrate.png",    "frames": 3, "fps": 4,  "loop": true },
    "error":        { "sheet": "error.png",        "frames": 2, "fps": 8,  "loop": false, "motion": "shake" },
    "disappointed": { "sheet": "disappointed.png", "frames": 2, "fps": 2,  "loop": true },
    "joy":          { "sheet": "joy.png",          "frames": 2, "fps": 5,  "loop": true },
    "eat":          { "sheet": "eat.png",          "frames": 3, "fps": 8,  "loop": true },
    "play":         { "sheet": "play.png",         "frames": 3, "fps": 5,  "loop": true },
    "drag":         { "sheet": "drag.png",         "frames": 1, "fps": 5,  "loop": true,  "motion": "tilt" },
    "walk":         { "sheet": "walk.png",         "frames": 3, "fps": 6,  "loop": true },
    "sleep":        { "sheet": "sleep.png",        "frames": 2, "fps": 1,  "loop": true },
    "wake":         { "sheet": "wake.png",         "frames": 2, "fps": 3,  "loop": false },
    "welcome":      { "sheet": "welcome.png",      "frames": 2, "fps": 3,  "loop": true }
  }
}
```

> 规则（verify-assets 门禁强制）：**`motion` 只允许配 `frames: 1`**——多帧状态由帧播放器动画，运动配方与帧播放器互斥（单帧状态才用 CSS 运动补充）。**定向例外：仅 `error`（2 帧「正常→惊吓」+ `shake`）**——一次播完僵住后由 CSS 颤抖维持 burst 窗口内的持续表现（见决策记录动画编排修订）。

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

1. 生图产物（3×3 网格，纯色背景）放 `assets/raw/`（gitignored，不入库）。
2. `python3 scripts/slice-sheet.py assets/raw/<图>.png --sheet 3x3 --states <行状态名> --frames <每行帧数>` → 帧 sheet 写入 `assets/`。
3. `assets/manifest.json` 加/改条目（`verify-assets` 门禁保证引用与 PNG 尺寸契约，缺文件即红）。
4. 实况验证：`dsh registry install ./dsh-pet` → **刷新页面即可**（assets/ manifest 改动无需重启 web——assets 路由按请求读盘）；改 Node half（index.mjs/src）才需重启 web 且日志须无 `plugin tree failed to load`；改 client 后跑 `node scripts/verify-client-smoke.mjs <web-url>`。
