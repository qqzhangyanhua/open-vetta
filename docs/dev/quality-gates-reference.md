> 此文件自动生成，请勿手工编辑。

源头是 `scripts/quality/check-*.mjs` 的文件头 JSDoc，以及 `scripts/quality/rules/*.yml`。
重新生成：`bun run scripts/quality/generate-docs.mjs`。`bun run check:guards` 只核对这份文件，不改它；和源头不一致时该命令失败。

# 质量门禁参考

## 守卫

### `scripts/quality/check-agent-ai-maintainability.mjs`

Keep Agent orchestration and AI provider facades aligned with their responsibility boundaries.

### `scripts/quality/check-architecture.mjs`

Architecture engine only: package boundaries and Coding Agent architecture. The other guards stay on `bun run check:guards` / `bun run check`.

Usage:
  bun run check:arch

### `scripts/quality/check-coding-agent-architecture.mjs`

Coding Agent dependency direction and public boundaries.

Rules live in scripts/quality/rules/coding-agent-architecture.yml.
The deprecated checker in check-coding-agent-architecture.legacy.mjs is the
behavior baseline for the differential test.

Usage:
  bun run scripts/quality/check-coding-agent-architecture.mjs

### `scripts/quality/check-conflict-markers.mjs`

Fail on unresolved git conflict markers in repository text. The full scan and `check:quick` use the same set: root files plus packages, apps, scripts, and docs, skipping generated trees and binaries.

Usage:
  bun run scripts/quality/check-conflict-markers.mjs
  bun run scripts/quality/check-conflict-markers.mjs --staged

### `scripts/quality/check-conversation-message-architecture.mjs`

Keep Chat and Agent Team on the shared ordinary Conversation message contract.

### `scripts/quality/check-fast.mjs`

One-second feedback for files already in the index.

Private keys, conflict markers, and Biome all look at the staged set.
Biome does not rewrite: this command reports problems. Formatting stays
in `check:staged` and `check:precommit`.

Usage:
  bun run check:fast

### `scripts/quality/check-guards.mjs`

Run all independent always-on quality guards in parallel (used by `bun run check`). After those guards finish, compare the quality-gates reference with the guard JSDoc and YAML rules. A mismatch fails this command. Rewrite the file with `bun run scripts/quality/generate-docs.mjs`; this check does not write it.

### `scripts/quality/check-lint.mjs`

Run full Biome checks against explicit source roots. Passing the repository root makes Biome's scanner crawl unrelated trees.

### `scripts/quality/check-package-boundaries.mjs`

Monorepo package boundaries.

Rules live in scripts/quality/rules/package-boundaries.yml.
The deprecated checker in check-package-boundaries.legacy.mjs is the
behavior baseline for the differential test.

The file walk runs on several cores. A serial pass of the whole tree is too
slow for `check:arch`. Findings stay in walk order.

Usage:
  bun run scripts/quality/check-package-boundaries.mjs

### `scripts/quality/check-private-keys.mjs`

Fail if text outside docs and generated trees looks like a private key. The full scan and `check:quick` use the same set, including repo-root files and extensions such as `.pem`. Docs stay skipped so examples are not keys.

Usage:
  bun run scripts/quality/check-private-keys.mjs
  bun run scripts/quality/check-private-keys.mjs --staged

### `scripts/quality/check-quick.mjs`

Fast local gate for every file changed from a base ref, including committed, staged, unstaged, and untracked files. Biome, private keys, and conflict markers run on those files. Architecture guards stay in `bun run check:arch` and `bun run check`.

Usage:
  bun run check:quick
  bun run check:quick --base origin/main
  bun run check:quick -- packages/ai/src/index.ts

### `scripts/quality/check-runtime-boundaries.mjs`

Runtime package boundaries.

Rules live in scripts/quality/rules/runtime-boundaries.yml.
One run covers Coding Agent independence, the subagent kernel, and the
production failure contract. The sentences on failure stay the ones those
guards printed.

Usage:
  bun run scripts/quality/check-runtime-boundaries.mjs

### `scripts/quality/check-skill-frontmatter.mjs`

