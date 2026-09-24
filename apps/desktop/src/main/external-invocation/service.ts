import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTERNAL_INVOCATION_CUSTOM_TYPE } from "@vetta/runtime-core/conversation";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { findExternalAgentAdapter } from "./grok-adapter.js";
import { EXTERNAL_INVOCATION_OUTPUT_LIMIT_BYTES, ExternalInvocationOutputCapture } from "./output-capture.js";

export interface ExternalInvocationProcess {
	onData(listener: (chunk: string) => void): () => void;
	onExit(listener: (event: { exitCode: number | null }) => void): () => void;
	write(data: string): void;
	kill(): void;
}

export interface ExternalInvocationProcesses {
	start(options: { file: string; args: readonly string[]; cwd: string }): Promise<ExternalInvocationProcess>;
}

export interface ExternalInvocationEntry {
	readonly sessionId: string;
	readonly entryId: string;
	readonly customType: typeof EXTERNAL_INVOCATION_CUSTOM_TYPE;
	readonly timestamp: string;
	readonly data: ExternalInvocationEntryData;
}

export interface ExternalInvocationEntryData {
	readonly invocationId: string;
	readonly agentId: string;
	readonly prompt: string;
	readonly cwd: string;
	readonly status: "queued" | "running" | "completed" | "failed" | "interrupted";
	readonly exitCode: number | null;
	readonly failureReason: string | null;
	readonly interruptReason: "user" | "app-exit" | "cancelled" | null;
	readonly discardedBytes: number;
	readonly outputPath: string;
	readonly startedAt: string;
	readonly endedAt: string | null;
}

export interface ExternalInvocationEntryStore {
	append(entry: ExternalInvocationEntry): Promise<void> | void;
	list(): readonly ExternalInvocationEntry[];
}

export type ExternalInvocationEvent =
	| {
			readonly type: "running";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly agentId: string;
			readonly prompt: string;
	  }
	| {
			readonly type: "completed";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly exitCode: 0;
			readonly discardedBytes: number;
	  }
	| {
			readonly type: "failed";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly exitCode: number | null;
			readonly reason: string;
			readonly discardedBytes: number;
	  }
	| {
			readonly type: "interrupted";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly reason: "user" | "app-exit" | "cancelled";
			readonly message: string;
			readonly agentId?: string;
			readonly prompt?: string;
	  }
	| {
			readonly type: "output";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly chunk: string;
	  }
	| {
			readonly type: "truncated";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly discardedBytes: number;
	  };

export interface ExternalInvocationService {
	start(request: {
		sessionId: string;
		cwd: string;
		prompt: string;
		agentId: string;
		referencedPaths?: readonly string[];
	}): Promise<{ invocationId: string }>;
	subscribe(sessionId: string, listener: (event: ExternalInvocationEvent) => void): () => void;
	subscribeRunning(listener: (sessionIds: readonly string[]) => void): () => void;
	writeInput(invocationId: string, data: string): void;
	stop(invocationId: string): void;
	deleteSession(sessionId: string): Promise<void>;
	shutdown(): void;
	recover(): Promise<void>;
	readOutput(sessionId: string, invocationId: string): { head: string; tail: string; discardedBytes: number } | null;
}

const INTERRUPT_MESSAGE = {
	user: "已中断（你停止了它）",
	"app-exit": "已中断（应用退出）",
	cancelled: "已中断（已取消）",
} as const;

