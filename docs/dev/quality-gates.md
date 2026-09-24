# 质量门禁（Quality Gates）

本仓库**没有**照搬 OpenClaw 的 oxlint/pnpm/巨型 CI 矩阵。在现有 **Bun + Turborepo + Biome + tsgo + Vitest + husky** 之上，补了分层门禁、按包/按变更测试与轻量架构守卫；Desktop `verify:ui` 是用户明确要求时才运行的按需验收工具，不属于默认门禁。

## 门禁分层

| 层级 | 命令 | 何时跑 | 内容 |
|------|------|--------|------|
| 提交前（快） | `bun run check:precommit`（husky 自动） | 每次 commit | staged 私钥/冲突标记 + Biome `--staged --write`；格式化后重新暂存整文件 |
| 编辑中（最快） | `bun run check:fast` | 文件已经暂存，想在 1 秒内看结果 | 已暂存文件的私钥、冲突标记和 Biome。只报告问题，不改文件 |
| 开发中（快） | `bun run check:quick` | 一轮编辑后 | 准确合并分支已提交差异、暂存、未暂存和未跟踪文件；对变更文件运行 Biome、私钥和冲突标记。不跑架构守卫，不做类型检查 |
| 架构引擎 | `bun run check:arch` | 改了包边界或 Coding Agent 架构 | 并行执行 YAML 架构引擎（包边界、Coding Agent 架构）。其余守卫仍由 `check:guards` 负责 |
| lint + 类型 + 架构引擎 | `bun run check:full` | 完整 `check` 之前想先看这三项 | 并行 `check:lint`、`check:types`、`check:arch`。不含其余守卫和 Mobile lint，不能代替 `check` |
| 完整本地/PR/CI | `bun run check` | 一轮代码任务完成、交付、开 PR，以及 CI | 对显式源码根运行 Biome，并行执行根 `tsgo`、CLI 显式 `tsgo`、增量 desktop `tsc`、docs check 与全部架构守卫 |
| 构建声明消费 | `bun run check:types:build-surfaces` | workspace 前置声明生成后 | 按 `cli-host/tsconfig.build.json` 验证真实包声明消费；会拒绝陈旧 `dist/*.d.ts` |
| 质量脚本测试 | `bun run test:quality` | 修改 `scripts/quality` | 变更选择、依赖传播与包边界规则 |
| 单元测试 | `bun run test` / `bun run test:unit` | 逻辑变更 | 先由 Turbo 生成测试消费的 workspace 依赖产物，再顺序运行所有声明 `test` 的 TypeScript workspace |
| 按包 | `bun run test:pkg <name>` | 改单包 | 例：`test:pkg ai` |
| 按任务影响 | `bun run test:impact -- <file...>` | 日常实现与 Agent 任务 | 直接运行显式测试和 Vitest 依赖相关测试；根配置、已删除的 workspace 文件、公共入口和合同目录回退 `test:changed` |
| 按变更 | `bun run test:changed` | 提 PR 前可选 | 合并已提交/工作区/未跟踪改动，测试触达包及其下游依赖 |
| 按需 Desktop UI 验收 | `bun run verify:ui:*` | 仅用户明确要求使用 UI 验证或具体命令时 | 不由 UI、图标、样式或 Renderer/Main 改动自动触发；见 [README](./README.md) |
| Desktop 生产边界 | `bun run verify:desktop:contracts`；受影响时由 GitHub Actions 在 Windows/macOS/Linux 运行 packaged smoke 与 updater E2E | 修改 Desktop 主进程、preload、打包脚本、原生依赖或远程控制 | 见下文 |
| 死代码（可选） | `bun run deadcode:report` | 清理时 | Knip 报告，**默认不阻断** `check` |

## 新增脚本

```text
scripts/quality/
  lib.mjs                      共享工具
  precommit.mjs                快路径编排
  check-lint.mjs               显式源码根的全量 Biome 入口
  check-guards.mjs             并行全量守卫入口
  check-quick.mjs              按完整 Git 工作区差异做 Biome 和快速守卫
  check-fast.mjs               已暂存文件的私钥、冲突标记和只读 Biome
  check-architecture.mjs       并行跑包边界和 Coding Agent 架构引擎
  check-private-keys.mjs       私钥形态检测
  check-conflict-markers.mjs   未解决冲突标记
  check-package-boundaries.mjs 库/插件不得依赖 app 宿主
  check-coding-agent-architecture.mjs
                               Coding Agent 当前架构依赖与公开面，读取 rules/coding-agent-architecture.yml
  check-runtime-boundaries.mjs Runtime 不依赖产品层、subagent 内核边界、失败契约，读取 rules/runtime-boundaries.yml
  run-vitest.mjs               用 Node 启动 Vitest（Windows 上禁止 Bun 拉起 worker）
  check-vitest-runner.mjs      package.json 测试脚本必须走 run-vitest.mjs
  check-turbo-config.mjs       Turbo 输入、环境、入口与 Remote Cache 安全合同
  check-source-path-maps.mjs   根 tsconfig path map 必须显式覆盖 workspace 包的 types 子路径导出
  test-pkg.mjs                 按包名跑 vitest
  test-impact.mjs              按任务文件选择直接测试与 Vitest 相关测试
  test-changed.mjs             按 git 变更和依赖图选包
  quality-gates.test.mjs       质量脚本定向测试
  arch-engine/ast-walker.mjs   可序列化的 TypeScript 语法树
  arch-engine/cache.mjs        按 mtime 与内容 hash 缓存语法树
  arch-engine/rule-engine.mjs  从 YAML 加载并执行 forbidden-import
  arch-engine/boundary-rules.mjs 加载并执行包边界 YAML
  check-package-boundaries.legacy.mjs 迁移前的包边界实现，只给差分测试对照
  package-boundaries-differential.test.mjs 新旧包边界结果对照
  rules/package-boundaries.yml 包边界规则，由 check-package-boundaries.mjs 读取
  check-coding-agent-architecture.legacy.mjs 迁移前的 Coding Agent 架构实现，只给差分测试对照
  coding-agent-architecture-differential.test.mjs 新旧 Coding Agent 架构结果对照
  rules/coding-agent-architecture.yml Coding Agent 架构规则，由 check-coding-agent-architecture.mjs 读取
  arch-engine/coding-agent-rules.mjs 加载并执行 Coding Agent 架构 YAML
  arch-engine/runtime-rules.mjs 加载并执行 Runtime 边界 YAML
  rules/runtime-boundaries.yml Runtime 边界规则，由 check-runtime-boundaries.mjs 读取
knip.config.ts                 Knip（可选）
```

