import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	agyAdapter,
	codexAdapter,
	cursorAgentAdapter,
	droidAdapter,
	grokAdapter,
	ompAdapter,
	opencodeAdapter,
	piAdapter,
} from "./grok-adapter.js";

const SKIP_FLAGS = ["--always-approve", "--trust", "--yolo", "--dangerously-skip-permissions"];

describe("grok interactive args", () => {
	it.each([
		{ prompt: "fix the test", args: ["--", "fix the test"] },
		{ prompt: 'say "hi"', args: ["--", 'say "hi"'] },
		{ prompt: "line1\nline2", args: ["--", "line1\nline2"] },
		{ prompt: "", args: [] },
		{
			prompt: "fix the test",
			paths: ["/work/app/src/a.ts", "/work/app/src"],
			args: ["--", "@/work/app/src/a.ts\n@/work/app/src\nfix the test"],
		},
		{
			prompt: "看一下 @/work/app/src/a.ts 的测试",
			paths: ["/work/app/src/a.ts"],
			args: ["--", "@/work/app/src/a.ts\n看一下 的测试"],
		},
	])(
		"builds argv for $prompt",
		({ prompt, paths, args }: { prompt: string; paths?: readonly string[]; args: readonly string[] }) => {
			expect(grokAdapter.executable).toBe("grok");
			expect(grokAdapter.processForm).toBe("interactive");
			expect(grokAdapter.singleInstructionArgs(prompt, paths)).toEqual(args);
			expect(grokAdapter.singleInstructionArgs(prompt, paths).some((arg) => SKIP_FLAGS.includes(arg))).toBe(false);
		},
	);
});

describe("interactive TUI adapters", () => {
	it.each([
		{
			name: "agy",
			adapter: agyAdapter,
			promptArgs: ["--prompt-interactive", "@/work/app/src/a.ts\nfix the test"],
		},
		{ name: "codex", adapter: codexAdapter, promptArgs: ["@/work/app/src/a.ts\nfix the test"] },
		{ name: "pi", adapter: piAdapter, promptArgs: ["@/work/app/src/a.ts\nfix the test"] },
		{ name: "droid", adapter: droidAdapter, promptArgs: ["@/work/app/src/a.ts\nfix the test"] },
		{ name: "opencode", adapter: opencodeAdapter, promptArgs: ["--prompt", "@/work/app/src/a.ts\nfix the test"] },
	])("$name starts empty from + and injects the prompt the way Orca does", ({ name, adapter, promptArgs }) => {
		expect(adapter.id).toBe(name);
		expect(adapter.executable).toBe(name);
		expect(adapter.processForm).toBe("interactive");
		expect(adapter.singleInstructionArgs("")).toEqual([]);
		expect(adapter.singleInstructionArgs("fix the test", ["/work/app/src/a.ts"])).toEqual(promptArgs);
		expect(adapter.locateSessionId({ sessionsRoot: "/tmp", cwd: "/work", startedAt: 1 })).toBeNull();
	});
});

describe("grok resume args", () => {
	it("resumes the session then passes the prompt after --", () => {
		expect(grokAdapter.resumeArgs("继续修", "sess-9", ["/work/app/src/a.ts"])).toEqual([
			"--resume",
			"sess-9",
			"--",
			"@/work/app/src/a.ts\n继续修",
		]);
		expect(grokAdapter.resumeArgs("", "sess-9")).toEqual(["--resume", "sess-9"]);
		expect(grokAdapter.resumeArgs("继续修", "sess-9").some((arg) => SKIP_FLAGS.includes(arg))).toBe(false);
	});
});

describe("grok session id location", () => {
	it("picks the session under the temp tree whose cwd matches and whose last activity is not before the run", () => {
		const root = mkdtempSync(join(tmpdir(), "grok-sessions-"));
		const startedAt = Date.parse("2026-09-24T06:00:00.000Z");
		writeSummary(root, "ws-old", "old-id", "/work/app", "2026-09-24T05:00:00.000Z");
		writeSummary(root, "ws-other", "other-id", "/work/else", "2026-09-24T06:05:00.000Z");
		writeSummary(root, "ws-new", "sess-9", "/work/app", "2026-09-24T06:02:00.000Z");
		writeSummary(root, "ws-newer", "sess-later", "/work/app", "2026-09-24T06:04:00.000Z");
		expect(grokAdapter.locateSessionId({ sessionsRoot: root, cwd: "/work/app", startedAt })).toBe("sess-later");
		expect(grokAdapter.locateSessionId({ sessionsRoot: root, cwd: "/missing", startedAt })).toBeNull();
	});
});

