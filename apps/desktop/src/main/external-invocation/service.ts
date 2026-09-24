import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTERNAL_INVOCATION_CUSTOM_TYPE } from "@vetta/runtime-core/conversation";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import { findExternalAgentAdapter } from "./grok-adapter.js";
import { type ExternalInvocationOrigin, rebuildExternalInvocationOrigins } from "./origins.js";
import { EXTERNAL_INVOCATION_OUTPUT_LIMIT_BYTES, ExternalInvocationOutputCapture } from "./output-capture.js";

export interface ExternalInvocationProcess {
	onData(listener: (chunk: string) => void): () => void;
	onExit(listener: (event: { exitCode: number | null }) => void): () => void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
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
	readonly externalSessionId: string | null;
	readonly ordinal: number;
}

export interface ExternalInvocationEntryStore {
	append(entry: ExternalInvocationEntry): Promise<void> | void;
	list(): readonly ExternalInvocationEntry[];
	forget(sessionId: string): void;
}

export type ExternalInvocationEvent =
	| {
			readonly type: "running";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly agentId: string;
			readonly prompt: string;
			readonly ordinal: number;
			readonly externalSessionId: string | null;
			readonly startedAt: string;
	  }
	| {
			readonly type: "queued";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly agentId: string;
			readonly prompt: string;
			readonly ordinal: number;
			readonly externalSessionId: string | null;
	  }
	| {
			readonly type: "completed";
			readonly sessionId: string;
			readonly invocationId: string;
			readonly exitCode: 0;
			readonly discardedBytes: number;
			readonly externalSessionId: string | null;
			readonly ordinal: number;
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
		externalSessionId?: string | null;
		newSession?: boolean;
		historyResume?: { readonly externalSessionId: string; readonly cwd: string };
	}): Promise<{ invocationId: string }>;
	subscribe(sessionId: string, listener: (event: ExternalInvocationEvent) => void): () => void;
	subscribeRunning(listener: (sessionIds: readonly string[]) => void): () => void;
	writeInput(invocationId: string, data: string): void;
	resize(invocationId: string, cols: number, rows: number): void;
	stop(invocationId: string): void;
	deleteSession(sessionId: string): Promise<void>;
	origins(): readonly ExternalInvocationOrigin[];
	shutdown(): void;
	recover(): Promise<void>;
	readOutput(sessionId: string, invocationId: string): { head: string; tail: string; discardedBytes: number } | null;
	recordedDirectoryExists(cwd: string): boolean;
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
	sessionsDirectory?(agentId: string): string | null;
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
	const queues = new Map<string, string[]>();
	const lockOf = new Map<string, string>();
	const referencedPathsOf = new Map<string, readonly string[]>();

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

	function lockKey(agentId: string, externalSessionId: string): string {
		return `${agentId}\0${externalSessionId}`;
	}

	function latestExternalSessionId(sessionId: string, agentId: string): string | null {
		let found: string | null = null;
		for (const entry of deps.entries.list()) {
			if (entry.sessionId === sessionId && entry.data.agentId === agentId && entry.data.externalSessionId) {
				found = entry.data.externalSessionId;
			}
		}
		for (const live of open.values()) {
			if (live.sessionId === sessionId && live.data.agentId === agentId && live.data.externalSessionId) {
				found = live.data.externalSessionId;
			}
		}
		return found;
	}

	function pendingHead(sessionId: string, agentId: string): string | null {
		let head: string | null = null;
		let started = "";
		for (const [id, live] of open) {
			if (settled.has(id) || live.sessionId !== sessionId || live.data.agentId !== agentId) continue;
			if (live.data.externalSessionId) continue;
			if (live.data.status !== "running" && live.data.status !== "queued") continue;
			if (!head || live.data.startedAt >= started) {
				head = id;
				started = live.data.startedAt;
			}
		}
		return head;
	}

	function lockBusy(lock: string): boolean {
		for (const [id, live] of open) {
			if (lockOf.get(id) === lock && live.data.status === "running" && !settled.has(id)) return true;
		}
		return false;
	}

	function ordinalFor(agentId: string, externalSessionId: string | null, headId: string | null): number {
		if (externalSessionId) {
			const ids = new Set<string>();
			for (const entry of deps.entries.list()) {
				if (entry.data.agentId === agentId && entry.data.externalSessionId === externalSessionId) {
					ids.add(entry.data.invocationId);
				}
			}
			for (const [id, live] of open) {
				if (live.data.agentId === agentId && live.data.externalSessionId === externalSessionId) ids.add(id);
			}
			return ids.size + 1;
		}
		if (!headId) return 1;
		const lock = lockOf.get(headId) ?? `pending\0${headId}`;
		return (open.get(headId)?.data.ordinal ?? 1) + (queues.get(lock)?.length ?? 0) + 1;
	}

	function enqueue(lock: string, invocationId: string): void {
		const waiting = queues.get(lock) ?? [];
		waiting.push(invocationId);
		queues.set(lock, waiting);
		lockOf.set(invocationId, lock);
	}

	function pump(lock: string): void {
		if (lockBusy(lock)) return;
		const waiting = queues.get(lock) ?? [];
		while (waiting.length > 0) {
			const next = waiting.shift();
			if (!next || settled.has(next)) continue;
			const live = open.get(next);
			if (!live || live.data.status !== "queued") continue;
			void launch(next);
			return;
		}
	}

	function locatedExternalSessionId(data: ExternalInvocationEntryData): string | null {
		const root = deps.sessionsDirectory?.(data.agentId) ?? null;
		const adapter = findExternalAgentAdapter(data.agentId);
		if (!root || !adapter) return data.externalSessionId;
		return (
			adapter.locateSessionId({
				sessionsRoot: root,
				cwd: data.cwd,
				startedAt: Date.parse(data.startedAt),
			}) ?? data.externalSessionId
		);
	}

	function release(invocationId: string, externalSessionId: string | null): void {
		const current = lockOf.get(invocationId);
		if (!current) return;
		const agentId = open.get(invocationId)?.data.agentId;
		const pending = `pending\0${invocationId}`;
		const waiters = queues.get(pending) ?? [];
		queues.delete(pending);
		if (externalSessionId && agentId && waiters.length > 0) {
			const next = lockKey(agentId, externalSessionId);
			for (const id of waiters) {
				const live = open.get(id);
				if (!live) continue;
				open.set(id, { ...live, data: { ...live.data, externalSessionId } });
				lockOf.set(id, next);
			}
			queues.set(next, [...(queues.get(next) ?? []), ...waiters]);
			pump(next);
			return;
		}
		if (waiters.length > 0) queues.set(pending, waiters);
		pump(current);
	}

	async function launch(invocationId: string): Promise<void> {
		const current = open.get(invocationId);
		if (!current || settled.has(invocationId)) return;
		const adapter = findExternalAgentAdapter(current.data.agentId);
		if (!adapter) return;
		let data = current.data;
		if (data.status === "queued") {
			data = { ...data, status: "running" };
			open.set(invocationId, { sessionId: current.sessionId, data });
			await append({
				sessionId: current.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: timestamp(),
				data,
			});
		}
		emit({
			type: "running",
			sessionId: current.sessionId,
			invocationId,
			agentId: data.agentId,
			prompt: data.prompt,
			ordinal: data.ordinal,
			externalSessionId: data.externalSessionId,
			startedAt: data.startedAt,
		});
		const paths = referencedPathsOf.get(invocationId) ?? [];
		let process: ExternalInvocationProcess;
		try {
			process = await deps.processes.start({
				file: adapter.executable,
				args: data.externalSessionId
					? adapter.resumeArgs(data.prompt, data.externalSessionId, paths)
					: adapter.singleInstructionArgs(data.prompt, paths),
				cwd: data.cwd,
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const endedAt = timestamp();
			settled.add(invocationId);
			await append({
				sessionId: current.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: endedAt,
				data: {
					...data,
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
				sessionId: current.sessionId,
				invocationId,
				exitCode: null,
				reason,
				discardedBytes: 0,
			});
			release(invocationId, data.externalSessionId);
			return;
		}
		processes.set(invocationId, process);
		notifyRunning();
		const capture = new ExternalInvocationOutputCapture(
			deps.outputLimitBytes ?? EXTERNAL_INVOCATION_OUTPUT_LIMIT_BYTES,
		);
		savedOutput.set(invocationId, {
			sessionId: current.sessionId,
			invocationId,
			head: "",
			tail: "",
			discardedBytes: 0,
		});
		const flush = (): void => {
			const snapshot = capture.snapshot();
			writeFileSync(data.outputPath, snapshot.body);
			const parts = capture.parts();
			writeFileSync(
				`${data.outputPath}.meta.json`,
				JSON.stringify({ discardedBytes: parts.discardedBytes, headBytes: parts.headBytes }),
			);
			savedOutput.set(invocationId, { sessionId: current.sessionId, invocationId, ...parts });
		};
		process.onData((chunk) => {
			capture.push(chunk);
			flush();
			emit({ type: "output", sessionId: current.sessionId, invocationId, chunk });
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
			const externalSessionId = locatedExternalSessionId(data);
			const finished = {
				...data,
				externalSessionId,
				status: failed ? ("failed" as const) : ("completed" as const),
				exitCode: event.exitCode,
				failureReason: failed ? `exit ${event.exitCode ?? "null"}` : null,
				interruptReason: null,
				discardedBytes: snapshot.discardedBytes,
				endedAt,
			};
			open.set(invocationId, { sessionId: current.sessionId, data: finished });
			const publishExit = (): void => {
				if (failed) {
					emit({
						type: "failed",
						sessionId: current.sessionId,
						invocationId,
						exitCode: event.exitCode,
						reason: `exit ${event.exitCode ?? "null"}`,
						discardedBytes: snapshot.discardedBytes,
					});
				} else {
					emit({
						type: "completed",
						sessionId: current.sessionId,
						invocationId,
						exitCode: 0,
						discardedBytes: snapshot.discardedBytes,
						externalSessionId,
						ordinal: data.ordinal,
					});
				}
				release(invocationId, externalSessionId);
			};
			void append({
				sessionId: current.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: endedAt,
				data: finished,
			}).then(publishExit, publishExit);
		});
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
		resize(invocationId, cols, rows) {
			if (cols < 2 || rows < 2) return;
			processes.get(invocationId)?.resize(cols, rows);
		},
		stop(invocationId) {
			const current = open.get(invocationId);
			if (!current || settled.has(invocationId)) return;
			const proc = processes.get(invocationId);
			if (!proc) {
				if (current.data.status !== "queued") return;
				settled.add(invocationId);
				for (const [lock, waiting] of queues)
					queues.set(
						lock,
						waiting.filter((id) => id !== invocationId),
					);
				const endedAt = timestamp();
				const message = INTERRUPT_MESSAGE.cancelled;
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
						interruptReason: "cancelled",
						endedAt,
					},
				});
				emit({
					type: "interrupted",
					sessionId: current.sessionId,
					invocationId,
					agentId: current.data.agentId,
					prompt: current.data.prompt,
					reason: "cancelled",
					message,
				});
				return;
			}
			settled.add(invocationId);
			proc.kill();
			processes.delete(invocationId);
			notifyRunning();
			const endedAt = timestamp();
			const message = INTERRUPT_MESSAGE.user;
			const externalSessionId = locatedExternalSessionId(current.data);
			void append({
				sessionId: current.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: endedAt,
				data: {
					...current.data,
					externalSessionId,
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
			release(invocationId, externalSessionId);
		},
		async deleteSession(sessionId) {
			const locks = new Set<string>();
			const doomed: string[] = [];
			for (const [id, live] of open) {
				if (live.sessionId !== sessionId) continue;
				doomed.push(id);
				const lock = lockOf.get(id);
				if (lock) locks.add(lock);
			}
			for (const id of doomed) {
				settled.add(id);
				const proc = processes.get(id);
				if (proc) {
					proc.kill();
					processes.delete(id);
				}
				open.delete(id);
				lockOf.delete(id);
				referencedPathsOf.delete(id);
				savedOutput.delete(id);
				statusEvents.delete(id);
			}
			for (const [lock, waiting] of queues) {
				const next = waiting.filter((id) => !doomed.includes(id));
				if (next.length > 0) queues.set(lock, next);
				else queues.delete(lock);
			}
			deps.entries.forget(sessionId);
			rmSync(deps.artifactDirectory(sessionId), { recursive: true, force: true });
			notifyRunning();
			for (const lock of locks) pump(lock);
		},
		origins() {
			return rebuildExternalInvocationOrigins(deps.entries.list());
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
				const externalSessionId = locatedExternalSessionId(entry.data);
				await append({
					sessionId: entry.sessionId,
					entryId: deps.ids.next(),
					customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
					timestamp: endedAt,
					data: {
						...entry.data,
						externalSessionId,
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
		recordedDirectoryExists(cwd) {
			return isDirectory(cwd);
		},
		async start(request) {
			const history = request.historyResume;
			const cwd = history?.cwd ?? request.cwd;
			if (isSshProjectUri(cwd) || isSshProjectUri(request.cwd)) {
				throw new Error("Remote projects do not support external invocations");
			}
			if (history && !isDirectory(history.cwd)) {
				throw new Error("External session directory does not exist");
			}
			const adapter = findExternalAgentAdapter(request.agentId);
			if (!adapter) throw new Error(`Unknown external agent: ${request.agentId}`);
			if (adapter.processForm === "interactive" && !request.newSession) {
				for (const [id, live] of open) {
					if (settled.has(id)) continue;
					if (live.sessionId !== request.sessionId || live.data.agentId !== adapter.id) continue;
					if (live.data.status === "running" || live.data.status === "queued") {
						return { invocationId: id };
					}
				}
			}
			const invocationId = deps.ids.next();
			const startedAt = timestamp();
			const directory = deps.artifactDirectory(request.sessionId);
			mkdirSync(directory, { recursive: true });
			const outputPath = join(directory, `${invocationId}.pty`);
			const resumeId = request.newSession
				? null
				: (history?.externalSessionId ??
					request.externalSessionId ??
					latestExternalSessionId(request.sessionId, adapter.id));
			const head = !request.newSession && !resumeId ? pendingHead(request.sessionId, adapter.id) : null;
			const lock = resumeId
				? lockKey(adapter.id, resumeId)
				: head
					? (lockOf.get(head) ?? `pending\0${head}`)
					: `pending\0${invocationId}`;
			const shouldQueue =
				!request.newSession &&
				(Boolean(head) || Boolean(resumeId && (lockBusy(lock) || (queues.get(lock)?.length ?? 0) > 0)));
			const ordinal = ordinalFor(adapter.id, resumeId, head);
			const base = {
				invocationId,
				agentId: adapter.id,
				prompt: request.prompt,
				cwd,
				outputPath,
				startedAt,
				externalSessionId: resumeId,
				ordinal,
			};
			const data: ExternalInvocationEntryData = {
				...base,
				status: shouldQueue ? "queued" : "running",
				exitCode: null,
				failureReason: null,
				interruptReason: null,
				discardedBytes: 0,
				endedAt: null,
			};
			await append({
				sessionId: request.sessionId,
				entryId: deps.ids.next(),
				customType: EXTERNAL_INVOCATION_CUSTOM_TYPE,
				timestamp: startedAt,
				data,
			});
			open.set(invocationId, { sessionId: request.sessionId, data });
			referencedPathsOf.set(invocationId, request.referencedPaths ?? []);
			if (shouldQueue) {
				enqueue(lock, invocationId);
				emit({
					type: "queued",
					sessionId: request.sessionId,
					invocationId,
					agentId: adapter.id,
					prompt: request.prompt,
					ordinal,
					externalSessionId: resumeId,
				});
				return { invocationId };
			}
			lockOf.set(invocationId, lock);

			await launch(invocationId);
			return { invocationId };
		},
	};
}

function isDirectory(cwd: string): boolean {
	try {
		return statSync(cwd).isDirectory();
	} catch {
		return false;
	}
}