## 架构引擎

`scripts/quality/arch-engine/` 是架构守卫共用的解析、缓存和规则执行。`check-package-boundaries`、`check-coding-agent-architecture` 和 `check-runtime-boundaries` 已经改为读取 YAML；会话消息架构等其余守卫还没有迁过来。

`parseSource(filePath, text)` 按扩展名选择 script kind（`.tsx` / `.jsx` 才会解析 JSX），返回一棵可写成 JSON 的语法树。节点字段：

| 字段 | 含义 |
| --- | --- |
| `kind` | TypeScript `SyntaxKind` 的名字，例如 `ImportDeclaration` |
| `start` / `end` | 源码偏移 |
| `line` | 从 1 开始的行号 |
| `text` | 标识符（含 `#private`）、字符串、数字、bigint、JSX 文本和正则才有；字符串是去掉引号后的内容 |
| `typeOnly` | 仅 type-only 的 import / export 为 `true` |
| `children` | 子节点；没有子节点时省略 |

`walkAst(node, visit)` 先序遍历。`visit` 返回 `false` 时不再进入子节点。`findNodes(node, predicate)` 收集命中的节点。模块说明符是 `ImportDeclaration` 下面的 `StringLiteral`。

从 `scripts/quality/` 里的脚本这样用：

```javascript
import { findNodes, parseSource } from "./arch-engine/ast-walker.mjs";

const ast = parseSource("src/mod.ts", 'import { Foo } from "@vetta/desktop";\n');
const specifier = findNodes(ast, (node) => node.kind === "ImportDeclaration")[0]?.children?.find(
	(node) => node.kind === "StringLiteral",
)?.text;
```

`createAstCache({ root, cacheDir })` 把解析结果写到 `cacheDir/ast/` 下的 JSON 文件。`cacheDir` 默认是 `<root>/.cache/quality`，`root` 默认是进程的当前工作目录。`load` 接受仓库内的相对路径或绝对路径，两种写法共用同一条缓存。路径必须留在 `root` 里；指到外面的符号链接会直接拒绝。

每次 `load` 都会读文件并计算内容 hash。修改时间按毫秒取整。缓存身份按下面四条处理：

- 没有记录，或记录的 `AST_FORMAT_VERSION` 对不上、JSON 读不出来：解析并写入（未命中）
- 取整后的修改时间和内容 hash 都与记录一致：直接返回已缓存的树（命中），不再解析
- 只有修改时间变了：记一次 mtime 失效并重新解析。内容没变也会再解析，避免一次 touch 沿用旧的缓存身份
- 内容 hash 变了：记一次 hash 失效并重新解析。即使把修改时间改回原来的值，也不会继续用旧语法树

`stats()` 返回 `hits`、`misses`、`mtimeInvalidations`、`hashInvalidations`、`parses` 和 `hitRate`（命中次数 / 全部读取次数）。返回的树归缓存所有，调用方不要改它。同一个进程还会把已经读过的树留在内存里，直到这个进程退出；这期间删掉 `<root>/.cache/quality` 不会让下一次 `load` 重解析。新开的进程看不到这些文件，会重新解析。语法树字段变化时要抬高 `AST_FORMAT_VERSION`，旧文件会当作未命中。

## 声明式规则

`scripts/quality/arch-engine/rule-engine.mjs` 能加载下面这种 `forbidden-import` 配置。`check` 不会把整个 `rules/` 目录交给这个加载器。包边界的现行规则是另一份结构，见后面的「包边界规则」。

一份配置是一个 mapping，字段都要有：

| 字段 | 含义 |
| --- | --- |
| `name` | 这组规则的名字 |
| `description` | 一句话说明这组规则在管什么 |
| `rationale` | 为什么要这条约束 |
| `examples` | 列表。每一项有 `violation` 和 `fix`，分别是一段会违规的写法和对应改法。可以是空列表 |
| `rules` | 至少一条规则 |

一条 `forbidden-import` 规则的字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 违规对象上的规则名，同一份配置里不能重复 |
| `type` | 目前只接受 `forbidden-import` |
| `sources` | 仓库内相对路径的 glob。文件不命中就不检查 |
| `targets` | 模块说明符的 glob。命中的 import 算违规 |
| `message` | 写给读者的说明，原样出现在违规里 |

