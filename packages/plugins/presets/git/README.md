# Git（系统插件）

在项目会话的活动面板提供「变更」与「提交图」两个视图。

## 变更

- 检测当前项目目录是否为 Git 仓库（`git rev-parse --show-toplevel`）。
- 展示 `git status` 的全部变更（已暂存 + 未暂存 + 未跟踪）为**文件树**：
  - `M` 修改 / `A` 新增 / `D` 删除 / `R` 重命名 / `U` 未跟踪；折叠的文件夹含变更后代时打「●」。
  - 不列 gitignore 忽略文件（避免 `node_modules` 淹没）。
- 点击文件**内联展开 diff**（工作区 vs HEAD；未跟踪文件按新增合成）。
- 变更页底部可填写提交说明；「生成提交说明」用当前 diff 调用宿主默认模型，确认后 `git add -A` 并 `git commit`。
- 非 Git 项目展示「初始化仓库」CTA，点击执行 `git init`。
- 刷新：对话轮结束（agent 改文件后）+ 窗口重新聚焦 + 手动刷新按钮。

- 分组显示冲突、已暂存、未暂存及未跟踪文件，支持树状/列表切换。
- 选择文件查看差异：已暂存文件对比 HEAD 与暂存区，未暂存文件对比暂存区与工作区。
- 支持暂存、取消暂存、丢弃修改、处理冲突、创建提交和分支，以及 fetch/pull/push。

## 提交图

- 活动面板标签卡：`ui.slot.activity-tab`，`scope_use: ["project"]`。
- 对话事件：`agent.session.read`（订阅 `turn-end`）。
- 命令执行：`agent.command.run` + `plugin.json` 的 `commands: ["git"]`。用户可在插件设置里关闭
  `git` 命令；关闭后调用被拦截并通知。详见 `docs/adr/0032`。
- 文本推理：`ai.complete`（生成提交说明走 `ctx.ai.complete`，使用用户已配置的默认模型）。

- 按本地/远端分支浏览历史，点击提交查看信息与相对第一父提交的全部变更文件；首次提交相对空树。
- 文件目录默认列表，可切换树状并记住选择。目录使用独立滚动区域；选择文件切换下方差异。
- 悬浮提交行不覆盖显示作者和时间，这些信息保留在点击后的详情中。
- 右键提交可以复制 SHA、从该提交创建分支、检出为分离 HEAD，以及执行 soft/mixed/hard reset。
- 创建分支不会自动切换。检出和 reset 必须确认；reset 对当前分支（或分离 HEAD）生效，不会推送远端。
- Soft 保留暂存区与工作区；Mixed 重置暂存区、保留工作区；Hard 同时重置两者，未提交的受跟踪修改会丢失，妨碍检出的未跟踪文件也可能被删除。
- reset 执行前复核确认时的分支和 HEAD；若已变化则拒绝，需重新打开确认框。所有写操作沿用插件的串行队列，失败显示 Git 原始错误。

## 差异渲染与刷新

两个视图共用 `components/PatchContent.tsx`，通过 `@pierre/diffs/react` 的 `PatchDiff` 提供语法高亮和主题适配；变更页还支持并排/统一视图。二进制、无文本差异或渲染失败使用 `DiffView` 展示提示或基础差异。

变更页在回合结束、窗口重新聚焦和手动刷新时更新。提交图在手动刷新和插件刷新信号后更新，包括上述提交操作完成后。尚未使用文件系统 watch。

## 平台边界

通过 `agent.command.run` 与清单声明的 `git` 命令调用宿主，不经过 shell。用户关闭命令授权后，宿主会拦截操作。

## 验证

从仓库根目录运行：

```sh
bun run --cwd packages/plugins/presets/git test
bun run --cwd packages/plugins/presets/git check
```

交互测试使用真实组件与宿主命令 API 的测试替身；Git 集成测试仅操作临时仓库，不接触用户项目状态或远端。
