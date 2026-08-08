# Sprite 素材规格（生图契约）

本文是 dsh-pet 动画素材的**唯一权威规格**：状态清单、生图提示、运动配方、投放流程。README 只链接本文件；改动本清单必须同时改 [client/logic.mjs](../client/logic.mjs) 的状态选择、[client/index.mjs](../client/index.mjs) 的运动类与 `assets/manifest.json`（新增状态无 sheet 时以 emoji 兜底，可增量投放）。

## 机制原则（积累型伙伴）

**零负反馈**：宠物没有饥饿/心情等会衰减、会惩罚冷落的需求；失败只短暂失落（`disappointed` 瞬发），不持续不扣资历。**积累型**：一切向上积累，真实的共同经历（完成任务/会话/陪伴时长）→ 资历等级/称号/回忆。

## 素材管线（混合方案：关键姿势 + 过程动画）

**不要为每个状态生成多帧**。AI 帧间角色会漂移、无法对齐，动画会抖。正确做法：

1. **生图**：每状态 **1 张关键姿势单图**（透明贴纸 PNG，正方形画布，角色居中占 ~80%），风格锁定参考 [originals/鲸鱼娘.png](../originals/鲸鱼娘.png)。
2. **归一化（PIL 脚本）**：把生图产物丢进 `assets/raw/`，跑 `python3 scripts/normalize-sprites.py` → 自动裁透明边距、统一到 256×256 居中、多帧拼横排 sheet → 输出 `assets/<状态>.png`。
3. **投放**：在 `assets/manifest.json` 加条目（`frames: 1` + `motion` 配方；`eat`/`play` 可 2 帧）。`verify-assets` 门禁保证引用文件存在；`check-sprites` 门禁守护归一化产物新鲜度。

## 生图提示模板（gpt-image-2）

**通用前缀**（每张都带）：

> 为《鲸鱼娘》表情包角色生成一张贴纸插画，画风、配色、线条比例必须与参考图完全一致。输出透明背景 PNG（sticker 模式），只画角色本身，无文字、无边框、无地面阴影。正方形 1:1 画布，角色居中，占画面约 80%，取景与全身站姿参考图一致。

**状态后缀**（替换最后一句）：

| 状态 | 提示后缀（姿势/表情描述） |
|---|---|
| idle | 正面站立待机，双手自然下垂，表情平静，眼睛微睁 |
| working | 一手托腮专注思考，头顶冒小灯泡，眼睛专注看向一侧 |
| celebrate | 双手高举跳跃，嘴巴大张欢呼，眼睛弯成月牙，周围撒小星星 |
| error | 惊吓弹起，头发/呆毛炸起，眼睛瞪圆，嘴巴张成 O 形，周围一个感叹号 |
| disappointed | 低头垂肩，眼睛含泪但没哭出来，嘴角下撇，轻轻叹气状 |
| joy | 眯眼咧嘴大笑，双手举起欢呼状，身体微倾，周围两个小爱心 |
| eat | 双手捧食物大口啃咬，腮帮鼓起，眼睛满足地眯起，食物只画半个 |
| play | 双手抛接小球或抱球，身体腾空，表情兴奋开心 |
| drag | 身体被斜向拉扯，表情惊讶慌张，双手乱摆，眼睛瞪大 |
| sleep | 蜷缩成一团闭眼睡觉，头顶飘一个 Zzz，身体放松 |
| wake | 刚醒伸懒腰，一只手揉眼睛，嘴巴打哈欠，睡眼惺忪 |
| welcome | 一只手举高挥动打招呼，眼睛弯弯，嘴巴微笑，周围两个小星星 |

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

1. 生图产物丢 `assets/raw/<状态>.png`（多帧为 `<状态>-1.png`、`<状态>-2.png`）。
2. `python3 scripts/normalize-sprites.py`（或 `--check` 校验新鲜度）→ 生成 `assets/<状态>.png`。
3. `assets/manifest.json` 加条目（`verify-assets` 门禁保证引用存在，缺文件即红）。
4. 实况验证：`dsh registry uninstall vlln/dsh-pet && dsh registry install ./dsh-pet && dsh registry enable vlln/dsh-pet`，重启 web 后刷新（日志须无 `plugin tree failed to load`）。