`sources` 对的是文件路径，例如 `packages/ai/src/index.ts`。`targets` 对的是说明符原文，例如 `@vetta/desktop` 或 `../test/fixture`，不会先解析成磁盘路径。会算进去的依赖边是 `import`、`export ... from`、`import()`、`require()`、`import x = require()`，以及类型位置的 `import("模块")`。`import type` 也算。没有插值的模板字符串、写在类型参数后面的说明符也算，说明符外面的括号会去掉。注释、普通字符串、带 `${}` 的模板，以及 `import(name)` 这种不是字面量的说明符，不算。被调用的名字是 `require` 时会当成依赖，即使它是当前文件里的本地函数；引擎不做作用域分析。

glob 按 `/` 分段。`*` 和 `?` 只匹配一段里面的字符，`**` 匹配零段或多段。写在末尾的 `**` 也匹配零段，所以 `@vetta/desktop/**` 同时盖住 `@vetta/desktop`。以 `!` 开头的模式表示排除，按书写顺序生效，后面的模式可以再把文件选回来。模式使用 `/`。以 `*`、`!`、`@` 或 `&` 开头时必须加引号；不加引号的 `!` 会被 YAML 当成标签。

```yaml
rules:
  - name: libs-must-not-depend-on-apps
    type: forbidden-import
    sources:
      - packages/ai/**
    targets:
      - "@vetta/desktop"
      - "@vetta/desktop/**"
    message: Core libraries must not depend on application packages
```

在仓库根目录这样跑一份 `forbidden-import` 配置。下面的 `example.yml` 只说明调用方式，不是现行的 `package-boundaries.yml`。

```javascript
import { readFileSync } from "node:fs";
import { checkDocument, parseRuleDocument } from "./arch-engine/rule-engine.mjs";

const source = "scripts/quality/rules/example.yml";
const document = parseRuleDocument(readFileSync(source, "utf8"), source);
const path = "packages/ai/src/index.ts";
const violations = checkDocument(document, [{ path, text: readFileSync(path, "utf8") }]);
```

`violations` 是 `CheckViolation` 数组。`file` 用 `/`，`line` 从 1 开始，`rule` 和 `message` 来自 YAML。配置读不出来、字段缺失、规则类型不认识，或者 glob 是空的，会抛 `RuleDocumentError`，消息里带文件路径。`loadRuleDirectory` 按文件名顺序读取目录里的 `.yml` 和 `.yaml`，其它文件忽略。

## 守卫错误处理

新守卫，以及从旧写法迁过来的守卫，用 `scripts/quality/lib.mjs` 里的 `CheckViolation` 和 `runCheck()`。失败信息只有一种格式：

```text
[guard] file:line: message (rule)
```

`CheckViolation` 记下 `file`、`line`（从 1 开始）、`rule`、`message` 和 `severity`。`severity` 默认是 `error`。目前只要返回了违规，检查就失败；严重级别先记在对象上，不单独决定退出码。

`runCheck(name, checkFn)` 调用 `checkFn`，期望它返回 `CheckViolation[]`：

- 空数组：向 stdout 打 `[name] passed`，返回 `0`
- 有违规：每条打到 stderr，返回 `1`
- `checkFn` 抛错：打 `[name] internal error: ...`，返回 `1`

它不调用 `process.exit()`，也不改 `process.exitCode`。测试可以传入 `{ log, error }` 把输出接走。脚本只有在被直接运行时才把返回码赋给 `process.exitCode`。

包边界检查沿用扫描文件数作为成功输出，因为操作者要知道扫过多少文件。失败时仍是上面的 `[package-boundaries] 文件:行号: 说明 (规则)`，下一行再打出 YAML 里的 `fix`。规则文件读不出来时打印 `[package-boundaries] internal error: ...`。Coding Agent 架构检查同样保留源文件数、模块边数和 manifest 导出数作为成功输出；失败时除了 `[coding-agent-architecture] 文件:行号: 说明 (规则)`，还会列出 YAML `docs` 里的 ADR 和设计文档。

Runtime 边界把原来的三道检查放在同一次运行里。成功时仍分别打印合并前的计数，前缀是 `[runtime-independence]`、`[runtime-subagents-boundary]`、`[runtime-failure-contract]`。失败时仍打印合并前的句子，不加 `(规则)`，否则和已经写进测试的说明对不上。某一道读文件失败只打印自己的 `[标签] internal error: ...`，另外两道照常出结果。直接运行时把返回码赋给 `process.exitCode`。

```javascript
import { CheckViolation, isDirectRun, lineNumberAt, runCheck } from "./lib.mjs";

export function findDemoViolations(file, text) {
	const index = text.indexOf("FIXME");
	if (index === -1) return [];
	return [new CheckViolation(file, lineNumberAt(text, index), "demo-fixme", "unresolved FIXME")];
}

export function main() {
	return runCheck("demo", () => findDemoViolations("apps/demo.ts", "ok\nFIXME\n"));
}

if (isDirectRun(import.meta.url)) process.exitCode = main();
```

多个文件用 `collectFileViolations(files, findInText, readFile)`：读不到的文件会跳过，再把每个文件的违规拼起来。已经迁移的三个守卫都走它。抛出的异常会变成上面的 internal error，不要在检查函数里退出进程。