Guard SKILL.md frontmatter against the mistakes that make a skill vanish.

Why a guard and not just care: frontmatter is parsed with a real YAML parser
(packages/coding-agent/src/resources/shared/frontmatter.ts). When it throws, nothing the
author can see reports it — the loader drops the skill, and it silently
disappears from the agent's skill list and the slash menu. The description is
long prose written by hand, so the usual break is plain YAML syntax: an
unquoted scalar containing ": " parses as a nested mapping and errors out.

This does NOT re-implement YAML (guards stay dependency-free, see lib.mjs).
It checks the shape skills actually use — a flat block of `key: value` — and
rejects the unquoted-scalar hazards plus a missing/oversized description.

Usage:
  bun run scripts/quality/check-skill-frontmatter.mjs
  bun run scripts/quality/check-skill-frontmatter.mjs --staged

### `scripts/quality/check-source-path-maps.mjs`

Root tsconfig path maps must explicitly point every workspace TypeScript package.json export at source. `check` typechecks a clean tree without dist; Node16 + tsgo will not treat `@scope/pkg/sub` -> `src/sub` as `src/sub/index.ts`, and package.json exports only name dist/*.d.ts.

### `scripts/quality/check-standalone-cli-build.mjs`

（源文件没有文件头 JSDoc）

### `scripts/quality/check-turbo-config.mjs`

Validate the repository's Turborepo cache-safety and entry-point contracts.

### `scripts/quality/check-vitest-runner.mjs`

Require package.json Vitest scripts to launch through Node via scripts/quality/run-vitest.mjs. Bun workers on Windows fail before collecting tests (forks: File URL path must be an absolute path; threads: port.addListener is not a function).

Usage:
  bun run scripts/quality/check-vitest-runner.mjs

## 规则

### coding-agent-architecture

配置：`scripts/quality/rules/coding-agent-architecture.yml`

**描述**

Coding Agent dependency direction, host injection, and public package surface.

**理由**

Coding Agent owns product policy and stable facades. Contracts do not depend on
adapters, composition implementations, or host implementations. Product domains
do not select Node mechanisms. Hosts inject those mechanisms at the composition
root. [ADR-0077](../adr/0077-agent-runtime-product-ownership.md) records the ownership split. The readable contract is
docs/dev/quality-gates.md and packages/coding-agent/AGENTS.md.

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)
- [docs/dev/quality-gates.md](./quality-gates.md)
- [packages/coding-agent/AGENTS.md](../../packages/coding-agent/AGENTS.md)

**示例**

违规：

```
// packages/coding-agent/src/composition/contracts/sample.ts
import type { Value } from "../../adapters/runtime-core/adapter.js";
```

修复：

```
// Depend on a contract, not an adapter implementation.
import type { Value } from "../runtime-contracts/index.js";
```

违规：

```
// apps/cli-host/src/runtime.ts
import { value } from "@vetta/coding-agent/src/private.js";
```

修复：

```
// Import a subpath declared in package.json#exports.
import { value } from "@vetta/coding-agent/composition";
```

**规则**

#### `retired-multi-host-concepts`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path} references retired multi-Host concept {item}
- {path} calls the deprecated product Backend facade instead of composition.sessions
- {path} references retired duplicate Session resource ownership {item}

#### `platform-persistence-composition`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: platform Composition Root must select {factory} from runtime-node
- {path}: platform Composition Root must inject createConversationPersistence

#### `composition-persistence-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Coding Agent Composition must consume a persistence Port, not a Node implementation
- {path}: Coding Agent Composition must obtain conversation persistence from its host Port

#### `tool-environment-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Node command and executable implementations belong to runtime-node
- {path}:{line}: Coding Agent tool composition must consume ToolEnvironment, not Node tools
- {path}:{line}: Coding Agent path policy must consume Host path boundaries
- {path}:{line}: Session execution must consume its Host environment Port
- {path}: Coding Agent Composition must forward the host ToolEnvironment factory
- {path}: host Composition Root must inject createToolEnvironment
- {path}: host Composition Root must inject createSessionExecutionEnvironment
- {path}: platform Composition Root must not select Coding Agent's legacy Node factory
- {path}: platform Composition Root must not select Coding Agent's legacy Session environment
- {path}: platform environment factory must compose Node mechanisms with Coding Agent policies

#### `prompt-request-adapter`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Prompt request Adapter must delegate domain policy
- {path}: Prompt request Adapter must delegate preparation to its runtime Port

#### `retired-concurrency`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: generic concurrency belongs to Runtime Tools
- {path}: generic concurrency must not be published by Coding Agent

#### `retired-configuration`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: environment configuration resolution belongs to the platform Runtime
- {path}: environment configuration resolution must not be published by Coding Agent

#### `retired-utils`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: generic utility dumping ground is retired; place code in its owning domain

#### `cli-host-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: terminal CLI behavior belongs to cli-host
- {path}: CLI process control must not be published by Coding Agent
- {path}: Print input assembly must consume host-provided I/O Ports

#### `retired-adapter-ownership`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: implementation belongs to its Extension or ecosystem owner

#### `node-state-backend`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Node file state backends belong to runtime-node
- {path}:{line}: Settings semantics must consume SettingsStoragePort, not a Node backend
- {path}: SettingsRuntime must not select a Node file backend

#### `extension-module-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Node Extension execution belongs behind Host Ports
- {path}: Extension contracts must use platform-neutral data types
- {path}:{line}: Extension semantics must not depend on Node implementations

#### `resource-access-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: portable resource access must consume ResourceAccessPort, not a Node implementation
- {path}: SessionResourceRuntimeOptions must require ResourceAccessPort
- {path}: SessionResourceRuntimeOptions must require ThemeResourceParser
- {path}: SessionResourceRuntimeOptions must require Extension Host Ports
- {path}: Skill consumers must use the materialized resource snapshot

#### `command-execution-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: command execution implementation belongs to runtime-node, not Coding Agent

#### `execution-mode-host`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: sandbox host policy must not return to the Runtime adapter directory
- {path}: OS sandbox implementation belongs to runtime-node
- {path}: sandbox policy must consume Host Services, not Node globals
- {path}:{line}: OS sandbox implementation belongs to runtime-node
- {path}:{line}: sandbox policy must consume injected Host Services

#### `print-mode-transport`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Print mode must consume the host PrintOutput Port
- {path}: CLI Print output must implement CodingAgentPrintOutputPort

#### `workspace-facts`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Workspace facts product policy must consume host-provided facts or file access
- {path}: Workspace facts product policy must not read Node process state
- {path}: platform Composition Root must inject workspace facts

#### `model-input-image`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Model input image policy must consume a host-provided processor
- {path}: Model input image policy must remain platform-neutral
- {path}: Node Composition Root must inject modelInputImageProcessor

#### `model-domain`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Model product policy must consume host-provided state
- {path}: Model product policy must not control the host process
- {path}: Node model host must inject configFileSource

#### `html-export`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: HTML export product logic must consume host file adapters
- {path}: Node HTML export host must inject file adapters

#### `theme-domain`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Theme product policy must consume host-provided environment ports
- {path}:{line}: internal Theme consumers must use the Theme domain entry
- {path}:{line}: legacy Theme facade may only export the Theme domain entry
- {path}: Theme product policy must not read the Node process environment
- {path}: Node Theme host must inject environment defaults and file watching

#### `portable-product-domain`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: portable product domain must consume host-provided capabilities
- {path}:{line}: portable product code must import identity, not Node config
- {path}: portable product domain must not read Node process state
- {path}: identity must remain portable and side-effect free
- {path}: public config must remain a thin Node-host compatibility facade
- {path}: platform lifecycle implementation belongs to an application Composition Root
- {path}: Node Composition Root must select the runtime-node MCP supervisor

#### `tool-result-artifact`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: result artifact file implementation belongs to runtime-node
- {path}:{line}: Tool Result policy must consume an Artifact Store contract
- {path}: Coding Agent Composition must forward the host Tool Result policy
- {path}: Node Host Composition Root must inject codingToolResultPolicy

#### `bootstrap-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: platform bootstrap belongs to the application Composition Root
- {path}: Extension compatibility rules belong to the Extension domain
- {path}: Coding Agent Bootstrap must consume host-owned state and environment facts
- {path}:{line}: Coding Agent Bootstrap must not select a Node implementation
- {path}: Coding Agent Bootstrap must require explicit host-owned dependencies
- {path}: CLI host composition must select Node dependencies explicitly

#### `resource-package-host`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Resource Package Node effects belong to runtime-node
- {path}: ResourcePackageRuntimeOptions must require all Host Ports
- {path}: Resource Package runtime must not synchronously query Node commands
- {path}: Resource Package runtime must not select Node defaults
- {path}: Resource source parsing must not own package location policy

#### `host-owned-resource-composition`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Node resource composition belongs to application hosts
- {path}: Prompt resource selection belongs to application hosts
- {path}: Resources facade must expose portable constructors only
- {path}: Composition must accept host-owned Prompt runtime sources
- {path}: Session initialization must forward host-owned Prompt runtime sources

#### `knowledge-runtime`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: Knowledge platform implementation belongs to application hosts
- {path}:{line}: Knowledge Feature must consume portable operations
- {path}: Knowledge Tool definitions belong to the Coding Agent feature
- {path}: runtime-node must not export Coding Agent Knowledge Tools
- {path}: Composition must accept an explicit Knowledge runtime
- {path}: Composition must not infer Knowledge platform availability
- {path}: Tool Surface must consume the injected Knowledge runtime
- {path}: Node Host Composition Root must inject createNodeKnowledgeRuntime

#### `memory-runtime`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Memory semantics must consume portable storage ports
- {path}: Memory Tool definitions belong to the Coding Agent feature
- {path}: Memory semantics must not contain a file-backed implementation
- {path}: runtime-node must not export Coding Agent Memory Tools
- {path}: Composition must accept an explicit Memory runtime factory
- {path}: Memory host storage must be selected by the Composition Root
- {path}: Node Host Composition Root must inject NodeTextFileStorage for Memory

#### `ask-user-question-ownership`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Ask User Question Feature must consume portable Runtime ports
- {path}: Ask User Question belongs to its Coding Agent feature
- {path}: Ask User Question Tool definitions belong to the Coding Agent feature
- {path}: runtime-node must not export Coding Agent Ask User Question Tools

#### `invoke-skill-ownership`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Skill semantics must consume portable Runtime and resource ports
- {path}: Invoke Skill Tool definitions belong to the Coding Agent Skill domain
- {path}: runtime-node must not export Coding Agent Invoke Skill Tools

#### `mcp-tool-search-ownership`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: MCP Tool Search belongs to runtime-mcp
- {path}: runtime-node must not duplicate runtime-mcp Tool Search

#### `subagent-control-ownership`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: Subagent control Tools must consume portable Runtime Ports
- {path}: Subagent control Tool definitions belong to the Coding Agent Subagent feature
- {path}: Subagent notification projection belongs to the Coding Agent Subagent feature
- {path}: runtime-node must not export Coding Agent Subagent control Tools

#### `portable-product-tool-ownership`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: portable Coding Agent Tool Features must consume Runtime ports
- {path}:{line}: Coding Agent product Tool composition must consume host factories
- {path}: portable product Tool definitions belong to Coding Agent Features
- {path}: platform-neutral execution gates belong to runtime-tools
- {path}: runtime-node must not export portable Coding Agent product Tools
- {path}: runtime-node must not export platform-neutral execution gates
- {path}: Node Tool Environment must compose platform Tools only

#### `rpc-host-boundary`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: RPC protocol semantics must consume host transport and ID ports
- {path}: RPC protocol semantics must not access Node process or randomness directly
- {path}: RPC mode must require explicit transport and request ID ports
- {path}: Node RPC Host must inject JSONL transport, exit and request ID ports
- {path}: Node RPC Client transport must implement the public RPC Port

#### `sdk-session-identity`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}:{line}: SDK Session factory must consume an identity runtime Port
- {path}: SDK Session factory must not select Node identity defaults
- {path}: SDK Session factory must require the complete identity runtime Port
- {path}:{line}: public SDK mapping must not select Node implementations
- {path}: default SDK Host must inject the Node Session identity runtime
- {path}: Node SDK identity adapter must implement the identity runtime Port

#### `retired-layer-terminology`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: implementation uses a retired architecture-layer term
- {path}: export {export} uses a retired architecture-layer term

#### `dependency-direction`

**相关文档**

- [ADR-0077](../adr/0077-agent-runtime-product-ownership.md)

检查：

- {path}: retired implementation directory is outside the current architecture
- {path}:{line}: Adapter must consume platform-neutral facts, not a Node implementation
- {path}:{line}: package root may only export the Extension facade
- {path}:{line}: Composition public entry exports an internal implementation ({specifier})
- {path}:{line}: consumer uses a non-public Coding Agent subpath ({specifier})
- {path}:{line}: historical migration execution must be injected by a Host
- {path}:{line}: historical format policy must consume host-provided file operations
- {path}:{line}: external format policy must consume host-provided file operations
- {path}:{line}: contract depends on implementation ({specifier})
- {path}:{line}: Coding Agent domain depends on orchestration or implementation ({specifier})
- {path}:{line}: Adapter depends on Composition or a public facade ({specifier})
- {path}:{line}: historical format boundary depends on Agent execution ({specifier})
- {path}:{line}: external format boundary depends on Agent execution ({specifier})
- {path}: platform historical-session Host must inject Node file execution

### package-boundaries

配置：`scripts/quality/rules/package-boundaries.yml`

**描述**

Dependency direction and coding-agent boundaries for the monorepo.

**理由**

Core libraries stay independent of application packages, production code does
not import test helpers, and Coding Agent composition stays inside the
boundaries the legacy checker enforced. Messages below are that contract.

**示例**

违规：

```
// packages/ai/src/index.ts
import { DesktopConfig } from "@vetta/desktop";
```

修复：

```
// Share the type from a library package.
import { Config } from "@vetta/config";
```

违规：

```
// packages/ai/src/index.ts
import { fixture } from "../test/fixture";
```

修复：

```
// Keep the fixture inside the test that uses it.
```

**规则**

#### `libs-must-not-depend-on-apps`

修复建议：Import a shared library instead of an application package.

检查：

- libs/plugins must not import app package ({id})

#### `no-test-imports-in-production`

修复建议：Move the helper into the production module or keep the import inside a test.

检查：

- production code must not import test trees ({specifier})

#### `plugins-must-not-deep-import-desktop`

修复建议：Call the public plugin SDK instead of desktop source files.

检查：

- plugins must not deep-import desktop internals

#### `desktop-must-use-cli-host-package`

修复建议：Import the cli-host package export instead of its source tree.

检查：

- desktop must consume cli-host through a package export ({specifier})

#### `desktop-renderer-mcp-browser-entry`

修复建议：Import runtime MCP values from @vetta/runtime-mcp/browser.

检查：

- desktop renderer must import MCP runtime values from @vetta/runtime-mcp/browser ({specifier})

#### `plugins-must-use-sdk-not-window-vetta`

修复建议：Use the public plugin SDK instead of window.vetta.

检查：

- plugins must use the public plugin SDK instead of window.vetta

#### `capability-internals-avoid-public-sdks`

修复建议：Keep capability internals off public SDKs and app packages.

检查：

- capability internals must not import public system SDKs or app packages ({specifier})

#### `public-sdks-avoid-capability-internals`

修复建议：Expose a public capability token instead of an internal adapter path.

检查：

- public system SDKs must not expose built-in capability adapters ({specifier})

#### `no-raw-capability-ids`

修复建议：Import the capability token instead of pasting its raw id.

检查：

- import a capability token instead of using raw id {name}

#### `capability-definitions-are-schema-backed`

修复建议：Define capabilities with schemas and publish the generated catalog.

检查：

- capability tokens must use schema-backed input and output definitions
- capability definition files must publish a generated catalog

#### `greenfield-runtime-avoids-coding-agent`

修复建议：Depend on a runtime contract instead of coding-agent.

检查：

- greenfield runtime modules must not import coding-agent ({specifier})

#### `runtime-storage-avoids-platform`

修复建议：Call a host port instead of a platform package.

检查：

- runtime-storage protocol must not import platform implementation ({specifier})

#### `runtime-tools-avoids-platform`

修复建议：Call a host port instead of a platform package.

检查：

- runtime-tools protocol must not import platform implementation ({specifier})

#### `runtime-mcp-avoids-platform`

修复建议：Call a host port instead of a platform package.

检查：

- runtime-mcp protocol must not import platform implementation ({specifier})

#### `runtime-core-avoids-platform`

修复建议：Use a host port instead of Node, Bun, or a platform package.

检查：

- runtime-core must use host ports instead of platform implementation ({specifier})
- runtime-core must not depend on platform global ({name})

#### `greenfield-product-avoids-legacy-startup`

修复建议：Report compatibility facts instead of calling the legacy startup entry.

检查：

- greenfield product modules must not use legacy startup symbol {name}
- greenfield product modules must report compatibility facts instead of {name}

#### `active-session-transaction-boundary`

修复建议：Keep active-session transactions on host ports.

检查：

- active-session transactions must use host ports instead of {specifier}
- active-session transactions must delegate Legacy session seed construction
- active-session transactions must not import Coding Agent products
- active-session transactions must use neutral session action ports
- active-session transactions must not use {name}

#### `branch-navigation-neutral-contract`

修复建议：Expose a neutral options contract for branch navigation.

检查：

- branch navigation must expose a neutral options contract

#### `knowledge-processing-session-neutral-contract`

修复建议：Depend on the neutral Knowledge Processing contract.

检查：

- Knowledge Processing must depend on the neutral contract

#### `knowledge-processing-contract-avoids-backends`

修复建议：Keep the Knowledge Processing contract off backend types.

检查：

- Knowledge Processing contract must not depend on a backend implementation
- Knowledge Processing contract must not use {name}

#### `composition-root-delegates-subagent-assembly`

修复建议：Delegate Subagent assembly out of the composition root.

检查：

- Coding Agent Composition Root must delegate Subagent assembly ({name})
- Coding Agent Composition Root must not own Subagent policy ({name})

#### `composition-root-delegates-turn-capability`

修复建议：Delegate Turn Capability assembly out of the composition root.

检查：

- Coding Agent Composition Root must delegate Turn Capability assembly ({name})

#### `composition-root-delegates-session-lifecycle`

修复建议：Delegate session resource lifecycle out of the composition root.

检查：

- Coding Agent Composition Root must delegate Session Resource Lifecycle assembly ({name})

#### `composition-root-delegates-resource-registry`

修复建议：Delegate the resource registry and shutdown out of the composition root.

检查：

- Coding Agent Composition Root must delegate resource registry and shutdown ({name})

#### `composition-root-delegates-mcp-session`

修复建议：Delegate MCP session coordination out of the composition root.

检查：

- Coding Agent Composition Root must delegate MCP Session coordination ({name})
- Coding Agent Composition Root must not own MCP refresh observation policy ({name})

#### `composition-root-delegates-session-initialization`

修复建议：Delegate session initialization out of the composition root.

检查：

- Coding Agent Composition Root must delegate Session initialization ({name})
- Coding Agent Composition Root must not own Session initialization rollback ({name})

#### `session-initialization-profile`

修复建议：Pass a narrow initialization profile instead of the composition object.

检查：

- Coding Agent Composition Root must project Session initialization options through a profile

#### `session-initialization-transaction-profile`

修复建议：Depend on the initialization profile, not the composition options type.

检查：

- Session initialization transaction must depend on its narrow profile ({name})

#### `session-initialization-delegates-construction`

修复建议：Delegate staged runtime construction out of the initialization transaction.

检查：

- Session initialization transaction must delegate staged runtime construction ({name})
- Session initialization transaction must delegate staged runtime policy ({name})

#### `composition-root-delegates-tool-surface`

修复建议：Delegate the runtime tool surface out of the composition root.

检查：

- Coding Agent Composition Root must delegate Runtime Tool Surface ({name})
- Coding Agent Composition Root must not own Knowledge Tool activation policy

#### `tool-port-uses-registry`

修复建议：Type the tool port against CodingToolRegistry.

检查：

- Greenfield Runtime Tool access must depend on CodingToolRegistry ({name})

#### `coding-tools-composition-exposes-registry`

修复建议：Type the registry property as CodingToolRegistry.

检查：

- Coding Tools composition must expose its Registry through CodingToolRegistry

#### `adapters-do-not-own-tool-policy`

修复建议：Move tool policy out of the adapter.

检查：

- Coding Agent Adapter must not own Tool policy ({name})

#### `composition-does-not-declare-tool-policy`

修复建议：Move tool policy out of composition.

检查：

- Coding Agent Composition must not declare Tool policy ({name})

#### `domain-depends-on-contracts-not-adapters`

修复建议：Import a contract instead of an adapter module.

检查：

- Coding Agent domain must depend on contracts instead of Adapters ({specifier})

#### `runtime-prompt-stable-identity`

修复建议：Use the stable Runtime Prompt contract names.

检查：

- Runtime Prompt contract must use its stable identity ({name})

#### `runtime-avoids-product-semantics`

修复建议：Keep product vocabulary in the product package.

检查：

- Runtime must expose generic extension/platform contracts instead of product semantic ({name})

#### `composition-root-delegates-child-policy`

修复建议：Delegate child composition policy out of the composition root.

检查：

- Coding Agent Composition Root must delegate Child Composition policy ({name})
- Coding Agent Composition Root must not own recursive Child isolation policy
- Coding Agent Composition Root must delegate Child Composition projection

#### `composition-root-delegates-host-controls`

修复建议：Delegate runtime host controls out of the composition root.

检查：

- Coding Agent Composition Root must delegate Runtime Host Controls ({name})

#### `composition-does-not-declare-session-host`

修复建议：Leave session host capabilities to the host package.

检查：

- Coding Agent Composition must not declare Session Host capability ({name})

#### `no-automatic-legacy-fallback`

修复建议：Report an explicit compatibility failure instead of a legacy fallback token.

检查：

- automatic {name} fallback is retired; report an explicit compatibility failure instead

#### `retired-runtime-composition-tree`

修复建议：Leave the retired runtime-composition package deleted.

检查：

- retired runtime-composition package must stay deleted

#### `retired-runtime-composition-reference`

修复建议：Remove references to the retired runtime-composition package.

检查：

- retired @vetta/runtime-composition reference must stay deleted

#### `retired-cli-composition-forwarders`

修复建议：Leave the retired CLI composition forwarders deleted.

检查：

- retired CLI composition forwarding module must stay deleted

#### `cli-does-not-reexport-composition`

修复建议：Keep Coding Agent composition off the CLI public entry.

检查：

- CLI public API must not re-export Coding Agent composition

#### `desktop-imports-composition-from-owner`

修复建议：Import Coding Agent composition contracts from their owner.

检查：

- Desktop must import Coding Agent composition contracts from their owner

#### `internal-consumers-use-coding-agent-subpaths`

修复建议：Import an explicit @vetta/coding-agent subpath.

检查：

- internal consumers must use an explicit @vetta/coding-agent subpath instead of the compatibility root

#### `coding-agent-public-surface-hides-tools`

修复建议：Export orchestration from the public surface, not concrete tools.

检查：

- coding-agent public surfaces must not forward concrete Tool implementations ({specifier})
- coding-agent public surfaces must not export concrete Tool symbol {name}

#### `retired-coding-agent-knowledge-tree`

修复建议：Leave the retired Coding Agent knowledge tree deleted.

检查：

- retired Coding Agent Knowledge implementation must stay deleted

#### `retired-coding-agent-knowledge-import`

修复建议：Import knowledge from the runtime package, not the retired surface.

检查：

- retired Coding Agent Knowledge surface import ({specifier})

#### `retired-model-context-files`

修复建议：Leave the retired model-context core files deleted.

检查：

- retired Coding Agent model-context implementation must stay deleted

#### `retired-model-context-import`

修复建议：Do not import the retired model-context core files.

检查：

- retired Coding Agent model-context import ({specifier})

#### `retired-core-compaction-tree`

修复建议：Leave the retired core compaction tree deleted.

检查：

- retired Coding Agent core Compaction implementation must stay deleted

#### `retired-core-compaction-import`

修复建议：Do not import the retired core compaction tree.

检查：

- retired Coding Agent core Compaction import ({specifier})

#### `compaction-policy-dependencies`

修复建议：Keep compaction policy off session implementations.

检查：

- Compaction policy must not depend on Session implementations; only compaction/runtime may consume Runtime Core contracts ({specifier})

#### `legacy-compatibility-allowlists`

修复建议：Keep legacy and external session imports inside the host allowlist.

检查：

- production Legacy subpath import is outside the compatibility allowlist
- historical Session public surface is outside the host compatibility allowlist
- external Session public surface is outside the host compatibility allowlist
- Legacy startup symbol {name} is outside the execution gateway
- {format} session-format modules must not import execution code ({specifier})
- {format} session-format modules must not use execution symbol {name}
- Runtime Host must not expose historical Session symbol {name}
- Legacy Runtime adapter {name} is outside the compatibility allowlist

#### `workspace-imports-are-declared`

修复建议：Declare the workspace package in dependencies, optionalDependencies, or peerDependencies.

检查：

- workspace import {packageName} is not declared by {manifest}

#### `runtime-core-avoids-coding-agent`

修复建议：Keep runtime-core off coding-agent.

检查：

- runtime-core production code must not import coding-agent ({specifier})

#### `agent-core-avoids-runtime-and-product`

修复建议：Keep the agent kernel off runtime and product packages.

检查：

- agent-core must not import runtime or product packages ({specifier})

#### `retired-coding-agent-runtime-host-import`

修复建议：Import the replacement runtime entry instead of the retired host path.

检查：

- retired Coding Agent Runtime Host import ({specifier})

#### `retired-coding-agent-runtime-host-alias`

修复建议：Remove the retired runtime-host resolution alias.

检查：

- retired Coding Agent Runtime Host resolution alias

### runtime-boundaries

配置：`scripts/quality/rules/runtime-boundaries.yml`

**描述**

Runtime packages stay below Coding Agent, and production failures stay structured.

**理由**

Runtime packages are capability domains. They must not take a dependency on the
Coding Agent product, the subagent kernel must not grow tool or product state,
and production recovery must key off structured failures instead of error text.

**示例**

违规：

```
# packages/runtime-tools/package.json
devDependencies:
  "@vetta/coding-agent": "workspace:*"
```

修复：

```
Depend on @vetta/runtime-core or another lower-level contract.
```

违规：

```
# packages/runtime-subagents/src/coordinator.ts
snapshot.status = "completed";
```

修复：

```
Leave child status on the run that owns it.
```

违规：

```
if (error.message.includes("timeout")) return "automatic_replay";
```

修复：

```
Branch on the structured recoverability value.
```

**规则**

#### `coding-agent-independence`

{manifests} manifests, {files} code/config files, Coding Agent dependencies=0

检查：

- {section} must not declare @vetta/coding-agent
- Runtime package file depends on @vetta/coding-agent
- Runtime source hardcodes product token {token}

#### `subagents-boundary`

{files} source files, workspace dependencies=0, tool protocol tokens=0

检查：

- {section} must not declare workspace dependency {dependency}
- forbidden subagent kernel token {token}
- coordinator must not own {token}
- required runtime-subagents owner file is missing
- retired runtime-subagents owner file still exists

#### `failure-contract`

boundary files={files}, violations=0

检查：

- required runtime failure contract file is missing
- missing contract marker ({marker})
- classifies recovery by JavaScript error message
- classifies recovery by JavaScript error name
- classifies recovery by Go error message
- reintroduces automatic Turn replay
- reintroduces the legacy Desktop backend selector
