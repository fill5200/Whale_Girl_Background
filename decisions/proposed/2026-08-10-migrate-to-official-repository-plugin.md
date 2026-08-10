# Decision: 迁移到官方 repository-plugin 分发（去 plugin-registry 依赖）

Status: proposed

## Problem

whale-girl 当前完全运行在 plugin-registry（社区第三方插件管理器）机制上：`dsh.plugin.json` manifest 协议、`~/.dsh/plugins` 注册表、`dsh registry` 子命令（patch 注入）、`__ModuleLoader__` client 挂载——全部是 plugin-registry 的 patch + package 注入官方树（`patches/dsh-plugin-registry-0808.patch` 的 `+program.command('registry')` 实证）。plugin-registry 自己的评估（`official-0809-coverage.md`）确认：官方 0809 的 repository-plugin 格式已覆盖其 ~95% 能力（打包/安装/分发/启停/HMR），并实证「UI 插件经 entry 自渲染，不需要 client-half 机制」——社区层剩余价值只剩管理控制台 UI。whale-girl 应迁到官方格式，去掉对社区第三方的依赖。

## Proposal

### 目标态

whale-girl 以官方 **repository-plugin**（0809）分发：仓库含 `.dsh-plugin/` 子目录，`package.json#dsh.entry` 声明完整 Cordis 插件入口，`scripts.prepack` 经 `dsh-plugin-prepare` 生成固定 wrapper + `dsh-plugin-assets/`；安装 = `$DSH_HOME/config.yaml` 的 `repository-plugins.repositories` 一行（`github:owner/repo#<ref>`）。不再有 `dsh.plugin.json`、`index.json`、`__ModuleLoader__`、`dsh registry`。

### 分面迁移设计

**1. 仓库布局（`.dsh-plugin/` 子目录）**

```
whale-girl/                    # 仓库根（docs/decisions/originals 保留——不参与插件）
├── .dsh-plugin/
│   ├── package.json           # name/version + dsh.entry + scripts.prepack
│   ├── entry.mjs              # re-export 插件入口（Cordis 插件，见 2）
│   ├── client/                # client 源码（自渲染脚本，见 3）
│   ├── assets/                # characters/ + manifest（见 4）
│   └── prepack.mjs            # 调用 dsh-plugin-prepare（官方生成 wrapper）
├── docs/  decisions/  originals/   # 仓库元资产（不进插件包）
```

（官方路径包含规则：贡献路径须留在 `.dsh-plugin/` 目录内——entry/assets 全部收进子目录，与官方 07-30 static-format 的 containment 契约一致；dsh.entry 的外目录指向能力需在 0809 实测确认，保守按「全收进」设计。）

**2. Node half（成本：低——几乎零改动）**

`index.mjs` 已是纯 Cordis 插件（`apply(ctx)` + `inject: ['httpServer','tools','tasks','agents','sessions']` + `defineTool` 注册 pet_feed/pet_play/pet_status + `ctx.provide('pet')`）——**零 plugin-registry import**，只依赖官方服务与 Cordis。迁移动作：
- 移入 `.dsh-plugin/`，`entry.mjs` 直接 re-export（或整体搬移）
- `dsh.plugin.json` 删除；`contributes.tools` 声明删除（官方 entry 无此面——工具由 defineTool 在 entry 内注册，verify-contributes 门禁随之退役）
- 状态卡/交互等无改动

**3. client（成本：中——最大迁移点）**

现状：`client/index.mjs` 是浏览器 bundle，经 `__ModuleLoader__.load({ id, factory })` 由 registry 的 client-modules 挂载进页面。官方无第三方动态 client 机制（coverage 实证：UI 插件经 entry 自渲染，`httpServer` 注册路由 + 浏览器 fetch/iframe/DOM）。迁移：
- client 脚本改为**自执行 DOM 渲染**（去掉 `__ModuleLoader__.load` 契约与 load 守卫，保留全部渲染/交互逻辑）
- entry（index.mjs）注册 UI 路由：`GET /whale-girl/ui.js`（返回 client 脚本，`application/javascript`）+ 复用现有 assets 路由（`/whale-girl/assets/*` 已是 Node half 自实现——见 `src/assets.mjs`）
- **页面注入缝（插件自造）**：官方 GUI 无「第三方插件自动悬浮」机制——entry 需自造注入点（如 httpServer 向宿主页注入 `<script src="/whale-girl/ui.js">`，或经配置/宿主 hole）。这是迁移唯一不确定面，随 0809 实测定方案（web-app 是否提供注入 API / 需自带 patch 提供 hole）

**4. assets（成本：低）**

`assets/characters/` 进 `.dsh-plugin/assets/`；prepack 复制到 `dsh-plugin-assets/`（官方约定）或 entry 直接静态服务 `.dsh-plugin/assets/`（现在 assets 路由已存在，复用）。manifest.json + 15 状态全量契约不变。

**5. 安装/分发（成本：中）**

`config.yaml` 样例：
```yaml
repository-plugins:
  repositories:
    - github:owner/whale-girl#<commit>&path:/.dsh-plugin
```
- 分发 = GitHub 仓库即插件（克隆 + pnpm 准备 + prepack），无发布流程、无注册表
- 工具可用性：entry 内 defineTool（官方完整 Cordis 语义）——宿主 `pet_feed/pet_play/pet_status` 照常

### 执行步骤（Phase 顺序，每 Phase 可独立验证）