已经按这个模式运行的守卫：`check-private-keys.mjs`（`private-key`）、`check-conflict-markers.mjs`（`conflict-markers`）、`check-skill-frontmatter.mjs`（`skill-frontmatter`）。成功时只打 `[name] passed`，不再附带扫描文件数。

## 根 package.json scripts

| Script | 说明 |
|--------|------|
| `build` / `build:all` | 由 Turborepo 按 workspace manifest 构建库或完整 Desktop 依赖图；Preset 仍走专用制品流程 |
| `build:desktop` / `build:cli` / `build:docs` / `build:preset` | 构建指定产品或制品，依赖包由任务图自动补齐 |
| `check:lint` / `check:lint:fix` | 对显式源码根执行 Biome 只读检查 / 写回，避免扫描无关目录 |
| `check:types` | 并行执行根 `tsgo`、CLI 显式 `tsgo`、带持久增量缓存的 desktop `tsc`、docs check 与 Expo Mobile `tsc` |
| `check:types:build-surfaces` | 使用 CLI build config 验证上游 workspace `dist/*.d.ts` 的真实消费面；要求先生成当前声明 |
| `check:guards` | 并行执行私钥、冲突标记、包边界等全量守卫 |
| `check:staged` | 仅 staged Biome，会写回 |
| `check:precommit` | husky 使用的快路径 |
| `check:fast` | 已暂存文件的私钥、冲突标记和只读 Biome |
| `check:quick` | 变更文件 Biome + 私钥 + 冲突标记；不跑架构守卫。Biome 配置变化时自动回退全量 Biome |
| `check:arch` | 包边界和 Coding Agent 架构这两项 YAML 引擎 |
| `check:full` | 并行 lint + types + `check:arch`。不含其余守卫和 Mobile lint |
| `check` | 并行 lint + types + guards + Expo Mobile lint（只读）。CI 用这条 |
| `fix` | Biome 全量格式化与安全修复 |
| `vitest` | 用 Node 启动仓库 Vitest；等价于 `bun scripts/quality/run-vitest.mjs` |
| `test:quality` | 质量脚本定向测试 |
| `test` / `test:unit` | 从 workspace manifest 自动发现并顺序运行所有声明 `test` 的包 |
| `test:pkg` | 见 `bun run test:pkg --list` |
| `test:impact` | 显式任务文件走精确测试；根配置、已删除的 workspace 文件、公共入口和合同目录回退 `test:changed` |
| `test:changed` | 默认比较 `origin/dev`；`--base origin/main` 可改基线 |
| `deadcode` / `deadcode:report` | Knip 严格 / 仅报告 |

### 单测覆盖率（可选，不进门禁）

根依赖 `@vitest/coverage-v8`（与 `vitest` 3.x 对齐）。**默认 `test` / husky / `check` / CI 均不启用**覆盖率。

按需在包根执行：

```bash
bun run --cwd packages/coding-agent test:coverage
bun run --cwd apps/desktop test:coverage
```

- 报告目录：包内 `coverage/`（已 gitignore）；含 text / html / lcov
- 分母：`src/**/*.{ts,tsx}`（诚实全量；desktop 总百分比低是现状，不是配置错误）
- `reportOnFailure: true`：单测失败仍会出报告（coding-agent 在 Windows 上仍有已知基线失败）
- 不设全局 thresholds；不进 husky / `check` / CI；用户明确要求 UI 验收时使用 `verify:ui:*`
- `@vitest/coverage-v8` 主版本须与根 `vitest` 对齐（当前均为 3.2.x）

## Windows 上必须用 Node 跑 Vitest

Vitest 3 默认 `pool: "forks"`。用 Bun 在 Windows 上拉起 worker 时，`import.meta.url` 经常被编成非法 `file://`（例如 `file://C:/...` 而不是 `file:///C:/...`），于是每个分片在收集测试前就报 `File URL path must be an absolute path`。换成 `threads` / `vmThreads` 会改报 `port.addListener is not a function`。

统一入口：

```bash
bun scripts/quality/run-vitest.mjs --run <test-file>
bun run vitest --run <test-file>
bun run test:pkg <name>
```

包装器会查找 Node 20+（可用 `VETTA_TEST_NODE` 指定 `node.exe`），再执行仓库里的 `node_modules/vitest/vitest.mjs`。不要使用 `bunx vitest`、`npx vitest` 或包脚本里的裸 `vitest`。`check-vitest-runner.mjs` 会扫描 workspace `package.json` 并拒绝这些入口。

## 包边界规则（`check-package-boundaries`）

现行规则在 `scripts/quality/rules/package-boundaries.yml`。`check-package-boundaries.mjs` 读取这份文件。新增一条导入、标识符或声明限制时改 YAML，不用改检查脚本。`scripts/quality/check-package-boundaries.legacy.mjs` 是迁移前的实现，只给差分测试对照，不要在那里加规则。

一条规则至少要有 `name`，并用 `scope` 选文件。`prefix` / `path` / `suffix` 命中任一即可；`notPrefix`、`notPath`、`notSuffix` 是排除。`excludeTestFile` 跳过 `test` 目录和测试文件名，`excludeTestSuffix` 只跳过测试文件名，`requireSrc` 要求路径里有 `/src/`。`imports` 检查模块说明符，`walk` 检查标识符、字面量、声明、`new` / 调用和属性访问，`textIncludes` / `textGate` 检查原文，`bannedPath` 表示这个路径本身不该存在。`report` 是写进结果里的那句说明，`fix` 是失败时另外打印的改法。文件选择用架构引擎的 glob。

