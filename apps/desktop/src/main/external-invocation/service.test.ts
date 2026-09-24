import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createExternalInvocationService,
	type ExternalInvocationEntry,
	type ExternalInvocationEvent,
	type ExternalInvocationProcess,
} from "./service.js";

class FakeProcess implements ExternalInvocationProcess {
	private data: Array<(chunk: string) => void> = [];
	private exit: Array<(event: { exitCode: number | null }) => void> = [];

	onData(listener: (chunk: string) => void): () => void {
		this.data.push(listener);
		return () => {
			this.data = this.data.filter((item) => item !== listener);
		};
	}

	onExit(listener: (event: { exitCode: number | null }) => void): () => void {
		this.exit.push(listener);
		return () => {
			this.exit = this.exit.filter((item) => item !== listener);
		};
	}

	emitData(chunk: string): void {
		for (const listener of this.data) listener(chunk);
	}

	emitExit(exitCode: number | null): void {
		for (const listener of this.exit) listener({ exitCode });
	}
}

function harness(options?: { failStart?: Error; limit?: number }) {
	const entries: ExternalInvocationEntry[] = [];
	const events: ExternalInvocationEvent[] = [];
	const started: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
	const procs: FakeProcess[] = [];
	let now = Date.parse("2026-09-24T06:00:00.000Z");
	let nextId = 0;
	const directory = mkdtempSync(join(tmpdir(), "vetta-external-invocation-"));
	const service = createExternalInvocationService({
		processes: {
			async start(request) {
				started.push(request);
				if (options?.failStart) throw options.failStart;
				const proc = new FakeProcess();
				procs.push(proc);
				return proc;
			},
		},
		entries: {
			append(entry) {
				entries.push(entry);
			},
		},
		artifactDirectory: () => directory,
		clock: { now: () => now },
		ids: { next: () => `id-${nextId++}` },
		outputLimitBytes: options?.limit,
	});
	service.subscribe("session-1", (event) => events.push(event));
	return {
		service,
		entries,
		events,
		started,
		procs,
		directory,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("external invocation service", () => {
	it("records running then completed with exit code 0, and writes the output beside the session", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "fix the test",
			agentId: "grok",
		});
		expect(h.events.map((event) => event.type)).toEqual(["running"]);
		expect(h.started).toEqual([{ file: "grok", args: ["--single", "fix the test"], cwd: "/work/app" }]);
		expect(h.started[0]?.args).not.toContain("--always-approve");
		h.advance(1000);
		h.procs[0]?.emitData("hello grok");
		h.procs[0]?.emitExit(0);
		await viWait();
		expect(h.events.map((event) => event.type)).toEqual(["running", "completed"]);
		expect(h.events[1]).toMatchObject({ exitCode: 0, invocationId: started.invocationId });
		expect(h.entries.map((entry) => entry.data.status)).toEqual(["running", "completed"]);
		expect(h.entries[0]?.data).toMatchObject({ status: "running" });
		expect(h.entries[1]?.data).toMatchObject({
			status: "completed",
			exitCode: 0,
			invocationId: started.invocationId,
			prompt: "fix the test",
		});
		expect(h.entries[0]).not.toBe(h.entries[1]);
		expect(readFileSync(join(h.directory, `${started.invocationId}.pty`), "utf8")).toBe("hello grok");
	});

	it("records a non-zero exit as failed and keeps the exit code", async () => {
		const h = harness();
		await h.service.start({ sessionId: "session-1", cwd: "/work/app", prompt: "boom", agentId: "grok" });
		h.procs[0]?.emitExit(2);
		await viWait();
		expect(h.events.at(-1)).toMatchObject({ type: "failed", exitCode: 2, reason: "exit 2" });
		expect(h.entries.at(-1)?.data.status).toBe("failed");
		expect(h.entries.at(-1)?.data.exitCode).toBe(2);
	});

	it("records a spawn failure as failed with the reason and does not rewrite the running entry", async () => {
		const h = harness({ failStart: new Error("Executable not found: grok") });
		await h.service.start({ sessionId: "session-1", cwd: "/work/app", prompt: "hi", agentId: "grok" });
		expect(h.events.map((event) => event.type)).toEqual(["running", "failed"]);
		expect(h.events[1]).toMatchObject({ type: "failed", exitCode: null, reason: "Executable not found: grok" });
		expect(h.entries.map((entry) => entry.data.status)).toEqual(["running", "failed"]);
		expect(h.entries[0]?.data.status).toBe("running");
		expect(h.entries[1]?.data.failureReason).toBe("Executable not found: grok");
	});

	it("keeps the head and tail when output exceeds the limit and records how many bytes were dropped", async () => {
		const h = harness({ limit: 8 });
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "long",
			agentId: "grok",
		});
		h.procs[0]?.emitData("AAAABBBBCCCC");
		h.procs[0]?.emitExit(0);
		await viWait();
		expect(readFileSync(join(h.directory, `${started.invocationId}.pty`), "utf8")).toBe("AAAACCCC");
		expect(h.entries.at(-1)?.data.discardedBytes).toBe(4);
	});
});

async function viWait(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
