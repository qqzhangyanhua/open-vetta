import {
	activeSessionAtom,
	dispatchBottomPanelAtomFamily,
	openSessionFnRef,
	type SessionInfo,
	sessionDisplayLabel,
	sessionsMapAtom,
} from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { rememberExternalRecipient } from "./external-recipient";

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

/**
 * 续跑绑在当前输入草稿上。人若正看着只读记录或别的页面，要回到这份草稿所在的会话，
 * 否则胶囊画在看不见的输入栏上，点击就像没发生。已经铺满的外部终端先收起，输入栏才能出来。
 */
export function revealExternalHistoryResume(draftKey: string): void {
	const store = getDefaultStore();
	if (!draftKey.startsWith("new:")) {
		store.set(dispatchBottomPanelAtomFamily(draftKey), { type: "set-filled", filled: false });
	}
	const path = rendererPathname();
	if (draftKey.startsWith("new:")) {
		if (path.startsWith("/new-session/")) return;
		const cwd = draftKey.slice("new:".length);
		void import("../../router").then(({ router }) => {
			void router.navigate({ to: "/new-session/$cwd", params: { cwd: encodeURIComponent(cwd) } });
		});
		return;
	}
	const active = store.get(activeSessionAtom);
	if ((path === "/" || path === "") && active?.sessionPath === draftKey) return;
	const session = sessionForPath(store.get(sessionsMapAtom), draftKey);
	if (!session) return;
	void openSessionFnRef.current?.(session.cwd, session.path);
}

function rendererPathname(): string {
	if (typeof window === "undefined") return "/";
	const hash = window.location.hash;
	const raw = hash.startsWith("#") ? hash.slice(1) : "";
	const path = raw.split("?")[0] || "/";
	return path.startsWith("/") ? path : `/${path}`;
}

function sessionForPath(sessions: ReadonlyMap<string, readonly SessionInfo[]>, path: string): SessionInfo | null {
	for (const list of sessions.values()) {
		const found = list.find((item) => item.path === path);
		if (found) return found;
	}
	return null;
}