违规结果与迁移前一致：`findPackageBoundaryViolations` 仍返回 `路径: 说明`。直接跑检查时，失败行是 `[package-boundaries] 文件:行号: 说明 (规则)`；没有违规时仍打印扫描文件数。

依赖方向与 README 一致：**应用 → runtime-\* / coding-agent / agent / ai**；核心库不感知宿主。

守卫会扫描 lib/plugin 源码，禁止：

- 从 `packages/ai`、`agent`、`coding-agent`、`runtime-*`、`plugin-sdk` 等 **import 宿主应用**（`desktop` / `cli-host` / `admin` / `site` 及对应路径）
- 生产代码 import 其它包的 `test/` 树
- plugin presets/externals **deep-import** `desktop/src/**`

`coding-agent/examples/**` 已排除。

## Coding Agent 架构规则（`check-coding-agent-architecture`）

现行规则在 `scripts/quality/rules/coding-agent-architecture.yml`。`check-coding-agent-architecture.mjs` 读取这份文件。新增一条依赖方向、退役路径或宿主注入要求时改 YAML，不用改检查脚本。`scripts/quality/check-coding-agent-architecture.legacy.mjs` 是迁移前的实现，只给差分测试对照，不要在那里加规则。

该守卫不生成全量 AST 模块图，也不启动 TypeScript TypeChecker。它只用 TypeScript AST 从
`import`、`export ... from` 和动态 `import()` 中提取模块边，再执行声明式规则，因此不会把注释、
字符串或同名变量误判为依赖。直接跑检查时，失败行是 `[coding-agent-architecture] 文件:行号: 说明 (规则)`，最后再列出文档里的 ADR 和设计文档；没有违规时仍打印源文件数、模块边数和 manifest 导出数。开发者从 `findCodingAgentArchitectureViolations` 拿到的说明文字与迁移前一致。

一条规则是一组按书写顺序执行的步骤。常用步骤：`eachFile` / `eachEdge` / `eachSourcePath` 遍历输入；`when` 用路径、说明符、文本或路径类别过滤；`unlessText` / `unlessAll` / `unlessAny` / `unlessImport` 表示文件在场但缺少要求的文本或导入；`ifSourceHas` / `ifExport` 表示退役路径或 package export 不得出现。路径类别写在 `classes`，重复的路径表写在 `lists` 或 `groups`。`findCodingAgentArchitectureViolations` 仍返回迁移前的整句说明。新的检查种类才需要改解释器；现有种类的路径、正则和说明只改这份 YAML。

长期规则包括：

- 合同不能反向依赖 Adapter、Composition 实现、Host 实现或公开门面；
- 产品能力域不能依赖 Adapter、Composition 实现或公开门面；
- Adapter 可以依赖 Composition 合同，但不能反向依赖 Composition 实现或公开门面；
- 历史会话格式模块不能依赖 Agent 执行；格式转换与文件生命周期可以在 `sessions/legacy` 边界内按职责拆分；
- 外部工具会话格式模块同样不能依赖 Agent 执行或 Node I/O，只能位于 `sessions/external`，与历史格式边界并列；
- 外部消费者只能使用 `package.json#exports` 声明的稳定子路径，支持精确和通配符导出；
- 包根保持 Extension facade；Composition 允许扩展根级能力与合同，但不能导出内部组装实现；
- 旧 `src/core`、`src/compat` 实现目录不得恢复。

公开子路径以 manifest 为唯一事实来源，不在守卫中维护第二份符号或子路径快照。旧迁移进度基线、
Greenfield/Legacy 名称墓碑、固定文件数量、行数阈值及实施日志格式不再进入构建门禁。
架构规则测试位于 `scripts/quality/coding-agent-architecture.test.mjs`。

## Runtime 边界规则（`check-runtime-boundaries`）

现行规则在 `scripts/quality/rules/runtime-boundaries.yml`。`check-runtime-boundaries.mjs` 读取这份文件，在 `check:guards` 里一次跑完原先分开的三道检查：Runtime 不依赖 Coding Agent、`runtime-subagents` 的内核边界、生产失败契约。`check:arch` 不跑这一项。

改禁用依赖、源码里的产品词、必须存在或已经退役的文件、失败契约标记、按正则禁止的恢复判断时，改 YAML，不用改检查脚本。直接跑检查时，三道检查仍各自打印原来的 `[runtime-independence]`、`[runtime-subagents-boundary]`、`[runtime-failure-contract]`。没有违规时仍打印原来的计数。`findRuntimeCodingAgentIndependenceViolations`、`findRuntimeSubagentsBoundaryViolations` 和 `findRuntimeFailureContractViolations` 返回的说明与合并前一致。

`guards` 按书写顺序执行。`input` 决定输入形状：`manifests` 扫若干包的清单和源码，并用 `manifests.key` 禁止一个依赖名；`manifest` 扫一个包，`manifests.keyPrefix` 禁止该前缀的依赖，`lines` 按行禁止词，`requiredFiles` / `retiredFiles` 要求文件在或不在；`files` 扫边界文件，`markers` 要求原文包含标记，`patterns` 是整文件正则。调用 `findRuntimeFailureContractViolations` 时传 `requireBaseline: false` 就只跑正则。

