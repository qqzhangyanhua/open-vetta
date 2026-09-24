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

	readonly written: string[] = [];

	emitExit(exitCode: number | null): void {
		for (const listener of this.exit) listener({ exitCode });
	}

	write(data: string): void {
		this.written.push(data);
	}

	killed = false;

	kill(): void {
		this.killed = true;
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
			list() {
				return entries;
			},
		},
		artifactDirectory: (sessionId) => join(directory, sessionId),
		clock: { now: () => now },
		ids: { next: () => `id-${nextId++}` },
		outputLimitBytes: options?.limit,
	});
	const unsubscribe = service.subscribe("session-1", (event) => events.push(event));
	return {
		service,
		entries,
		events,
		started,
		procs,
		directory,
		unsubscribe,
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
		expect(h.events.map((event) => event.type)).toEqual(["running", "output", "completed"]);
		expect(h.events.find((event) => event.type === "completed")).toMatchObject({
			exitCode: 0,
			invocationId: started.invocationId,
		});
		expect(h.entries.map((entry) => entry.data.status)).toEqual(["running", "completed"]);
		expect(h.entries[0]?.data).toMatchObject({ status: "running" });
		expect(h.entries[1]?.data).toMatchObject({
			status: "completed",
			exitCode: 0,
			invocationId: started.invocationId,
			prompt: "fix the test",
		});
		expect(h.entries[0]).not.toBe(h.entries[1]);
		expect(readFileSync(join(h.directory, "session-1", `${started.invocationId}.pty`), "utf8")).toBe("hello grok");
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
		expect(readFileSync(join(h.directory, "session-1", `${started.invocationId}.pty`), "utf8")).toBe("AAAACCCC");
		expect(h.entries.at(-1)?.data.discardedBytes).toBe(4);
	});

	it("gives a subscriber the saved output and then live output", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "watch",
			agentId: "grok",
		});
		h.procs[0]?.emitData("saved");
		const seen: string[] = [];
		h.service.subscribe("session-1", (event) => {
			if (event.type === "output" && event.invocationId === started.invocationId) seen.push(event.chunk);
		});
		expect(seen).toEqual(["saved"]);
		h.procs[0]?.emitData(" live");
		expect(seen).toEqual(["saved", " live"]);
	});

	it("reads the saved output back after the service is recreated", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "replay",
			agentId: "grok",
		});
		h.procs[0]?.emitData("HEADTAIL");
		const again = createExternalInvocationService({
			processes: {
				async start() {
					throw new Error("unused");
				},
			},
			artifactDirectory: (sessionId) => join(h.directory, sessionId),
			entries: { append() {}, list: () => [] },
			clock: { now: () => Date.parse("2026-09-24T06:00:00.000Z") },
			ids: { next: () => "later" },
		});
		expect(again.readOutput("session-1", started.invocationId)).toEqual({
			head: "HEADTAIL",
			tail: "",
			discardedBytes: 0,
		});
	});

	it("passes @ path lines in front of the question to the CLI", async () => {
		const h = harness();
		await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "fix the test",
			agentId: "grok",
			referencedPaths: ["/work/app/src/a.ts", "/work/app/src"],
		});
		expect(h.started[0]?.args).toEqual(["--single", "@/work/app/src/a.ts\n@/work/app/src\nfix the test"]);
	});

	it("rejects a remote project directory before starting a process", async () => {
		const h = harness();
		await expect(
			h.service.start({
				sessionId: "session-1",
				cwd: "ssh://host-1/srv/app",
				prompt: "fix the test",
				agentId: "grok",
			}),
		).rejects.toThrow(/remote projects do not support/i);
		expect(h.started).toEqual([]);
		expect(h.entries).toEqual([]);
	});

	it("keeps running after the renderer disconnects and replays the full output on resubscribe", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "keep going",
			agentId: "grok",
		});
		h.procs[0]?.emitData("before ");
		h.unsubscribe();
		h.procs[0]?.emitData("away ");
		expect(h.procs[0]?.killed).toBe(false);
		const seen: string[] = [];
		h.service.subscribe("session-1", (event) => {
			if (event.type === "output" && event.invocationId === started.invocationId) seen.push(event.chunk);
		});
		expect(seen.join("")).toBe("before away ");
		h.procs[0]?.emitData("live");
		expect(seen.join("")).toBe("before away live");
	});

	it("stops the process and deletes artifacts when the session is deleted, and stops every process on shutdown", async () => {
		const h = harness();
		const first = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "one",
			agentId: "grok",
		});
		const second = await h.service.start({
			sessionId: "session-2",
			cwd: "/work/other",
			prompt: "two",
			agentId: "grok",
		});
		h.procs[0]?.emitData("kept");
		await h.service.deleteSession("session-1");
		expect(h.procs[0]?.killed).toBe(true);
		expect(h.procs[1]?.killed).toBe(false);
		expect(() => readFileSync(join(h.directory, "session-1", `${first.invocationId}.pty`))).toThrow();
		h.service.shutdown();
		expect(h.procs[1]?.killed).toBe(true);
		expect(h.entries.filter((entry) => entry.data.invocationId === second.invocationId).at(-1)?.data.status).toBe(
			"running",
		);
	});

	it("marks running and queued invocations interrupted by app exit when recovering at startup", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "still going",
			agentId: "grok",
		});
		h.service.shutdown();
		h.entries.push({
			sessionId: "session-1",
			entryId: "queued-entry",
			customType: "vetta.external_invocation",
			timestamp: "2026-09-24T06:00:00.000Z",
			data: {
				invocationId: "queued-1",
				agentId: "grok",
				prompt: "wait",
				cwd: "/work/app",
				status: "queued",
				exitCode: null,
				failureReason: null,
				interruptReason: null,
				discardedBytes: 0,
				outputPath: join(h.directory, "session-1", "queued-1.pty"),
				startedAt: "2026-09-24T06:00:00.000Z",
				endedAt: null,
			},
		});
		await h.service.recover();
		const latest = (invocationId: string) =>
			h.entries.filter((entry) => entry.data.invocationId === invocationId).at(-1)?.data;
		expect(latest(started.invocationId)).toMatchObject({
			status: "interrupted",
			interruptReason: "app-exit",
			failureReason: "已中断（应用退出）",
		});
		expect(latest("queued-1")).toMatchObject({
			status: "interrupted",
			interruptReason: "app-exit",
			failureReason: "已中断（应用退出）",
		});
	});

	it("writes that the user stopped the invocation", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "stop me",
			agentId: "grok",
		});
		h.service.stop(started.invocationId);
		h.procs[0]?.emitExit(0);
		await viWait();
		expect(h.procs[0]?.killed).toBe(true);
		expect(h.entries.at(-1)?.data).toMatchObject({
			status: "interrupted",
			interruptReason: "user",
			failureReason: "已中断（你停止了它）",
		});
		expect(h.events.at(-1)).toMatchObject({
			type: "interrupted",
			reason: "user",
			message: "已中断（你停止了它）",
		});
		expect(h.events.some((event) => event.type === "completed" || event.type === "failed")).toBe(false);
	});

	it("writes terminal keyboard input into the process", async () => {
		const h = harness();
		const started = await h.service.start({
			sessionId: "session-1",
			cwd: "/work/app",
			prompt: "confirm",
			agentId: "grok",
		});
		h.service.writeInput(started.invocationId, "y\n");
		expect(h.procs[0]?.written).toEqual(["y\n"]);
	});
});

async function viWait(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
