import { type SessionInfo, sessionDisplayLabel } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { rememberExternalRecipient } from "./external-recipient";
import { activeInputDraftKeyAtom } from "./session-input-draft";

export interface ExternalHistoryResume {
	readonly agentId: string;
	readonly externalSessionId: string;
	readonly title: string;
	readonly cwd: string;
}

const RESUMABLE = new Set<ExternalHistoryResume["agentId"]>(["grok", "omp", "cursor-agent"]);

const bindings = new Map<string, ExternalHistoryResume>();
const listeners = new Set<() => void>();

export function externalHistoryResumeFor(draftKey: string | null | undefined): ExternalHistoryResume | null {
	if (!draftKey) return null;
	return bindings.get(draftKey) ?? null;
}

export function bindExternalHistoryResume(draftKey: string | null | undefined, resume: ExternalHistoryResume): void {
	if (!draftKey) return;
	bindings.set(draftKey, resume);
	rememberExternalRecipient(draftKey, resume.agentId);
	for (const listener of listeners) listener();
}

export function clearExternalHistoryResume(draftKey: string | null | undefined): void {
	if (!draftKey || !bindings.delete(draftKey)) return;
	for (const listener of listeners) listener();
}

export function subscribeExternalHistoryResume(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function clearExternalHistoryResumes(): void {
	bindings.clear();
	for (const listener of listeners) listener();
}

export function historyResumeFromSession(
	session: Pick<SessionInfo, "id" | "cwd" | "name" | "firstMessage" | "origin">,
): ExternalHistoryResume | null {
	const tool = session.origin?.tool;
	if (tool !== "grok" && tool !== "omp" && tool !== "cursor-agent") return null;
	if (!RESUMABLE.has(tool) || session.id.length === 0 || session.cwd.length === 0) return null;
	return {
		agentId: tool,
		externalSessionId: session.id,
		title: sessionDisplayLabel(session),
		cwd: session.cwd,
	};
}

export function currentDraftKey(): string | null {
	return getDefaultStore().get(activeInputDraftKeyAtom);
}