`lines` 里的 `path` 是整条路径相等才检查，`whenPathIncludes` 是路径包含该段才检查。说明里的 `{section}`、`{dependency}`、`{token}`、`{marker}` 会换成实际命中的值。

## Workspace 构建编排（Turborepo）

根 `turbo.json` 将每个 workspace 的 `package.json#scripts.build` 组成任务图，`build.dependsOn = ["^build"]` 保证内部依赖先构建。包清单和依赖边只维护在 Bun workspace 与各包 manifest 中，不再维护根 shell 顺序、Desktop 分层或第二套通用哈希实现。

缓存边界如下：

- 普通包声明 `dist/**`、插件 `release/**` 和 Next `.next/**` 为输出；lockfile、内部依赖任务哈希、根 `tsconfig.base.json`、根 `.env*` 与显式构建变量共同决定本地缓存键。包根 `test/**`、`tests/**`、README 和 CHANGELOG 不影响 build；`src/**` 内或被生成/打包脚本读取的资源仍参与哈希。
- Desktop 完整 `build` 包含平台模型、生成、插件 staging 和多入口 bundle，初始阶段明确 `cache: false`。
- Remote Cache 默认关闭且预先要求 HMAC 制品签名；启用前必须按 [Remote Cache 启用清单](./turborepo-remote-cache-rollout.md) 验证跨平台制品、环境变量、日志脱敏和缓存完整性，配置 `TURBO_REMOTE_CACHE_SIGNATURE_KEY`，并更新 ADR-0079。
- Turbo 使用 strict environment mode。普通 build 只声明 `NODE_ENV`、`VETTA_PLUGIN_DEV_WATCH`、`VETTA_PLUGIN_DOCS_SRC` 和 `VETD_SRC`；Docs build 额外按自身合同声明 `DOCS_SITE_URL`，Desktop build 独立声明 `VETTA_*`/`VETD_*`，dev task 保留这些通配变量。新增影响构建的变量必须进入范围最小的 task `env`；只需运行时可见且不影响输出的秘密变量应审查后进入 `passThroughEnv`。

plugin-workbench 的 `prebuild` 会同步根 `docs/plugin/**`，该目录通过 `$TURBO_ROOT$` 作为其显式输入；其它包不会因插件文档变化而失效。

Desktop build task 显式依赖 `@vetta-org/plugin-vite`。开发前置构建读取本地 Turbo 缓存；正式打包入口带 `--force`，继续无条件执行 workspace 构建并写入新缓存。Preset 的租户选择、zip 校验与 staging 仍由 `build-presets.mjs` 负责，但正式 Desktop build 复用 Turbo 已构建的 plugin tooling；独立 `build:preset` 才自行准备 tooling。

根 build、Desktop 前置 build 和测试依赖 build 均使用 `--summarize`。本地 summary 位于 `.turbo/runs/`（已忽略），CI 的三平台单测 job 将其作为保留 7 天的诊断制品上传；summary 用于观察任务耗时、哈希和命中状态，不作为构建成功的第二事实源。

新增或修改 workspace 依赖后必须执行正常的 `bun install`；`bun install --lockfile-only` 只更新锁文件，不创建包级 workspace 链接。可用 `bunx turbo run build --dry=json --filter=<package>` 检查任务闭包和依赖原因。

`test:changed` 会从根 workspace 和各包 `package.json#scripts.test` 自动发现可测包，并按全部 workspace manifest 自动计算下游依赖闭包；没有测试脚本的上游包发生变化时，其可测消费者也会进入计划。测试启动前，`test-pkg.mjs` 会让 Turbo 构建所选测试消费的 workspace 依赖，确保干净 checkout 中指向 `dist` 的包导出可被解析，同时不会构建 Desktop、Docs 或 Remote Relay 这些叶子应用本身。`package.json`、`bun.lock`、根 TypeScript/Biome 配置和 `scripts/quality/**` 变化会触发全部 workspace 测试；无效基线会直接失败，不会静默跳过。

`test:impact` 面向本地短反馈循环：显式测试文件直接运行，普通源码交给 Vitest 的 `related` 依赖图选择；若没有关联测试则回退该包自己的测试脚本。只有下面四类输入会转交 `test:changed`：

- 根配置：仓库根的 `biome.json`、`biome.jsonc`、`bun.lock`、`package.json`、`turbo.json`、`tsconfig.base.json`、`tsconfig.json`
- 已删除的 workspace 文件：路径不存在，依赖图无法判断影响范围
- 公共入口：包内 `src/index.*` 或 `src/public-api/`
- 合同目录：某一段路径是 `contract`、`contracts` 或 `runtime-contracts`

包内 `package.json` 和其它非源码文件只跑该包的完整测试，不再升级到 `test:changed`。`vitest.config.ts` 这类源码配置交给 Vitest 的 `related`；没有关联测试时再跑该包自己的测试。没有 `test` 脚本的 workspace 会被跳过，不因此回退；跨包影响仍由 `test:changed` 和 CI 覆盖。空文件列表不跑测试。不传文件时仍使用完整 Git 差异。CI 继续使用 `test:changed`，保证跨包、跨平台门禁不因本地加速而收窄。

`check:quick` 复用同一套 Git 变更选择器，因此不带路径时不会漏掉未暂存或未跟踪文件；`check:quick -- <file...>` 可限制为本次任务实际修改的文件。删除文件会从 Biome 和快速守卫的输入中排除；二进制文件不参与私钥和冲突标记检查。私钥沿用全量扫描的跳过目录（含 `docs/` 和 `scripts/quality/`），冲突标记则检查这次列出的全部文本文件。修改任意 `biome.json` / `biome.jsonc` 或根 `.editorconfig` 时，会自动回退为全仓 Biome，避免配置影响未被检查。它不跑架构守卫，也不做类型检查。

