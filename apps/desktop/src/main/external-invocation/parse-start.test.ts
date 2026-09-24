import { describe, expect, it } from "vitest";
import { parseExternalInvocationStart } from "./parse-start.js";

describe("parse external invocation start", () => {
	const base = {
		sessionId: "session-1",
		cwd: "/work/app",
		agentId: "grok",
	};

	it("allows an empty prompt when launching interactive Grok", () => {
		expect(parseExternalInvocationStart({ ...base, prompt: "", newSession: true })).toMatchObject({
			prompt: "",
			agentId: "grok",
			newSession: true,
		});
	});

	it("still requires a string prompt", () => {
		expect(() => parseExternalInvocationStart({ ...base })).toThrow(/prompt must be a string/);
	});
});
