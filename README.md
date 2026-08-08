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
node scripts/gates/run.mjs          # 本地门禁组（链接可达性/决策格式/生成物新鲜度）
node --test 'tests/*.test.mjs'          # Node half 单测
node scripts/build-client.mjs       # 改 client/ 源码后重新生成 client.js（勿手改产物）
dsh registry disable vlln/dsh-pet && dsh registry enable vlln/dsh-pet   # 改完重挂载
```

## 结构

| 路径 | 作用 |
|---|---|
| `index.mjs` | Node half：`pet_feed`/`pet_play` 工具 + 状态/互动路由 |
| `src/pet-state.mjs` | 宠物状态机（纯函数，可脱离 dsh 单测） |
| `client/index.mjs` | client bundle 源码（构建产物 `client.js` 勿手改） |
| `decisions/` | 决策记录；架构见 [implemented/architecture/2026-08-08-in-gui-pet-architecture.md](decisions/implemented/architecture/2026-08-08-in-gui-pet-architecture.md) |

## 边界

宠物只存在于 DSH Web GUI 页面内；关掉页面宠物即消失。真·OS 桌面宠物（脱离浏览器、置顶、托盘）不在本插件能力内（见决策记录的备选方案 B'）。
