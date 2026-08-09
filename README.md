# dsh-pet

DSH Web GUI 内的桌面宠物（QQ 宠物形态，A 模式——GUI 内）。**积累型伙伴（Harness Pet）**：右下角悬浮、可拖拽、可投喂/玩耍；宠物不模拟饥饿/心情（零负反馈——不会因被冷落而难受），它的"生命"= 工作台脉搏——完成任务/会话/陪伴时长积累成**资历等级、称号与回忆**（完整成长系统见 [docs/growth-system.md](docs/growth-system.md)）。

## 安装与启用

```sh
dsh registry install ./dsh-pet   # 安装（默认禁用——信任边界）
dsh registry enable vlln/dsh-pet # 启用（实时挂载；浏览器端需刷新页面）
```

启用后刷新 Web 页面，右下角出现宠物：点击弹出菜单（🍗 投喂 / 🎾 玩耍），拖拽可移动；状态条显示资历（等级/任务数）与最近共同回忆（hover 宠物显示），每 3s 轮询刷新。任务完成时宠物庆祝（页面关闭期间完成的任务重开后也会庆祝）、失败时短暂失落（`error`→`disappointed` 瞬发）、新会话时挥手欢迎；任一会话运行/思考时宠物沉思陪伴（`think`），等待批准时抬眼期待（`wait`）。初始配置/欢迎页（onboarding）宠物隐藏。

## 配置（体验层）

体验层参数（尺寸/透明度/游走/睡眠/窗口时长）经宿主 settings 配置，`<dshHome>/settings.yaml` 的 `dsh-pet:` section（或设置 UI）修改后**热生效免重启**：

```yaml
dsh-pet:
  size: 110          # 宠物尺寸 px（64–160）
  opacity: 1         # 常态透明度（0.2–1）
  walk:
    enabled: true    # 游走开关
  sleepAfterMs: 60000
```

完整配置项清单与语义层（XP/称号）封闭说明见 `src/config.mjs`。**语义层不可配**（改 XP/称号阈值会破坏积累账本一致性，见决策记录）。

## 角色（换角色零改代码）

`assets/manifest.json` 是角色索引：`characters.<id>.states`（sheet 在 `assets/characters/<id>/`）+ `default`。换角色 = 新增角色目录 + manifest 条目 + 设置 localStorage `dsh-pet:character`（P2 将加菜单 UI）；缺 sheet 状态自动 emoji 兜底。旧格式顶层 `states`（sheet 平铺 `assets/`）兼容。

## 开发循环

```sh
node scripts/gates/run.mjs          # 本地门禁组（链接/决策格式/assets manifest/工具 schema/生成物新鲜度）
node --test 'tests/*.test.mjs'      # Node half 单测
node scripts/build-client.mjs       # 改 client/ 源码后重新生成 client.js（勿手改产物）
dsh registry uninstall vlln/dsh-pet && dsh registry install ./dsh-pet && dsh registry enable vlln/dsh-pet
```

**进程边界（易错）**：`dsh registry enable` 在 CLI 进程注册，**已运行的 web 不感知**——disable/enable 对运行中实例无效。改 `index.mjs`（Node half，含工具 schema）后需 **web 重启**（并检查日志无 `plugin tree failed to load`）；改 `client/` 或 `assets/` 后重装（上例把新 `client.js`/sheet 复制进安装目录）+ **刷新页面**即可（`serveBundle` 按请求读磁盘，页面刷新即取新文件）。

## 素材（sprite sheet）契约

宠物的图是**每状态一张横排帧图**（可含 2~4 个中间帧），由 `assets/manifest.json` 声明。**完整规格（15 状态、帧数、逐状态生图提示、manifest 模板）见 [docs/sprites-spec.md](docs/sprites-spec.md)**；**状态机（状态清单/触发/优先级/扩展指引）见 [docs/state-machine.md](docs/state-machine.md)**，要点：

