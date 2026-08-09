# 新角色/新动作开发指南（事件 · 动作 · 槽位）

本文面向**想给 dsh-pet 加角色或加动作的开发者**，说明机制契约：事件如何触发动作、动作有哪些槽位、哪些能扩展哪些不能。素材生图规格见 [sprites-spec.md](sprites-spec.md)，状态机优先级见 [state-machine.md](state-machine.md)，架构分层见 [architecture-evolution.md](architecture-evolution.md)——本文不重复这些事实，只串起「怎么做」。

## 心智模型：三层契约

```
宿主事件（DSH） → 触发信号 → 动作（动画状态）→ 槽位（角色资源）
```

- **事件**：宿主/用户发生的事（任务完成、会话开始、用户拖拽……）
- **动作**：宠物表现出的动画状态（idle、working、celebrate……15 个）
- **槽位**：角色为每个动作提供的资源位（sheet 文件 + 播放参数）

**关键原则：事件→动作映射是全角色共通的行为文法（STATE_TABLE），角色只能填充槽位（资源），不能改触发逻辑。** 加「新动作」是平台级变更（改 STATE_TABLE），加「新角色」是资源级变更（填槽位）——两者完全不同，见下。

## 一、事件 → 动作映射（谁能触发什么）

| 事件源 | 触发信号 | 动作 | 角色能改吗 |
|---|---|---|---|
| 用户拖拽（pointermove>6px） | `dragging` | `drag` | ❌ 触发固定 |
| 拖拽放下 | `dragReleaseUntil` | `idle`（1.5s 缓冲） | ❌ |
| 点击喂食/玩耍 | `transient='eat'/'play'` | `eat` / `play` | ❌ |
| 睡醒过渡 | `transient='wake'` | `wake` | ❌ |
| `tasks.onTaskDone`（completed） | Node burst `celebrate` | `celebrate` | ❌ |
| 任务升级/称号解锁 | Node burst `celebrate` | `celebrate` | ❌ |
| `tasks.onTaskDone`（failed） | Node burst `error`→`disappointed` | `error` / `disappointed` | ❌ |
| `agent/request-error` | Node burst `error`→`disappointed` | `error` / `disappointed` | ❌ |
| `agent/session-start`（startup） | Node burst `welcome` | `welcome` | ❌ |
| sessions.list 任一会话 running | client `sessionThink` | `working`↔`think`（交替） | ❌ |
| sessions.list 任一等待批准 | client `sessionWait` | `wait` | ❌ |
| 互动后短时 | client `joyUntil` | `joy` | ❌ |
| 空闲 ≥60s | client `sleeping` | `sleep` | ❌ |
| 周期游走（18-40s） | client `walking` | `walk` | ❌ |
| 兜底 | — | `idle` | ❌ |

**结论**：**所有触发信号都由代码产生（Node half 事件处理 + client 本地交互），角色无权新增或修改触发。** 角色能做的只有：为某个动作提供资源（sheet），或选择不提供（该动作 emoji 兜底）。

## 二、动作槽位（角色为每个动作填什么）

角色清单 `assets/manifest.json` 的 `characters.<id>` 是**槽位容器**：

```jsonc
{
  "characters": {
    "cat": {                    // ← 角色槽
      "name": "猫猫",
      "credit": "作者名",
      "meta": {                 // ← 视觉参数槽
        "stageSize": 96,        //   舞台尺寸 px（默认 110）
        "emojiOverrides": { "idle": "🐱" }  // 兜底表情定制（可选）
      },
      "states": {               // ← 动作槽位表（部分映射，缺的 emoji 兜底）
        "idle":      { "sheet": "idle.png",      "frames": 3, "fps": 2,  "loop": true },
        "working":   { "sheet": "working.png",   "frames": 3, "fps": 3,  "loop": true },
        // 可选：celebrate/error/disappointed/joy/eat/play/drag/walk/sleep/wake/welcome/think/wait
        // 单帧动作可加 motion 配方（bob/wiggle/squash/shake/sigh/hop/tilt/float/wave）
      }
    }
  },
  "default": "whale-girl"
}
```

