import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { grokAdapter } from "./grok-adapter.js";

const SKIP_FLAGS = ["--always-approve", "--trust", "--yolo", "--dangerously-skip-permissions"];

describe("grok single-instruction args", () => {
	it.each([
		{ prompt: "fix the test", args: ["--single", "fix the test"] },
		{ prompt: 'say "hi"', args: ["--single", 'say "hi"'] },
		{ prompt: "line1\nline2", args: ["--single", "line1\nline2"] },
		{ prompt: "", args: ["--single", ""] },
		{
			prompt: "fix the test",
			paths: ["/work/app/src/a.ts", "/work/app/src"],
			args: ["--single", "@/work/app/src/a.ts\n@/work/app/src\nfix the test"],
		},
		{
			prompt: "看一下 @/work/app/src/a.ts 的测试",
			paths: ["/work/app/src/a.ts"],
			args: ["--single", "@/work/app/src/a.ts\n看一下 的测试"],
		},
	])(
		"builds argv for $prompt",
		({ prompt, paths, args }: { prompt: string; paths?: readonly string[]; args: readonly string[] }) => {
			expect(grokAdapter.executable).toBe("grok");
			expect(grokAdapter.singleInstructionArgs(prompt, paths)).toEqual(args);
			expect(grokAdapter.singleInstructionArgs(prompt, paths).some((arg) => SKIP_FLAGS.includes(arg))).toBe(false);
		},
	);
});

describe("grok resume args", () => {
	it("appends --resume and still refuses confirmation-skipping flags", () => {
		expect(grokAdapter.resumeArgs("继续修", "sess-9", ["/work/app/src/a.ts"])).toEqual([
			"--single",
			"@/work/app/src/a.ts\n继续修",
			"--resume",
			"sess-9",
		]);
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