- **生图要求**：**纯绿色 `#00FF00` 背景**（❌ 洋红/粉/紫底——与鲸鱼娘蓝紫粉配色在色域重叠，实测反复出残边；❌ 白/浅灰底；❌ 不要提示透明背景——生图模型会画假透明棋盘格，抠图死局）；每状态一张横排帧图，帧等宽同高；风格一致（参考 `originals/鲸鱼娘.png`，建议先出角色设定图锁定风格）。
- **投放方式**：图放进 `assets/characters/<角色id>/`（多帧为横排单图），在 `assets/manifest.json` 对应角色的 `states` 加条目——`verify-assets` 门禁保证引用的文件存在、多帧 PNG 尺寸符合帧数、角色 id 合法（缺文件/尺寸不符/非法 id 即门禁红）。
- **sheet 缺失时该状态用 emoji 兜底**，可增量投放。

## 结构

| 路径 | 作用 |
|---|---|
| `index.mjs` | Node half：`pet_feed`/`pet_play`/`pet_status` 工具 + 状态/互动/assets/config 路由 + 事件记账（积累）+ `ctx.pet` 服务 |
| `src/pet-state.mjs` | 积累账本（等级/称号/回忆，零衰减零惩罚，纯函数） |
| `src/activity.mjs` | 任务活动推导（working/celebrate/error + 翻转任务 id，纯函数） |
| `src/persistence.mjs` | 账本持久化归一化（纯函数） |
| `src/assets.mjs` | assets 路由守卫（路径净化 + MIME，纯函数） |
| `src/config.mjs` | 体验层配置 schema + DEFAULTS（单一来源，settings 注册用） |
| `src/signals.mjs` | pet 服务信号器（订阅/广播/异常隔离，纯函数） |
| `assets/characters/` | 角色 sheet（每角色一目录）+ manifest 角色索引（静态服务） |
| `originals/` | 生图参考原图（不参与服务） |
| `client/index.mjs` | client bundle 源码（构建产物 `client.js` 勿手改） |
| `client/logic.mjs` | 状态选择纯函数（STATE_TABLE 声明式状态表 + EMOJI 兜底） |
| `client/character.mjs` | 角色清单解析（纯函数） |
| `decisions/` | 决策记录；事件模型见 [implemented/feature/2026-08-08-accumulation-pet-model.md](decisions/implemented/feature/2026-08-08-accumulation-pet-model.md) |

## 边界

宠物只存在于 DSH Web GUI 页面内；关掉页面宠物即消失。真·OS 桌面宠物（脱离浏览器、置顶、托盘）不在本插件能力内（见决策记录的备选方案 B'）。

## 致谢

角色形象由 [ZipZipPipe](https://space.bilibili.com/4168597) 创作（《鲸鱼娘》表情包角色），sprites 基于其角色设定生成。

## 反馈与贡献

**欢迎提交 issue 和建议**——你的反馈直接决定宠物的下一步：

- 🐛 **遇到问题**（动画异常/交互 bug/状态不符）：提交 issue，附上复现步骤、浏览器与 dsh 版本；如果是客户端问题，附上控制台报错更佳。
- 💡 **功能建议**（新动作/新互动/成长系统扩展）：提交 issue 描述你想要的行为——参考 [docs/state-machine.md](docs/state-machine.md)（状态机）与 [docs/growth-system.md](docs/growth-system.md)（成长系统）了解现状，说明你期待的效果。
- 🎨 **新角色**：想贡献角色素材，见 [docs/sprites-spec.md](docs/sprites-spec.md)（生图契约：纯绿背景/256 帧/帧序）与 [docs/state-machine.md](docs/state-machine.md) 的扩展指引——换角色零改代码。
- 🔧 **代码贡献**：改动遵循仓库规范——每个非平凡改动带决策记录（`decisions/`）、门禁自证、单一性质提交（见 [docs/AGENTS.md](docs/AGENTS.md) 与根 [AGENTS.md](AGENTS.md)）。

**提交前建议**：先跑 `node scripts/gates/run.mjs` 确认门禁通过；涉及 client 的改动跑 `node scripts/build-client.mjs --check`。
