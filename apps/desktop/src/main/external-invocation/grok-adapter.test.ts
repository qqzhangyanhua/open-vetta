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
	])(
		"builds argv for $prompt",
		({ prompt, paths, args }: { prompt: string; paths?: readonly string[]; args: readonly string[] }) => {
			expect(grokAdapter.executable).toBe("grok");
			expect(grokAdapter.singleInstructionArgs(prompt, paths)).toEqual(args);
			expect(grokAdapter.singleInstructionArgs(prompt, paths).some((arg) => SKIP_FLAGS.includes(arg))).toBe(false);
		},
	);
});
