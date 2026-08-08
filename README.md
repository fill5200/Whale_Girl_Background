# dsh-pet

DSH Web GUI 内的桌面宠物（QQ 宠物形态，A 模式——GUI 内）：右下角悬浮、可拖拽、可喂食/玩耍，状态由 Node half 状态机维护；模型也可通过 `pet_feed`/`pet_play` 工具喂它。

## 安装与启用

```sh
dsh registry install ./dsh-pet   # 安装（默认禁用——信任边界）
dsh registry enable vlln/dsh-pet # 启用（实时挂载；浏览器端需刷新页面）
```

启用后刷新 Web 页面，右下角出现宠物：点击弹出菜单（🍗 喂食 / 🎾 玩耍），拖拽可移动；状态条显示饱食度/心情/等级，每 3s 轮询刷新。

## 开发循环

```sh
node scripts/gates/run.mjs          # 本地门禁组（链接/决策格式/assets manifest/生成物新鲜度）
node --test 'tests/*.test.mjs'      # Node half 单测
node scripts/build-client.mjs       # 改 client/ 源码后重新生成 client.js（勿手改产物）
dsh registry uninstall vlln/dsh-pet && dsh registry install ./dsh-pet && dsh registry enable vlln/dsh-pet
```

**进程边界（易错）**：`dsh registry enable` 在 CLI 进程注册，**已运行的 web 不感知**——disable/enable 对运行中实例无效。改 `index.mjs`（Node half）后需 **web 重启**；改 `client/` 或 `assets/` 后重装（上例把新 `client.js`/sheet 复制进安装目录）+ **刷新页面**即可（`serveBundle` 按请求读磁盘，页面刷新即取新文件）。

## 素材（sprite sheet）契约

宠物的图是**每状态一张横排帧图**（sprite sheet），由 `assets/manifest.json` 声明：

```json
{ "states": { "idle": { "sheet": "idle.png", "frames": 4, "fps": 4, "loop": true } } }
```

- **生图要求**：透明背景 PNG/SVG/WebP；每状态一张横排帧图，帧等宽同高；风格一致（参考 `originals/鲸鱼娘.png`，建议先出角色设定图锁定风格）。
- **投放方式**：sheet 放进 `assets/`，在 `assets/manifest.json` 加对应条目——`verify-assets` 门禁保证引用的文件存在（缺文件即门禁红）。
- **sheet 缺失时该状态用 emoji 兜底**，可增量投放。建议状态与帧数：

| 状态 | 用途 | 帧数 |
|---|---|---|
| `idle` | 待机（呼吸/眨眼） | 2–4 |
| `happy` | 互动反馈 + 爱心粒子 | 2–3 |
| `hungry` | 饿了 | 1–2 |
| `sad` | 心情低落 | 1–2 |
| `eat` | 喂食动作（播一次） | 3 |
| `play` | 玩耍动作（播一次） | 3 |
| `drag` | 被拖拽 | 2 |
| `sleep` | 长时空闲入睡 | 2 |
| `working` | agent 工作（任务 running） | 2–4 |
| `celebrate` | 任务完成庆祝（burst 6s） | 3–4 |
| `error` | 出错惊吓（burst 6s） | 2–3 |

## 结构

| 路径 | 作用 |
|---|---|
| `index.mjs` | Node half：`pet_feed`/`pet_play` 工具 + 状态/互动/assets 路由 + 活动推导 |
| `src/pet-state.mjs` | 宠物状态机（纯函数，可脱离 dsh 单测） |
| `src/activity.mjs` | 活动推导（任务 → working/celebrate/error，纯函数） |
| `src/assets.mjs` | assets 路由守卫（路径净化 + MIME，纯函数） |
| `assets/` | sprite sheet + manifest（静态服务：`/plugins/vlln/dsh-pet/assets/`） |
| `originals/` | 生图参考原图（不参与服务） |
| `client/index.mjs` | client bundle 源码（构建产物 `client.js` 勿手改） |
| `decisions/` | 决策记录；架构见 [implemented/architecture/2026-08-08-in-gui-pet-architecture.md](decisions/implemented/architecture/2026-08-08-in-gui-pet-architecture.md) |

## 边界

宠物只存在于 DSH Web GUI 页面内；关掉页面宠物即消失。真·OS 桌面宠物（脱离浏览器、置顶、托盘）不在本插件能力内（见决策记录的备选方案 B'）。