1. **Phase 0（前置）**：搭建官方 0809 纯净 worktree（无 plugin-registry patch）——验证 `dsh.entry` 精确契约（声明格式、prepack 产物、wrapper 内容、路径包含规则）与页面注入缝方案
2. **Phase 1（Node half）**：`.dsh-plugin/` 骨架 + entry.mjs + package.json；删 `dsh.plugin.json`/contributes；工具经 entry 注册验证（`dsh` headless 挂载 + 工具调用）
3. **Phase 2（client）**：client 自执行化（去 `__ModuleLoader__`）+ UI 路由 + 注入缝；验证页面加载 → 宠物渲染 + 交互（拖拽/菜单/喂食）
4. **Phase 3（assets/安装）**：assets 收进子目录 + config.yaml 安装验证（新 DSH_HOME + 纯净 profile）
5. **Phase 4（收尾）**：删除 registry 专属物（`dsh.plugin.json`、`index.json` 相关流程、`verify-contributes` 门禁）→ 决策记录 → 门禁/单测/冒烟回归

### Phase 0 结论（2026-08-10 官方源码 + e2e fixture 实证）

官方 0809 快照（`421e96f4`）自带 repository-plugin 机制（`packages/self-modification/repository-plugin` + `packages/boot` RepositoryCache；`/tmp/dsh-0809` worktree 已建，含 plugin-registry 集成残留——纯净验证用 detached 新 worktree）。契约确认：

- **`dsh.entry` 是完整 Cordis 插件**：官方 e2e fixture（`apps/cli/tests/fixtures/github-repository-plugin/.dsh-plugin/`）的 entry 是 `export const name/inject/apply(ctx)` 标准 Cordis 形态——与 whale-girl `index.mjs` 同构；`dsh` 字段 schema（`format.ts`）：`skills[]`/`mcpServers?`/`entry?` 至少一个，`prepack` 必须包含 `dsh-plugin-prepare`，devDependencies 必须含 `@deepseek-ai/dsh-repository-plugin`
- **prepack 产物**：`dsh-plugin.mjs`（固定 wrapper，无 import）+ `dsh-plugin-assets/`（静态资产）
- **containment**（`isOutside`）：贡献路径相对、越出包根拒绝；skills 可指向 `.dsh-plugin/` 外仓库内路径（fixture 的 `../skills` 实证）
- **安装驱动**：cordis patch/config 的 `repository-plugins.repositories` 列表（官方 e2e：`- id: repository-plugins` + `repositories: [github:owner/repo#<ref>]`）
- **UI 注入缝（官方 README 实证）**：「third-party plugin's browser bundle has no dshClient/`__DSH_BOOT__` distribution path yet」——官方无第三方 client bundle 分发路径，whale-girl client 的页面注入必须自造（entry 自渲染 + 插件自带 patch 提供宿主 hole）

## Alternatives considered

**A：继续用 plugin-registry 分发（维持现状）。** 社区层自评 95% 能力被官方覆盖、剩余价值仅管理 UI；且社区是「验证与分发层」项目（AGENTS.md 定位），机制寿命系于 patch 基线维护——长期依赖风险高于迁移成本。

**B：profile bundle 分发（官方 `dsh plugin --profile web add`）。** bundle 是「组合里的产品服务/补丁层」语义（无插件 id、无动态安装），whale-girl 是业务插件——形态不符；且 bundle 是官方通道 2（组合层），不解决「独立用户安装」场景（官方通道 1 = config.yaml repository-plugin 才是独立安装的官方答案）。

**C：保留 registry 的 client 挂载（只把 Node half 官方化）。** 混合依赖——client 仍需 registry patch（`__ModuleLoader__` 是 patch 注入的），等于没去掉依赖；coverage 已实证 entry 自渲染可行——全量迁移。

## Acceptance criteria

- [ ] 纯净官方 0809 环境（无 plugin-registry patch/packages）下：config.yaml 安装 → 挂载成功（日志无 plugin tree failed to load）→ `pet_feed/pet_play/pet_status` 工具可用
- [ ] GUI 页面加载后宠物自动出现（注入缝生效），拖拽/菜单/喂食/玩耍/状态卡交互与现状一致
- [ ] 15 状态素材全量服务正常（assets 路由 200 + sprite 渲染）
- [ ] 仓库无 `dsh.plugin.json`/`index.json`/`__ModuleLoader__` 残留；verify-contributes 退役
- [ ] 行为回归：`verify-client-behavior` 等价场景通过（sleep-drag-wake 链路）
- [ ] 单测/门禁全绿（含退役与新增的门禁自证）

## Risks

- ~~**dsh.entry 精确契约未实测**~~（Phase 0 已确认，见上节）：声明格式/prepack/containment 均从官方源码与 e2e fixture 实证；entry 全部收进 `.dsh-plugin/`（fixture 证明 skills 可外指，entry 保守收内）
- **页面注入缝是插件自造职责**（官方 README 实证无第三方 bundle 分发路径）：entry 自渲染 + 插件自带 patch 提供宿主 hole（plugin-registry 同模式先例：插件仓库自带 patches/ 提供宿主 hole，不入官方树）——评估为可解但需投入
- **基线迁移**：官方 repository-plugin 需 0809 基线（`421e96f4` 已拉取，`/tmp/dsh-0809` worktree 已建）；当前验证站是 0808+patch，验证期间两套并存
- **GUI 兼容**：官方 GUI 注入 `__DSH_BOOT__` 与 registry `__ModuleLoader__` 并存时宠物不得双挂（迁移后旧机制不再加载 whale-girl）

## 相关信息

- 官方机制：`official-0809-coverage.md`（覆盖度 + UI 自渲染实证）、`2026-07-30-config-only-repository-plugins.md`（config.yaml 安装）、`2026-07-30-static-repository-plugin-format.md`（子目录格式与 containment）、`2026-08-08-trusted-repository-package-code.md`（dsh.entry 可信代码）
- 现状实现：`client/index.mjs`（`__ModuleLoader__` 契约）、`index.mjs`（assets 路由已自实现）