describe("omp and cursor-agent adapters", () => {
	it.each([
		{
			name: "omp",
			adapter: ompAdapter,
			executable: "omp",
			single: ["--print", "@/work/app/src/a.ts\nfix the test"],
			resume: ["--print", "@/work/app/src/a.ts\n继续修", "--resume", "omp-9"],
			skip: ["--auto-approve", "--approval-mode", "--plan-yolo"],
		},
		{
			name: "cursor-agent",
			adapter: cursorAgentAdapter,
			executable: "cursor-agent",
			single: ["--print", "@/work/app/src/a.ts\nfix the test"],
			resume: ["--print", "@/work/app/src/a.ts\n继续修", "--resume", "chat-9"],
			skip: ["--force", "-f", "--yolo", "--trust", "--approve-mcps"],
		},
	])(
		"$name builds a single instruction and a resume, and keeps confirmation flags out",
		({ adapter, executable, single, resume, skip }) => {
			expect(adapter.executable).toBe(executable);
			expect(adapter.processForm).toBe("one-shot");
			expect(adapter.singleInstructionArgs("fix the test", ["/work/app/src/a.ts"])).toEqual(single);
			expect(
				adapter.resumeArgs("继续修", executable === "omp" ? "omp-9" : "chat-9", ["/work/app/src/a.ts"]),
			).toEqual(resume);
			expect(
				[...adapter.singleInstructionArgs("fix the test"), ...adapter.resumeArgs("继续修", "id")].some((arg) =>
					skip.includes(arg),
				),
			).toBe(false);
		},
	);

	it("locates the omp session written under the temp tree after the run started", () => {
		const root = mkdtempSync(join(tmpdir(), "omp-sessions-"));
		const startedAt = Date.parse("2026-09-24T06:00:00.000Z");
		writeOmp(root, "old", "/work/app", "2026-09-24T05:00:00.000Z");
		writeOmp(root, "other", "/work/else", "2026-09-24T06:05:00.000Z");
		writeOmp(root, "sess-9", "/work/app", "2026-09-24T06:02:00.000Z");
		expect(ompAdapter.locateSessionId({ sessionsRoot: root, cwd: "/work/app", startedAt })).toBe("sess-9");
		expect(ompAdapter.locateSessionId({ sessionsRoot: root, cwd: "/missing", startedAt })).toBeNull();
	});

	it("locates the cursor-agent chat id from meta.json under the temp tree", () => {
		const root = mkdtempSync(join(tmpdir(), "cursor-sessions-"));
		const startedAt = Date.parse("2026-09-24T06:00:00.000Z");
		writeCursor(root, "old-chat", "/work/app", Date.parse("2026-09-24T05:00:00.000Z"));
		writeCursor(root, "other-chat", "/work/else", Date.parse("2026-09-24T06:05:00.000Z"));
		writeCursor(root, "chat-9", "/work/app", Date.parse("2026-09-24T06:02:00.000Z"));
		expect(cursorAgentAdapter.locateSessionId({ sessionsRoot: root, cwd: "/work/app", startedAt })).toBe("chat-9");
		expect(cursorAgentAdapter.locateSessionId({ sessionsRoot: root, cwd: "/missing", startedAt })).toBeNull();
	});
});

function writeSummary(root: string, workspace: string, id: string, cwd: string, lastActiveAt: string): void {
	const dir = join(root, workspace, id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "summary.json"),
		JSON.stringify({
			info: { id, cwd },
			chat_format_version: 1,
			git_root_dir: cwd,
			last_active_at: lastActiveAt,
			generated_title: id,
		}),
	);
}

function writeOmp(root: string, id: string, cwd: string, timestamp: string): void {
	const dir = join(root, cwd.replace(/\//g, "-"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${id}.jsonl`),
		[
			JSON.stringify({ type: "title", title: id, updatedAt: timestamp }),
			JSON.stringify({ type: "session", id, cwd, timestamp, title: id }),
		].join("\n"),
	);
}

function writeCursor(root: string, id: string, cwd: string, updatedAtMs: number): void {
	const dir = join(root, "project-hash", id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "meta.json"), JSON.stringify({ schemaVersion: 1, cwd, updatedAtMs, title: id }));
}