export function createExternalInvocationService(deps: {
	processes: ExternalInvocationProcesses;
	entries: ExternalInvocationEntryStore;
	artifactDirectory(sessionId: string): string;
	clock: { now(): number };
	ids: { next(): string };
	outputLimitBytes?: number;
}): ExternalInvocationService {
	const listeners = new Map<string, Set<(event: ExternalInvocationEvent) => void>>();
	const savedOutput = new Map<
		string,
		{ sessionId: string; invocationId: string; head: string; tail: string; discardedBytes: number }
	>();
	const processes = new Map<string, ExternalInvocationProcess>();
	const open = new Map<string, { sessionId: string; data: ExternalInvocationEntryData }>();
	const settled = new Set<string>();
	const statusEvents = new Map<string, ExternalInvocationEvent>();
	const runningListeners = new Set<(sessionIds: readonly string[]) => void>();

	function runningSessionIds(): readonly string[] {
		const ids = new Set<string>();
		for (const invocationId of processes.keys()) {
			const sessionId = open.get(invocationId)?.sessionId;
			if (sessionId) ids.add(sessionId);
		}
		return [...ids];
	}

	function notifyRunning(): void {
		const ids = runningSessionIds();
		for (const listener of runningListeners) listener(ids);
	}

	function emit(event: ExternalInvocationEvent): void {
		if (event.type !== "output" && event.type !== "truncated") statusEvents.set(event.invocationId, event);
		for (const listener of listeners.get(event.sessionId) ?? []) listener(event);
	}

	function timestamp(): string {
		return new Date(deps.clock.now()).toISOString();
	}

	async function append(entry: ExternalInvocationEntry): Promise<void> {
		await deps.entries.append(entry);
	}

	return {
		subscribe(sessionId, listener) {
			const set = listeners.get(sessionId) ?? new Set();
			set.add(listener);
			listeners.set(sessionId, set);
			for (const status of statusEvents.values()) {
				if (status.sessionId === sessionId) listener(status);
			}
			for (const saved of savedOutput.values()) {
				if (saved.sessionId !== sessionId) continue;
				if (saved.head.length > 0) {
					listener({ type: "output", sessionId, invocationId: saved.invocationId, chunk: saved.head });
				}
				if (saved.discardedBytes > 0) {
					listener({
						type: "truncated",
						sessionId,
						invocationId: saved.invocationId,
						discardedBytes: saved.discardedBytes,
					});
				}
				if (saved.tail.length > 0) {
					listener({ type: "output", sessionId, invocationId: saved.invocationId, chunk: saved.tail });
				}
			}
			return () => set.delete(listener);
		},
		subscribeRunning(listener) {
			runningListeners.add(listener);
			listener(runningSessionIds());
			return () => runningListeners.delete(listener);
		},
		writeInput(invocationId, data) {
			processes.get(invocationId)?.write(data);
		},
		stop(invocationId) {
			const current = open.get(invocationId);
			const proc = processes.get(invocationId);
			if (!current || !proc || settled.has(invocationId)) return;
			settled.add(invocationId);
			proc.kill();
			processes.delete(invocationId);
			notifyRunning();
			const endedAt = timestamp();
			const message = INTERRUPT_MESSAGE.user;
			void append({
				sessionId: current.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: endedAt,
				data: {
					...current.data,
					status: "interrupted",
					exitCode: null,
					failureReason: message,
					interruptReason: "user",
					endedAt,
				},
			});
			emit({
				type: "interrupted",
				sessionId: current.sessionId,
				invocationId,
				agentId: current.data.agentId,
				prompt: current.data.prompt,
				reason: "user",
				message,
			});
		},
		async deleteSession(sessionId) {
			for (const [invocationId, proc] of processes) {
				if (open.get(invocationId)?.sessionId !== sessionId) continue;
				settled.add(invocationId);
				proc.kill();
				processes.delete(invocationId);
			}
			rmSync(deps.artifactDirectory(sessionId), { recursive: true, force: true });
			notifyRunning();
		},
		shutdown() {
			for (const [invocationId, proc] of processes) {
				settled.add(invocationId);
				proc.kill();
			}
			processes.clear();
			notifyRunning();
		},
		async recover() {
			const latest = new Map<string, ExternalInvocationEntry>();
			for (const entry of deps.entries.list()) latest.set(entry.data.invocationId, entry);
			for (const entry of latest.values()) {
				if (entry.data.status !== "running" && entry.data.status !== "queued") continue;
				const endedAt = timestamp();
				await append({
					sessionId: entry.sessionId,
					entryId: deps.ids.next(),
					customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
					timestamp: endedAt,
					data: {
						...entry.data,
						status: "interrupted",
						interruptReason: "app-exit",
						failureReason: INTERRUPT_MESSAGE["app-exit"],
						endedAt,
					},
				});
			}
		},
		readOutput(sessionId, invocationId) {
			const saved = savedOutput.get(invocationId);
			if (saved && saved.sessionId === sessionId) {
				return { head: saved.head, tail: saved.tail, discardedBytes: saved.discardedBytes };
			}
			const file = join(deps.artifactDirectory(sessionId), `${invocationId}.pty`);
			if (!existsSync(file)) return null;
			const body = readFileSync(file);
			const metaPath = `${file}.meta.json`;
			const meta = existsSync(metaPath)
				? (JSON.parse(readFileSync(metaPath, "utf8")) as { discardedBytes?: number; headBytes?: number })
				: {};
			const discardedBytes = meta.discardedBytes ?? 0;
			const headBytes = meta.headBytes ?? body.length;
			if (discardedBytes <= 0) return { head: body.toString("utf8"), tail: "", discardedBytes: 0 };
			return {
				head: body.subarray(0, headBytes).toString("utf8"),
				tail: body.subarray(headBytes).toString("utf8"),
				discardedBytes,
			};
		},
		async start(request) {
			if (isSshProjectUri(request.cwd)) {
				throw new Error("Remote projects do not support external invocations");
			}
			const adapter = findExternalAgentAdapter(request.agentId);
			if (!adapter) throw new Error(`Unknown external agent: ${request.agentId}`);
			const invocationId = deps.ids.next();
			const startedAt = timestamp();
			const directory = deps.artifactDirectory(request.sessionId);
			mkdirSync(directory, { recursive: true });
			const outputPath = join(directory, `${invocationId}.pty`);
			const base = {
				invocationId,
				agentId: adapter.id,
				prompt: request.prompt,
				cwd: request.cwd,
				outputPath,
				startedAt,
			};
			await append({
				sessionId: request.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: startedAt,
				data: {
					...base,
					status: "running",
					exitCode: null,
					failureReason: null,
					interruptReason: null,
					discardedBytes: 0,
					endedAt: null,
				},
			});
			open.set(invocationId, {
				sessionId: request.sessionId,
				data: {
					...base,
					status: "running",
					exitCode: null,
					failureReason: null,
					interruptReason: null,
					discardedBytes: 0,
					endedAt: null,
				},
			});
			emit({
				type: "running",
				sessionId: request.sessionId,
				invocationId,
				agentId: adapter.id,
				prompt: request.prompt,
			});

			let process: ExternalInvocationProcess;
			try {
				process = await deps.processes.start({
					file: adapter.executable,
					args: adapter.singleInstructionArgs(request.prompt, request.referencedPaths),
					cwd: request.cwd,
				});
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				const endedAt = timestamp();
				await append({
					sessionId: request.sessionId,
					entryId: deps.ids.next(),
					customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
					timestamp: endedAt,
					data: {
						...base,
						status: "failed",
						exitCode: null,
						failureReason: reason,
						interruptReason: null,
						discardedBytes: 0,
						endedAt,
					},
				});
				emit({
					type: "failed",
					sessionId: request.sessionId,
					invocationId,
					exitCode: null,
					reason,
					discardedBytes: 0,
				});
				return { invocationId };
			}

			processes.set(invocationId, process);
			notifyRunning();
			const capture = new ExternalInvocationOutputCapture(
				deps.outputLimitBytes ?? EXTERNAL_INVOCATION_OUTPUT_LIMIT_BYTES,
			);
			savedOutput.set(invocationId, {
				sessionId: request.sessionId,
				invocationId,
				head: "",
				tail: "",
				discardedBytes: 0,
			});
			const flush = (): void => {
				const snapshot = capture.snapshot();
				writeFileSync(outputPath, snapshot.body);
				const parts = capture.parts();
				writeFileSync(
					`${outputPath}.meta.json`,
					JSON.stringify({ discardedBytes: parts.discardedBytes, headBytes: parts.headBytes }),
				);
				savedOutput.set(invocationId, { sessionId: request.sessionId, invocationId, ...parts });
			};
			process.onData((chunk) => {
				capture.push(chunk);
				flush();
				emit({
					type: "output",
					sessionId: request.sessionId,
					invocationId,
					chunk,
				});
			});
			process.onExit((event) => {
				if (settled.has(invocationId)) return;
				settled.add(invocationId);
				processes.delete(invocationId);
				notifyRunning();
				flush();
				const snapshot = capture.snapshot();
				const endedAt = timestamp();
				const failed = event.exitCode !== 0;
				void append({
					sessionId: request.sessionId,
					entryId: deps.ids.next(),
					customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
					timestamp: endedAt,
					data: {
						...base,
						status: failed ? "failed" : "completed",
						exitCode: event.exitCode,
						failureReason: failed ? `exit ${event.exitCode ?? "null"}` : null,
						interruptReason: null,
						discardedBytes: snapshot.discardedBytes,
						endedAt,
					},
				}).then(() => {
					if (failed) {
						emit({
							type: "failed",
							sessionId: request.sessionId,
							invocationId,
							exitCode: event.exitCode,
							reason: `exit ${event.exitCode ?? "null"}`,
							discardedBytes: snapshot.discardedBytes,
						});
						return;
					}
					emit({
						type: "completed",
						sessionId: request.sessionId,
						invocationId,
						exitCode: 0,
						discardedBytes: snapshot.discardedBytes,
					});
				});
			});
			return { invocationId };
		},
	};
}
