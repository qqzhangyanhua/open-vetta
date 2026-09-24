import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalPtyBackendFactory, hangUpPty, LocalPtyCommandError } from "./local-pty-backend.js";
import type { TerminalBackend, TerminalExitEvent } from "./terminal-backend.js";

function target(overrides: { kill?: () => void; destroy?: () => void } = {}) {
	const calls: string[] = [];
	return {
		calls,
		kill(signal?: string) {
			calls.push(`kill:${signal ?? ""}`);
			overrides.kill?.();
		},
		destroy() {
			calls.push("destroy");
			overrides.destroy?.();
		},
	};
}

describe("hangUpPty", () => {
	it("先给 shell 发 SIGHUP，再关主端", () => {
		// 顺序不能反：先发信号，shell 才有机会把 SIGHUP 转给自己的作业并干净退出；
		// 关主端是给「shell 转发不了」兜底的第二道。
		const pty = target();

		hangUpPty(pty);

		expect(pty.calls).toEqual(["kill:SIGHUP", "destroy"]);
	});

	it("信号发不出去时照样关主端", () => {
		// shell 先自己退了，pid 不存在 —— 但主端还开着，前台进程组还没收到 SIGHUP。
		// 这一步要是被异常带走，用户跑的 dev server 就留在后台了。
		const pty = target({
			kill: () => {
				throw new Error("ESRCH");
			},
		});

		hangUpPty(pty);

		expect(pty.calls).toContain("destroy");
	});

	it("关主端失败不往外抛：回收是尽力而为的", () => {
		const pty = target({
			destroy: () => {
				throw new Error("already closed");
			},
		});

		expect(() => hangUpPty(pty)).not.toThrow();
	});
});

function untilExit(backend: TerminalBackend): Promise<{ output: string; exit: TerminalExitEvent }> {
	let output = "";
	backend.onData((chunk) => {
		output += chunk;
	});
	return new Promise((resolve) => {
		backend.onExit((exit) => resolve({ output, exit }));
	});
}

describe("本地伪终端按指定命令启动", () => {
	const factory = createLocalPtyBackendFactory();
	const size = { cols: 80, rows: 24 };

	it("参数原样传给进程，并在指定目录里运行，正常退出时回报退出码 0", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "vetta-pty-"));
		const backend = await factory.openCommand({
			file: process.execPath,
			args: [
				"-e",
				"process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd() }))",
				"--",
				"a b",
				"--flag",
			],
			cwd,
			...size,
		});
		const result = await untilExit(backend);

		expect(JSON.parse(result.output)).toEqual({ argv: ["a b", "--flag"], cwd: realpathSync(cwd) });
		expect(result.exit).toEqual({ exitCode: 0, signal: 0 });
	});

	it("调用方指定的环境变量会进入进程", async () => {
		const backend = await factory.openCommand({
			file: process.execPath,
			args: ["-e", "process.stdout.write(process.env.PTY_PROBE ?? '')"],
			cwd: tmpdir(),
			env: { PTY_PROBE: "from-caller" },
			...size,
		});
		const result = await untilExit(backend);

		expect(result.output).toBe("from-caller");
		expect(result.exit.exitCode).toBe(0);
	});

	it("进程以非 0 退出时原样回报退出码，和启动失败不是同一种结果", async () => {
		const backend = await factory.openCommand({
			file: process.execPath,
			args: ["-e", "process.exit(7)"],
			cwd: tmpdir(),
			...size,
		});
		const result = await untilExit(backend);

		expect(result.exit.exitCode).toBe(7);
	});

	it("找不到可执行文件时在启动阶段拒绝，不返回已经退出的终端", async () => {
		const missing = join(tmpdir(), "vetta-pty-missing-bin");

		await expect(
			factory.openCommand({
				file: missing,
				args: ["--keep-me"],
				cwd: tmpdir(),
				...size,
			}),
		).rejects.toBeInstanceOf(LocalPtyCommandError);
	});

	it("停止时通过退出事件回报信号", async () => {
		const backend = await factory.openCommand({
			file: process.execPath,
			args: ["-e", "setInterval(() => {}, 1_000_000)"],
			cwd: tmpdir(),
			...size,
		});
		const exited = untilExit(backend);
		backend.kill();
		const result = await exited;

		expect(result.exit.signal).toBe(1);
	});
});