`check:fast` 只看已经暂存的文件，适合在 1 秒内确认私钥、冲突标记和 Biome。它不写回文件；需要格式化时仍用 `check:staged` 或提交时的 `check:precommit`。没有暂存文件时这三项都为空，命令成功返回。

`check:arch` 只跑已经迁到 YAML 引擎的两项：包边界和 Coding Agent 架构。运行时边界、技能前言、生成物校验等其余守卫仍在 `check:guards` 里，随 `bun run check` 一起跑。包边界按文件分到两个工作线程，结果顺序与单线程扫描一致。它扫的是整库，不是这次改动的文件，所以仍然要数秒，不是 `check:fast` 那种亚秒命令。

`check:full` 把 lint、类型和 `check:arch` 并行起来，方便在完整门禁之前看这三项。它不包含 `check:guards` 的其余守卫，也不包含 Mobile lint。CI 和质量阶段继续使用 `bun run check`。

根 `tsconfig.json` 已包含 `apps/cli-host/src/**/*` 和 `apps/cli-host/test/**/*`。完整 `check`
仍额外显式执行 `apps/cli-host` 的 `typecheck`，避免未来调整根 `include` 时静默漏掉 CLI，也让
日志直接显示 CLI 门禁。

根 `tsconfig.json` 的 path map 必须为每个 workspace `package.json#exports` 的 types 子路径
写明源文件（例如 `@vetta/runtime-mcp/auth` → `src/auth/index.ts`）。`check` 在干净树里
typecheck，不会先生成 `dist/*.d.ts`；`moduleResolution: Node16` 下通配 `src/*` 也不会把
目录解析成 `index.ts`。`check-source-path-maps.mjs` 机械检查这条合同。

`check:types:build-surfaces` 与源码 typecheck 是不同口径：它不使用根源码 path map，而是按真实
workspace 包声明解析。因此，上游源码修改但 `dist/*.d.ts` 尚未重新生成时，该命令会失败。这是
声明新鲜度问题，不应通过手改 `dist` 或把生成动作塞进只读 `check` 解决；应先按正式依赖顺序
生成前置包声明，再运行该门禁。

## CI

`.github/workflows/quality.yml` 负责通用 TypeScript 质量门禁：冻结依赖安装、`bun run check`、质量脚本测试、Runtime 合同检查，并在 Ubuntu、macOS 与 Windows 上顺序运行受影响 workspace 及其可测下游。各平台按操作系统、架构和锁文件复用 Bun 下载缓存，但每次都由冻结锁文件重新生成根 `node_modules`；不得跨 Runner 恢复 `node_modules`，以免 Windows 上 Bun 的依赖链接和类型解析失真。单元测试 Job 会确保真实 `ripgrep` 可用，仅在 Runner 未预装时才安装，用于验证 Runtime Node 的 `grep` / `glob` 进程合同。完整 Git 历史用于计算 PR base；根配置、锁文件或质量脚本变化会在三个平台运行全部 workspace 测试。同一 PR 或分支的新提交会取消旧运行，任一平台失败后也会停止仍在排队或执行的同矩阵任务；成功运行仍完整覆盖三个平台。

非 Bun workspace 由独立的 path-filtered workflow 覆盖：`.github/workflows/im-gateway.yml` 对 Go Gateway 执行 tidy、vet、build、test、接口纪律和 golangci-lint；`.github/workflows/kotlin.yml` 对 Kotlin Mobile 执行 Android host tests 和 debug APK 构建。Expo Mobile 是 Bun workspace，另由 `.github/workflows/mobile.yml` 在相关路径变化时执行类型检查和 Web 导出。这些 path-filtered workflow 只在分支 push 或 PR 中对应目录或 workflow 自身变化时运行，不响应 tag push。

Desktop 生产边界由独立的 `.github/workflows/desktop-packaged.yml` 负责：它始终运行打包合同检查，涉及 Desktop 主进程、preload、打包脚本、原生依赖、远程控制或锁文件的变更才会启动 Windows、macOS、Linux runners，构建 unpacked packaged 应用并运行 Electron 启动与 updater E2E；无关变更不会构建 Desktop。上述 workflow 都使用只读检查，不会自动修复候选提交。

Desktop 打包合同可在本地快速运行：

```text
bun run verify:desktop:contracts
bun run test:desktop:packaging
```

正式 Desktop 发布 workflow 还会在平台矩阵前运行 `bun run check`、`bun run test:quality` 与 `bun run test:desktop:packaging`；每个平台构建后运行 packaged smoke/updater E2E，发布 R2/GitHub 后通过 `apps/desktop/scripts/verify-update-feed.mjs` 检查公开更新 feed。手动 `workflow_dispatch` 默认只验证本地产物；`channel=test` 或 `channel=stable` 的发布型手动运行会进入与 tag 相同的发布门禁和公开 feed 检查。

需要验证真实生产布局时运行 packaged smoke 与 updater E2E（当前平台需先生成对应 `release/*-unpacked` 目录）：

```text
bun run --cwd apps/desktop dist:opensource -- --target dir
bun run --cwd apps/desktop test:e2e:packaged
```

