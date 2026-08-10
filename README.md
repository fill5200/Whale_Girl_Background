# whale-girl

DSH Web GUI 内的桌面宠物（QQ 宠物形态）。**积累型伙伴**：右下角悬浮、可拖拽、可投喂/玩耍；宠物不模拟饥饿/心情（零负反馈——不会因被冷落而难受），它的"生命"= 工作台脉搏——完成任务/会话/陪伴时长积累成**资历等级、称号与回忆**（完整成长系统见 [docs/growth-system.md](docs/growth-system.md)）。

## 安装与启用

官方 repository-plugin 格式（`.dsh-plugin/` 子目录 + `package.json#dsh.entry`）。在 `$DSH_HOME/config.yaml` 加入（**ref** = 仓库某个提交的完整哈希，如 `f5e6c07bf06c…`——锁定安装的版本；官方机制要求精确 ref，不支持 `latest`/分支）：

```yaml
repository-plugins:
  repositories:
    - github:dsh-external/whale-girl#f5e6c07bf06c&path:/.dsh-plugin
```

上面的 ref 可直接复制使用；需要更新插件时换成仓库 main 的最新提交哈希（HMR 事务性换代，无需重启）。

启用后刷新 Web 页面，右下角出现宠物：点击弹出菜单（🍗 投喂 / 🎾 玩耍），拖拽可移动；状态条显示资历（等级/任务数）与最近共同回忆（hover 宠物显示）。初始配置/欢迎页（onboarding）宠物隐藏。

## 支持的动作与触发事件

| 你做什么 / 发生什么 | 宠物表现 |
|---|---|
| 拖拽宠物 | 被斜向拉扯（`drag`） |
| 点击菜单 🍗 投喂 | 啃咬（`eat`）→ 开心（`joy`） |
| 点击菜单 🎾 玩耍 | 抛接球（`play`）→ 开心（`joy`） |
| 空闲 ≥60s | 打盹（`sleep`）；拖拽/投喂/玩耍/开菜单时醒过来（`wake`） |
| 任务完成 / 升级 / 称号 | 举手欢呼（`celebrate`） |
| 任务失败 / 请求出错 | 惊吓（`error`）→ 失落（`disappointed`） |
| 新会话开始 | 挥手欢迎（`welcome`） |
| 任一会话运行/思考中 | 沉思陪伴（`think`，偶尔`working`工作姿态） |
| 等待批准 | 期待等待（`wait`） |
| 周期游走 | 散步（`walk`） |
| 常态 | 待机（`idle`，随机眨眼/转身） |

完整状态机（优先级/转换语义/触发源）见 [docs/state-machine.md](docs/state-machine.md)。

## 状态与动画预览

| 状态 | 触发 | 预览 |
|---|---|---|
| `idle` | 常态待机（随机眨眼/转身） | ![idle](docs/preview/idle.gif) |
| `working` | 会话思考期随机工作插曲 | ![working](docs/preview/working.gif) |
| `celebrate` | 任务完成/升级/称号/回合完成 | ![celebrate](docs/preview/celebrate.gif) |
| `error` | 任务失败/请求出错 | ![error](docs/preview/error.gif) |
| `disappointed` | 失败后短时失落 | ![disappointed](docs/preview/disappointed.gif) |
| `joy` | 投喂/玩耍后开心 | ![joy](docs/preview/joy.gif) |
| `eat` | 点击投喂 | ![eat](docs/preview/eat.gif) |
| `play` | 点击玩耍 | ![play](docs/preview/play.gif) |
| `drag` | 拖拽中 | ![drag](docs/preview/drag.gif) |
| `walk` | 周期游走 | ![walk](docs/preview/walk.gif) |
| `sleep` | 空闲 ≥60s | ![sleep](docs/preview/sleep.gif) |
| `wake` | 睡醒过渡 | ![wake](docs/preview/wake.gif) |
| `welcome` | 新会话 | ![welcome](docs/preview/welcome.gif) |
| `think` | 会话思考陪伴 | ![think](docs/preview/think.gif) |
| `wait` | 等待批准 | ![wait](docs/preview/wait.gif) |

## 配置

参数（尺寸/透明度/游走/睡眠/窗口时长）经宿主 settings 配置，`<dshHome>/settings.yaml` 的 `whale-girl:` section（或设置 UI）修改后**热生效免重启**：

```yaml
whale-girl:
  size: 110          # 宠物尺寸 px（64–160）
  opacity: 1         # 常态透明度（0.2–1）
  walk:
    enabled: true    # 游走开关
  sleepAfterMs: 60000
```

完整配置项清单与语义层（XP/称号）封闭说明见 `.dsh-plugin/src/config.mjs`。**语义层不可配**（改 XP/称号阈值会破坏积累账本一致性，见决策记录）。

## 角色

菜单「🎭 换角色」循环切换角色（或设置 localStorage `whale-girl:character`）。每个角色提供**全部 15 状态**的素材（素材全量契约，见 [docs/sprites-spec.md](docs/sprites-spec.md)）；给 whale-girl 贡献新角色的完整指南（生图契约/槽位/动手步骤）见 [docs/adding-a-character.md](docs/adding-a-character.md)。

## 致谢

角色形象由 [ZipZipPipe](https://space.bilibili.com/4168597) 创作（《鲸鱼娘》表情包角色），sprites 基于其角色设定生成。

## 反馈与贡献

**欢迎提交 issue 和建议**——你的反馈直接决定宠物的下一步：

- 🐛 **遇到问题**（动画异常/交互 bug/状态不符）：提交 issue，附上复现步骤、浏览器与 dsh 版本；如果是客户端问题，附上控制台报错更佳。
- 💡 **功能建议**（新动作/新互动/成长系统扩展）：提交 issue 描述你想要的行为——参考 [docs/state-machine.md](docs/state-machine.md)（状态机）与 [docs/growth-system.md](docs/growth-system.md)（成长系统）了解现状，说明你期待的效果。
- 🎨 **新角色**：想贡献角色素材，见 [docs/adding-a-character.md](docs/adding-a-character.md) §贡献角色速览——只读契约（sprites-spec 状态总表 + 生图提示）、不读代码，产出 15 张 sheet + manifest 条目，本地跑 `verify-assets` 验收即可（换角色零改代码）。
- 🔧 **代码贡献**：改动遵循仓库规范——每个非平凡改动带决策记录（`decisions/`）、门禁自证、单一性质提交（见 [docs/AGENTS.md](docs/AGENTS.md) 与根 [AGENTS.md](AGENTS.md)）。
