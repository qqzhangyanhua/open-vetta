import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import { EXTERNAL_INVOCATION_CUSTOM_TYPE } from "@vetta/runtime-core/conversation";
import { ipcMain } from "electron";
import { detectExternalAgentsOnPath, readLoginShellPath } from "../external-invocation/detect-agents.js";
import { createExternalInvocationEntryLedger } from "../external-invocation/entry-ledger.js";
import { createExternalInvocationService, type ExternalInvocationService } from "../external-invocation/service.js";
import { getSharedRuntime } from "../runtime.js";
import { createLocalPtyBackendFactory } from "../terminal/local-pty-backend.js";

export const EXTERNAL_INVOCATION_CHANNELS = {
	listAgents: "external-invocation:list-agents",
	start: "external-invocation:start",
	event: "external-invocation:event",
	writeInput: "external-invocation:write-input",
	stop: "external-invocation:stop",
	readOutput: "external-invocation:read-output",
	attach: "external-invocation:attach",
	detach: "external-invocation:detach",
	watchRunning: "external-invocation:watch-running",
	running: "external-invocation:running",
} as const;

let service: ExternalInvocationService | undefined;
let ledger: ReturnType<typeof createExternalInvocationEntryLedger> | undefined;

export function externalInvocationService(): ExternalInvocationService {
	if (!service) {
		const processes = createLocalPtyBackendFactory();
		ledger = createExternalInvocationEntryLedger(
			join(getAgentDir(), "external-invocations", "ledger.jsonl"),
			(entry) =>
				getSharedRuntime().appendSessionMetadataEntry(entry.sessionId, EXTERNAL_INVOCATION_CUSTOM_TYPE, entry.data),
		);
		service = createExternalInvocationService({
			processes: {
				async start(options) {
					const backend = await processes.openCommand({
						file: options.file,
						args: options.args,
						cwd: options.cwd,
						cols: 80,
						rows: 24,
					});
					return {
						onData: (listener) => backend.onData(listener),
						onExit: (listener) => backend.onExit((event) => listener({ exitCode: event.exitCode })),
						write: (data) => backend.write(data),
						kill: () => backend.kill(),
					};
				},
			},
			entries: ledger,
			artifactDirectory: (sessionId) => join(getAgentDir(), "external-invocations", sessionId),
			clock: { now: () => Date.now() },
			ids: { next: () => crypto.randomUUID() },
		});
	}
	return service;
}

export function registerExternalInvocationIpc(): () => void {
	const subscriptions = new Map<string, { count: number; unsubscribe: () => void }>();
	const runningWatches = new Map<number, () => void>();
	void externalInvocationService().recover();
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.listAgents, () => {
		return detectExternalAgentsOnPath(readLoginShellPath(), (candidate) => {
			try {
				accessSync(candidate, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		});
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.start, async (_event, request: unknown) => {
		return externalInvocationService().start(parseStart(request));
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.attach, async (event, sessionId: unknown) => {
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			throw new Error("external invocation: sessionId must be a non-empty string");
		}
		const key = `${event.sender.id}:${sessionId}`;
		const existing = subscriptions.get(key);
		if (existing) {
			existing.count += 1;
			await ledger?.retry(sessionId);
			return;
		}
		const invocation = externalInvocationService();
		const unsubscribe = invocation.subscribe(sessionId, (update) => {
			if (!event.sender.isDestroyed()) event.sender.send(EXTERNAL_INVOCATION_CHANNELS.event, update);
		});
		subscriptions.set(key, { count: 1, unsubscribe });
		event.sender.once("destroyed", () => {
			unsubscribe();
			subscriptions.delete(key);
		});
		await ledger?.retry(sessionId);
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.detach, (event, sessionId: unknown) => {
		if (typeof sessionId !== "string" || sessionId.length === 0) return;
		const key = `${event.sender.id}:${sessionId}`;
		const existing = subscriptions.get(key);
		if (!existing) return;
		existing.count -= 1;
		if (existing.count > 0) return;
		existing.unsubscribe();
		subscriptions.delete(key);
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.watchRunning, (event) => {
		const senderId = event.sender.id;
		runningWatches.get(senderId)?.();
		const unsubscribe = externalInvocationService().subscribeRunning((sessionIds) => {
			if (!event.sender.isDestroyed()) event.sender.send(EXTERNAL_INVOCATION_CHANNELS.running, sessionIds);
		});
		runningWatches.set(senderId, unsubscribe);
		event.sender.once("destroyed", () => {
			unsubscribe();
			runningWatches.delete(senderId);
		});
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.writeInput, (_event, invocationId: unknown, data: unknown) => {
		if (typeof invocationId !== "string" || invocationId.length === 0) {
			throw new Error("external invocation: invocationId must be a non-empty string");
		}
		if (typeof data !== "string") throw new Error("external invocation: data must be a string");
		externalInvocationService().writeInput(invocationId, data);
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.stop, (_event, invocationId: unknown) => {
		if (typeof invocationId !== "string" || invocationId.length === 0) {
			throw new Error("external invocation: invocationId must be a non-empty string");
		}
		externalInvocationService().stop(invocationId);
	});
	ipcMain.handle(EXTERNAL_INVOCATION_CHANNELS.readOutput, (_event, sessionId: unknown, invocationId: unknown) => {
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			throw new Error("external invocation: sessionId must be a non-empty string");
		}
		if (typeof invocationId !== "string" || invocationId.length === 0) {
			throw new Error("external invocation: invocationId must be a non-empty string");
		}
		return externalInvocationService().readOutput(sessionId, invocationId);
	});
	return () => {
		for (const subscription of subscriptions.values()) subscription.unsubscribe();
		subscriptions.clear();
		for (const unsubscribe of runningWatches.values()) unsubscribe();
		runningWatches.clear();
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.listAgents);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.start);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.attach);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.detach);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.watchRunning);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.writeInput);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.stop);
		ipcMain.removeHandler(EXTERNAL_INVOCATION_CHANNELS.readOutput);
	};
}

function parseStart(value: unknown): {
	sessionId: string;
	cwd: string;
	prompt: string;
	agentId: string;
	referencedPaths: readonly string[];
} {
	if (typeof value !== "object" || value === null) throw new Error("external invocation: request must be an object");
	const input = value as Record<string, unknown>;
	const sessionId = requireString(input.sessionId, "sessionId");
	const cwd = requireString(input.cwd, "cwd");
	const prompt = requireString(input.prompt, "prompt");
	const agentId = requireString(input.agentId, "agentId");
	const referencedPaths = Array.isArray(input.referencedPaths)
		? input.referencedPaths.filter((path): path is string => typeof path === "string" && path.length > 0)
		: [];
	return { sessionId, cwd, prompt, agentId, referencedPaths };
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`external invocation: ${field} must be a non-empty string`);
	}
	return value;
}