### 每个动作槽位的字段

| 字段 | 必填 | 含义 | 说明 |
|---|---|---|---|
| `sheet` | ✓ | 素材文件名 | 放 `assets/characters/<id>/` |
| `frames` | ✓ | 帧数 | 多帧横排 sheet；`PNG 宽 = frames × 256` |
| `fps` | ✓ | 播放帧率 | 正数 |
| `loop` | ✓ | 是否循环 | 瞬发动作（wake/error）false |
| `motion` | ✗ | CSS 运动配方 | **仅 `frames:1`** 可配（除 error 定向例外）；白名单：bob/wiggle/squash/shake/sigh/hop/tilt/float/wave |

### meta 槽位（视觉参数）

| 字段 | 必填 | 含义 | 默认 |
|---|---|---|---|
| `stageSize` | ✗ | 舞台尺寸 px | 110（未配置时） |
| `emojiOverrides` | ✗ | 状态→兜底表情定制 | 通用 EMOJI 表 |

## 三、角色能扩展什么 / 不能扩展什么

### ✅ 角色可以（资源级，零代码）
1. **提供动作资源**：为任意现有动作填 sheet（部分映射，缺的 emoji 兜底）
2. **调表现参数**：每动作 frames/fps/loop/motion；角色 stageSize/emojiOverrides
3. **决定「核心状态」下限**：建议至少提供 `idle/walk/working/celebrate/error/sleep/joy`（其余可选）

### ❌ 角色不能（行为级，需平台变更）
1. **新增动作**（如「猫的舔毛」）——那是加状态 = 改 STATE_TABLE + EMOJI + spec + 门禁
2. **改触发条件**（如「失败时跳三下」）——触发是行为文法，全角色共通
3. **改优先级**（如「让 walk 优先于 think」）——STATE_TABLE 行序是全局的
4. **改 XP/称号**（成长语义，见 growth-system.md 边界）

### ⚠️ 新动作（平台级）需要什么（5 步）
1. `client/logic.mjs` STATE_TABLE 加行（含 when/resolve）
2. `client/logic.mjs` EMOJI 加兜底表情
3. `assets/manifest.json` 角色 states 加条目（可选 sheet）
4. `docs/sprites-spec.md` 状态总表同步（门禁强制 spec↔EMOJI）
5. 决策记录（行为文法变更）

## 四、动手步骤（加一个角色）

1. **定角色**：参考 `originals/鲸鱼娘.png` 锁定画风，出角色设定图
2. **生图**：按 [sprites-spec.md](sprites-spec.md) 契约（纯绿 #00FF00、256 帧、帧序从左到右）逐状态生图
3. **切图**（工具化，见 [sprites-spec.md](sprites-spec.md) 素材管线）：`python3 scripts/slice-sheet.py <图> <模式> --key R,G,B --out assets/characters/<角色id>/`——网格图用 `--sheet 3x3 --states <状态名> --frames <每行帧数>`，单状态/分栏用 `--single [--columns N --states a,b]`；`--swap-frames 0,2,1` 校正 AI 乱序帧；`--normalize-scale 0.88` 统一内容占比
4. **投放**：sheet 进 `assets/characters/<id>/`；manifest 加 `characters.<id>`（含 meta + states）
5. **验证**：`node scripts/gates/verify-assets.mjs`（文件存在/PNG 尺寸/帧序/motion/角色 id 合法性）；`node scripts/verify-client-smoke.mjs <web-url>` 浏览器冒烟
6. **切换**：设置 localStorage `dsh-pet:character` = 角色 id，或点菜单「🎭 换角色」按钮循环切换

## 五、验证门禁（角色必须通过）

| 门禁 | 校验 |
|---|---|
| `verify-assets` | sheet 存在/扩展名白名单/frames 正整数/PNG 宽=帧数×高/motion 白名单 + frames:1/角色 id `[a-z0-9-]`/default 指向存在角色 |
| `verify-spec-states` | 状态总表 ↔ EMOJI 表一致（15 状态封闭集合） |
| `verify-client-smoke` | 浏览器渲染 + transform 合法 |
