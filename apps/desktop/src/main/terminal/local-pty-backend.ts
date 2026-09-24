import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import type * as NodePty from "@lydell/node-pty";
import { getAppLogger } from "../logger.js";
import { createTerminalEnvironment, resolveTerminalShell } from "./resolve-terminal-shell.js";
import type {
	OpenTerminalBackendOptions,
	TerminalBackend,
	TerminalBackendFactory,
	TerminalExitEvent,
} from "./terminal-backend.js";

/**
 * 指定命令启动失败：可执行文件不存在或不可执行。
 * 和「进程已经起来、随后以非 0 退出」分开——后者走 {@link TerminalBackend.onExit}。
 */
export class LocalPtyCommandError extends Error {
	readonly code = "ENOENT" as const;
	readonly file: string;

	constructor(file: string) {
		super(`Executable not found: ${file}`);
		this.name = "LocalPtyCommandError";
		this.file = file;
	}
}

export interface OpenLocalPtyCommandOptions {
	/** 绝对路径，或可在本次环境变量 PATH 里解析到的可执行文件名。 */
	readonly file: string;
	/** 原样作为 argv，不经过 shell。 */
	readonly args?: readonly string[];
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
	/** 覆盖在终端环境之上；调用方显式给出的键优先。 */
	readonly env?: Readonly<Record<string, string>>;
}

export interface LocalPtyBackendFactory extends TerminalBackendFactory {
	openCommand(options: OpenLocalPtyCommandOptions): Promise<TerminalBackend>;
}

const log = getAppLogger("terminal");

type NodePtyModule = typeof NodePty;

/**
 * node-pty 是原生模块，且真正的 pty.node 在按平台+架构拆分的包里。
 * 懒加载而不是顶层 import：某个平台缺预编译二进制时，应用仍应正常启动，只是终端不可用
 * ——这条降级路径从第一天就要有，否则一个平台的缺包会变成整个应用起不来。
 */
let cached: { module: NodePtyModule } | { error: Error } | undefined;

function loadNodePty(): NodePtyModule {
	if (cached && "module" in cached) return cached.module;
	if (cached && "error" in cached) throw cached.error;
	try {
		const require = createRequire(import.meta.url);
		const module = require("@lydell/node-pty") as NodePtyModule;
		cached = { module };
		return module;
	} catch (cause) {
		const error = cause instanceof Error ? cause : new Error(String(cause));
		cached = { error };
		log.warn(`local pty unavailable: ${error.message}`);
		throw error;
	}
}

export interface LocalPtyAvailability {
	readonly available: boolean;
	readonly reason?: string;
}