该 E2E 会在 WDIO 启动 Electron 前创建本地 generic feed，通过真实 `window.vetta.updater.check()` 验证 `app-update.yml`、feed 请求、版本解析和 renderer/main IPC 链路；它不会安装伪造的更新包。发布后的真实安装包可读性、hash、blockmap 和平台安装准备仍由各平台 `verify:updates:*` 以及发布后 `verify-update-feed.mjs` 负责。

需要验证真实安装、重启和版本切换时，先使用 `desktop-release` 的 `workflow_dispatch` + `channel=test` 发布基线和候选，
再运行 `.github/workflows/desktop-upgrade-e2e.yml` 并填写 `baseline_version`、`candidate_version`。该 workflow 在
Windows、macOS、Linux runner 上真实安装基线包，驱动现有 updater 完成下载、安装、退出、重启和版本切换；失败时上传
应用日志和升级状态文件。它使用独立的 `desktop-test` Environment，不会触碰 stable。当前 GitHub macOS runner 只验收
其实际架构；macOS arm64 需要额外的自持 runner 矩阵。

单元测试按包顺序执行，不使用根 workspace 的无界并发扇出；这会牺牲少量总耗时，但能避免多个 Vitest 进程同时争用 CPU、临时目录和子进程而产生假超时。包内测试若消费自身生成物，由该包的 `test` 脚本先生成（例如 `vetta-ui-design` 的独立 history runner），不把叶子包完整制品构建混入通用依赖预构建。CLI 的 Windows CI 进程型测试按文件串行，避免多个 Node、Bun、MCP 与 shell 子进程争用 Runner 资源；本地开发使用有界文件并行缩短反馈时间。平台相关行为至少由 Ubuntu、macOS 与 Windows 三个平台门禁覆盖。

## 与 OpenClaw 的对应关系（有意不做的）

| OpenClaw | 本仓库选择 |
|----------|------------|
| oxlint / oxfmt | 继续 **Biome**（已覆盖 lint+format） |
| 170+ test shards | 本地用 `test:impact` 缩短反馈；CI 用 `test:changed` 保持下游覆盖 |
| pre-commit 全家桶 | husky + 快路径；类型检查放 `check` |
| knip 阻断 CI | 仅扫描四个核心包，`deadcode:report` 先观察，再收紧 |
| OpenGrep / CodeQL | 未引入；有安全面再加 |
| Docker E2E 矩阵 | 继续使用包内测试和定向 Electron E2E；`verify:ui` 仅按用户明确要求运行 |

## 推荐工作流

```bash
# 日常开发
# （commit 时 husky 自动 check:precommit）

# 中间编辑轮次：先跑直接相关测试；形成一个完整修改批次后跑快速检查
bun scripts/quality/run-vitest.mjs --run packages/ai/test/provider-retry-policy.test.ts
bun run check:quick -- packages/ai/src/providers/retry-policy.ts packages/ai/test/provider-retry-policy.test.ts

# 已暂存、只要私钥 / 冲突标记 / Biome：bun run check:fast
# 改了包边界或 Coding Agent 架构：bun run check:arch
# 想先看 lint + 类型 + 架构引擎：bun run check:full（不能代替下面的 check）

# 任务完成：显式列出本次修改文件；完整 check 已覆盖 quick 和 arch，无需紧邻重复执行
bun run test:impact -- packages/ai/src/providers/retry-policy.ts packages/ai/test/provider-retry-policy.test.ts
bun run check

# 改多个包 / 不确定范围
bun run test:changed
bun run check:quick
bun run check

# 改 Desktop UI（默认不启动 verify:ui）
bun run check

# 仅当用户明确要求 UI 验收时
bun run verify:ui:start:fresh
# ... verify:ui:pw ...

# 可选清理
bun run deadcode:report
```

## 后续可增强（未做，待有痛点再上）

1. desktop i18n CJK **ratchet**（基线文件数，只许下降）——当前硬编码存量大，全量 fail 不现实  
2. CI path filter：只改 `packages/ai` 时跳过 desktop `tsc`  
3. Knip 收紧后纳入 `check`
4. 插件 SDK **契约测试**（public API 形状快照）

## 核查清单

- [ ] `bun run check:guards` 通过  
- [ ] `turbo.json` 的 `build` 保持 `dependsOn: ["^build"]`，目标包 dry-run 包含所需依赖闭包
- [ ] `bun run check:quick` 覆盖已提交、暂存、未暂存和未跟踪文件，且不跑架构守卫
- [ ] `bun run check:fast` 只检查已暂存文件，且不改写它们
- [ ] `bun run check:arch` 只跑包边界和 Coding Agent 架构
- [ ] CI 的 quality workflow 仍是 `bun run check`，不是 `check:full`
- [ ] `bun run test:quality` 通过  
- [ ] `bun run check:precommit` 在有 staged 文件时行为正确  
- [ ] `bun run test:pkg --list` 列出当前所有可测包
- [ ] `bun run check` 仍包含类型检查（比 pre-commit 更严）  
- [ ] `bun run check` 输出中包含 `apps/cli-host` 的显式 `typecheck`
- [ ] 生成当前 workspace 声明后，`bun run check:types:build-surfaces` 通过
- [ ] husky `.husky/pre-commit` 调用的是 `check:precommit` 而非整仓慢 `check`  
- [ ] 未新增 oxlint/oxfmt/pnpm 强制依赖  
