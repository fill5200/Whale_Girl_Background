# Sprite 素材规格（生图契约）

本文是 dsh-pet 动画素材的**唯一权威规格**：状态清单、帧数、生图提示、manifest 模板。README 只链接本文件；改动本清单必须同时改 [client/index.mjs](../client/index.mjs) 的状态选择与 `assets/manifest.json`（新增状态无 sheet 时以 emoji 兜底，可增量投放）。

## 全局规格（所有 sheet 通用）

- **格式**：PNG，透明背景（SVG/WebP 亦可，PNG 优先）。
- **布局**：每状态一张**横排帧图**，帧等宽同高，帧间无间距。
- **尺寸**：建议 256×256/帧（显示缩放至 ≤150px，2x 保清晰）。
- **风格**：锁定角色设计——先用参考图 [originals/鲸鱼娘.png](../originals/鲸鱼娘.png) 生成 1 张**角色设定图**，所有状态沿用同一画风/配色/线条，只换动作与表情。
- **命名**：`<状态名>.png`（小写英文），由 `assets/manifest.json` 引用。

## 状态总表（权威，12 状态）

| 状态 | 触发 | 播放方式 | 帧数 | fps | loop | 画面 |
|---|---|---|---|---|---|---|
| `idle` | 默认 | 常驻 | 4 | 4 | ✓ | 待机呼吸/眨眼 |
| `happy` | 饱食且开心（hunger<40 且 mood≥80） | 常驻 | 3 | 8 | ✓ | 眯眼笑/开心蹦跳 |
| `hungry` | 饥饿（hunger>70） | 常驻 | 2 | 2 | ✓ | 饿/盯食物/肚子咕咕 |
| `sad` | 低落（mood<30） | 常驻 | 2 | 2 | ✓ | 垂头/含泪 |
| `eat` | 点击喂食 | 一次 | 3 | 10 | ✗ | 吃东西/腮帮鼓 |
| `play` | 点击玩耍 | 一次 | 3 | 10 | ✗ | 玩球/蹦跳 |
| `drag` | 拖拽中 | 拖拽期间 | 2 | 8 | ✓ | 挣扎/惊讶 |
| `sleep` | 空闲 ≥60s | 常驻 | 2 | 1 | ✓ | 睡觉/Zzz |
| `wake` | 睡醒过渡 | 一次 | 2 | 6 | ✗ | 伸懒腰/睁开眼 |
| `working` | agent 任务 running | 常驻 | 4 | 6 | ✓ | 思考/工作/敲键盘 |
| `celebrate` | 任务完成（burst 6s） | 一次 | 4 | 10 | ✗ | 欢呼/举手/撒花 |
| `error` | 任务失败或 `agent/request-error`（burst 6s） | 一次 | 3 | 6 | ✗ | 惊吓/炸毛/哭 |

优先级：`drag` > 瞬发（`eat`/`play`/`wake`）> burst（`celebrate`/`error`，窗口内）> `working` > `sleep` > `hungry` > `sad` > `happy` > `idle`。

## 逐状态生图提示

共性前缀（每张图都带）：**"角色为《鲸鱼娘》表情包角色，保持与参考图完全一致的画风、配色、线条比例；透明背景，只画角色本身，无文字、无边框。"** 后缀按状态替换：

| 状态 | 提示后缀 |
|---|---|
| idle | 正面站立待机，轻微呼吸起伏，眼睛一眨一眨，表情平静 |
| happy | 眯眼咧嘴大笑，双手举起欢呼状，身体微微蹦跳，周围可有小爱心 |
| hungry | 双手捂肚，眼神渴望地看向一侧，嘴巴微张流口水，肚子发出咕咕的拟态 |
| sad | 低头垂肩，眼睛含泪，嘴角下撇，肩膀微微抽动 |
| eat | 双手捧食物大口啃咬，腮帮鼓起，眼睛满足地眯起，食物只画半个（示意吃的过程） |
| play | 双手抛接小球或抱球蹦跳，身体腾空，表情兴奋开心 |
| drag | 身体被斜向拉扯，表情惊讶慌张，双手乱摆，眼睛瞪大 |
| sleep | 蜷缩成一团闭眼睡觉，头顶飘着 Zzz，身体随呼吸起伏 |
| wake | 刚醒伸懒腰，一只手揉眼睛，嘴巴打哈欠，睡眼惺忪 |
| working | 专注思考状，一只手托腮或扶额，头顶冒小灯泡/齿轮，眼睛专注 |
| celebrate | 双手高举跳跃，周围撒花/星星，嘴巴大张欢呼，眼睛弯成月牙 |
| error | 惊吓弹起，头发/呆毛炸起，眼睛瞪圆，嘴巴张大呈 O 形，周围可有感叹号 |

## manifest 模板（全 12 状态）

```json
{
  "states": {
    "idle":      { "sheet": "idle.png",      "frames": 4, "fps": 4,  "loop": true },
    "happy":     { "sheet": "happy.png",     "frames": 3, "fps": 8,  "loop": true },
    "hungry":    { "sheet": "hungry.png",    "frames": 2, "fps": 2,  "loop": true },
    "sad":       { "sheet": "sad.png",       "frames": 2, "fps": 2,  "loop": true },
    "eat":       { "sheet": "eat.png",       "frames": 3, "fps": 10, "loop": false },
    "play":      { "sheet": "play.png",      "frames": 3, "fps": 10, "loop": false },
    "drag":      { "sheet": "drag.png",      "frames": 2, "fps": 8,  "loop": true },
    "sleep":     { "sheet": "sleep.png",     "frames": 2, "fps": 1,  "loop": true },
    "wake":      { "sheet": "wake.png",      "frames": 2, "fps": 6,  "loop": false },
    "working":   { "sheet": "working.png",   "frames": 4, "fps": 6,  "loop": true },
    "celebrate": { "sheet": "celebrate.png", "frames": 4, "fps": 10, "loop": false },
    "error":     { "sheet": "error.png",     "frames": 3, "fps": 6,  "loop": false }
  }
}
```

## 投放与验证

1. sheet 放进 `assets/`，在 `assets/manifest.json` 加对应条目（`verify-assets` 门禁保证引用的文件存在，缺文件即红）。
2. 缺 sheet 的状态自动 emoji 兜底，可增量投放。
3. 实况验证：`dsh registry uninstall vlln/dsh-pet && dsh registry install ./dsh-pet && dsh registry enable vlln/dsh-pet`，重启 web 后刷新页面。