export function probeLocalPty(): LocalPtyAvailability {
	try {
		loadNodePty();
		return { available: true };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** 仅供测试重置探测缓存。 */
export function resetLocalPtyProbeForTests(): void {
	cached = undefined;
}

class LocalPtyBackend implements TerminalBackend {
	private readonly startupProcess: string;

	constructor(
		private readonly pty: NodePty.IPty,
		startupProcess: string,
	) {
		this.startupProcess = startupProcess;
	}

	write(data: string): void {
		this.pty.write(data);
	}

	resize(cols: number, rows: number): void {
		this.pty.resize(cols, rows);
	}

	foregroundProcess(): string | undefined {
		// node-pty 报的是前台进程标题；与启动 shell 同名时说明没有别的东西在跑。
		const current = this.pty.process;
		if (!current || current === this.startupProcess) return undefined;
		return current;
	}

	kill(): void {
		hangUpPty(this.pty);
	}

	onData(listener: (chunk: string) => void): () => void {
		const subscription = this.pty.onData(listener);
		return () => subscription.dispose();
	}

	onExit(listener: (event: TerminalExitEvent) => void): () => void {
		const subscription = this.pty.onExit(({ exitCode, signal }) => listener({ exitCode, signal }));
		return () => subscription.dispose();
	}
}

/**
 * {@link hangUpPty} 只需要这两个方法，单测不必造一个完整的 IPty。
 *
 * `destroy` 可选：它在 node-pty 的 Unix/Windows 两个实现上都有，却没写进导出的 `IPty`
 * 接口，所以这里按「可能没有」处理，而不是断言它一定在。
 */
export interface HangUpTarget {
	kill(signal?: string): void;
	destroy?: () => void;
}

/**
 * 收掉一个 pty，两步缺一不可。
 *
 * 1. SIGHUP 给 shell：shell 收到后会把 SIGHUP 转给自己作业表里的进程，再自己退出。
 *    正常情况下 dev server 就是这样停下来的。
 * 2. 关掉 pty 主端：shell 卡住、或者作业已经脱离了 shell 的作业表时没人转发，此时内核会
 *    直接把 SIGHUP 发给 pty 的**前台进程组**——用户 `npm run dev` 起的那个 node 正在
 *    那个进程组里。
 *
 * node-pty 的 `kill()` 只做第一步，主端一直开着；`destroy()` 做第二步，但它把补发的
 * SIGHUP 挂在 socket 的 close 回调上，而退出路径上紧跟着就是 `app.exit(0)`，那个回调
 * 不一定还有机会跑。所以这里两步都自己来，且顺序是先同步发信号再关主端。
 *
 * 任一步失败都不影响另一步：进程可能已经自己走了。
 */
export function hangUpPty(target: HangUpTarget): void {
	try {
		target.kill("SIGHUP");
	} catch {
		// 进程已经退出，pid 不存在。
	}
	try {
		target.destroy?.();
	} catch {
		// 主端已经关了。
	}
}

function isExecutableFile(candidate: string): boolean {
	try {
		if (!statSync(candidate).isFile()) return false;
	} catch {
		return false;
	}
	if (process.platform === "win32") return true;
	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function commandCandidates(file: string, dir: string, env: Record<string, string>): readonly string[] {
	const bare = join(dir, file);
	if (process.platform !== "win32") return [bare];
	const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext !== "");
	if (extensions.some((ext) => file.toLowerCase().endsWith(ext.toLowerCase()))) return [bare];
	return [bare, ...extensions.map((ext) => join(dir, `${file}${ext}`))];
}

/** 路径形式必须本身可执行；纯文件名只在本次环境的 PATH 里找，找不到就拒绝启动。 */
function resolveCommandFile(file: string, env: Record<string, string>): string {
	if (file.includes("/") || file.includes("\\")) {
		if (!isExecutableFile(file)) throw new LocalPtyCommandError(file);
		return file;
	}
	const pathValue = env.PATH ?? env.Path ?? "";
	for (const dir of pathValue.split(delimiter)) {
		if (dir === "") continue;
		for (const candidate of commandCandidates(file, dir, env)) {
			if (isExecutableFile(candidate)) return candidate;
		}
	}
	throw new LocalPtyCommandError(file);
}

function commandEnvironment(overrides: Readonly<Record<string, string>> | undefined): Record<string, string> {
	return { ...createTerminalEnvironment(), ...overrides };
}

export function createLocalPtyBackendFactory(): LocalPtyBackendFactory {
	return {
		async open(options: OpenTerminalBackendOptions): Promise<TerminalBackend> {
			const pty = loadNodePty();
			const shell = resolveTerminalShell({ customShellPath: options.shellPath });
			const spawned = pty.spawn(shell.file, [...shell.args], {
				cwd: options.cwd,
				cols: options.cols,
				rows: options.rows,
				env: createTerminalEnvironment(),
				name: "xterm-256color",
			});
			return new LocalPtyBackend(spawned, spawned.process);
		},

		async openCommand(options: OpenLocalPtyCommandOptions): Promise<TerminalBackend> {
			const pty = loadNodePty();
			const env = commandEnvironment(options.env);
			const file = resolveCommandFile(options.file, env);
			const spawned = pty.spawn(file, [...(options.args ?? [])], {
				cwd: options.cwd,
				cols: options.cols,
				rows: options.rows,
				env,
				name: "xterm-256color",
			});
			return new LocalPtyBackend(spawned, spawned.process);
		},
	};
}
