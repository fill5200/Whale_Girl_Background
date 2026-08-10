# AGENTS.md

<!-- 常驻层：每个 session 都必须进入上下文的规则。每条 1–3 行、自包含、链接它的家。不放故事、示例、情境流程、任何从被链接的家里复述来的内容。 -->

whale-girl 是一个 plugin-registry 插件：在 DSH Web GUI 内悬浮的桌面宠物（QQ 宠物形态，A 模式——GUI 内）。架构决策见 [decisions/implemented/architecture/2026-08-08-in-gui-pet-architecture.md](decisions/implemented/architecture/2026-08-08-in-gui-pet-architecture.md)；插件机制契约（contributes 同步、bundle id、client.inject 语义）见该记录与 plugin-registry 文档；文档规范见 [docs/AGENTS.md](docs/AGENTS.md)。

## 当前阶段取舍

**首个版本对外分发（进 hub/registry 索引）时删除本节。** 尚无外部消费者，优先正确的基础形态而非兼容性垫片：可自由重命名与重组，但必须在同一改动内更新全部引用。

## 目录布局

```
src/          Node half 纯逻辑（宠物状态机/活动推导/assets 守卫，零宿主依赖，可单测）
client/       client bundle 源码（纯 DOM 自渲染 + sprite 帧播放器）
client.js     构建产物（由 scripts/build-client.mjs 生成，勿手改）
assets/       sprite sheet + manifest.json（静态服务；manifest↔文件由 verify-assets 门禁守护）
originals/    生图参考原图（不参与服务）
scripts/      门禁编排器与生成器；门禁清单的权威在 scripts/gates/run.mjs
tests/        Node half 单测（node:test）
docs/         文档；标准见 docs/AGENTS.md
decisions/    决策记录；契约见 decisions/README.md
```

## 命令

```sh
node scripts/gates/run.mjs              # 本地精选门禁组
node scripts/gates/run.mjs --group ci   # CI 全量组（含单测）
node --test 'tests/*.test.mjs'          # Node half 单测
node scripts/build-client.mjs           # 生成 client.js
node scripts/build-client.mjs --check   # 校验 client.js 新鲜度（只读）
```

### 按改动面选检查

改动落在哪些表面，就跑覆盖那些表面的**最窄**证据，跑一次；只汇报真正跑过的命令。**不要默认跑全套**，不要为了提交或推送重复跑已经通过的检查——CI 独占穷尽覆盖。

| 改动触达 | 跑什么 |
|---------|--------|
| src/ 状态机行为 | `node --test 'tests/pet-state.test.mjs'` |
| client/ 源码或构建配置 | `node scripts/build-client.mjs --check`，改完跑 `node scripts/build-client.mjs`；验证站 web 运行中跑 `node scripts/verify-client-smoke.mjs <web-url>`（浏览器冒烟：apply 成功 + 宠物渲染，curl 覆盖不到的 client 面） |
| 文档、决策记录 | `node scripts/gates/run.mjs` |
| assets/ sheet 或 manifest | `node scripts/gates/verify-assets.mjs` + 重装 + **刷新页面即可，无需重启 web**（assets 路由按请求读磁盘） |
| index.mjs / src/（Node half，含工具 schema） | `node scripts/gates/run.mjs` + 重装 + **web 重启**（ESM 缓存：同 URL 二次 import 返回旧模块，已挂载过的插件改源码 disable/enable 不生效；仅进程内从未 import 过的插件可首次面板 enable 免重启，见 [decisions/implemented/bug-fix/2026-08-08-tool-schema-dsl-compat.md](decisions/implemented/bug-fix/2026-08-08-tool-schema-dsl-compat.md)）；重启后日志须无 `plugin tree failed to load` |
| 门禁本身 | 对应门禁的自证测试（`node --test 'scripts/gates/*.test.mjs'`） |

## 约定

- **每个非平凡改动必须在同一 PR 内新增或更新至少一条决策记录**；豁免与格式见 [decisions/README.md](decisions/README.md)。
- **约定必须有门禁。** 机械可查的约定写成只拒绝一条不变量的程序；每个门禁有用非法样例证明它会拒绝的测试。门禁清单的权威是 [scripts/gates/run.mjs](scripts/gates/run.mjs)，本文件不手抄。
- **生成物一律不手改**：`client.js` 由 [scripts/build-client.mjs](scripts/build-client.mjs) 生成，改 [client/index.mjs](client/index.mjs)；新鲜度由 `--check` 守护。
- **插件机制契约**：`contributes.tools` 与入口注册的工具**逐名一致**（缺失即启用失败回滚）；bundle 的 `id` 必须等于插件 id（`vlln/whale-girl`）；`client.inject` 只是图元数据，fiber 实际依赖由 bundle 自导出决定。
- **注释与文档写契约，不写推理转录**：行为、时序、异常、后果、所有权、安全使用条件保留；实现叙述、测试走查、评审史、代码复述删除。只写当前态。
- **一个 PR 一种性质**（feature / bug-fix / doc / testing / cleanup）+ 对应标签；独立改动拆开；缺陷在引入它的那个 PR 上修，不往下游打补丁。
- **未被明确要求时不推送、不合并、不发布**；不可逆动作需要针对该具体动作的显式批准。

## 编辑本文件

每条规则保持自包含，同时链接高层文档。能压缩就压缩；本档（L2）不设字数上限。
