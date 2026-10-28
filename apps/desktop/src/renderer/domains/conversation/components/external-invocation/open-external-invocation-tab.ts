import { pathBasename } from "@shared/lib/utils";
import {
	activeSessionAtom,
	bottomPanelStateAtomFamily,
	dispatchBottomPanelAtomFamily,
	type ExternalInvocationPanelPayload,
	findBottomPanelTab,
	pendingSessionOpenAtom,
} from "@shared/store/atoms";
import { atom, getDefaultStore } from "jotai";

export const openExternalInvocationTabAtom = atom(
	null,
	(
		_get,
		set,
		input: {
			readonly scopeKey: string;
			readonly invocationId: string;
			readonly status: ExternalInvocationPanelPayload["status"];
			readonly cwd: string;
			readonly sessionId: string;
			readonly agentLabel?: string;
			readonly externalSessionId?: string | null;
			readonly agentId?: string;
			readonly createIfMissing?: boolean;
		},
	) => {
		set(dispatchBottomPanelAtomFamily(input.scopeKey), {
			type: "open-external-invocation",
			tabId: input.invocationId,
			newLeafId: `leaf-${input.invocationId}`,
			payload: {
				invocationId: input.invocationId,
				status: input.status,
				agentLabel: input.agentLabel ?? "Grok",
				projectLabel: pathBasename(input.cwd),
				sessionId: input.sessionId,
				externalSessionId: input.externalSessionId,
				agentId: input.agentId,
			},
			createIfMissing: input.createIfMissing,
		});
	},
);

/**
 * 发送发生在 ensureSession 之后。发起那次渲染里往往还没有 activeSession，
 * 新会话草稿 key 也不是聊天页底部面板的主键。面板挂在已经落下来的 sessionPath 上。
 */
function liveExternalInvocationTarget(input: {
	readonly workSurfaceKey?: string | null;
	readonly fallbackCwd: string;
}): { readonly scopeKey: string; readonly sessionId: string; readonly cwd: string } | null {
	const store = getDefaultStore();
	const active = store.get(activeSessionAtom);
	const pending = store.get(pendingSessionOpenAtom);
	const scopeKey = input.workSurfaceKey ?? active?.sessionPath ?? pending?.sessionPath ?? null;
	const sessionId = active?.runtimeId ?? null;
	const cwd = active?.cwd || pending?.cwd || input.fallbackCwd;
	if (!scopeKey || !sessionId || cwd.length === 0) return null;
	return { scopeKey, sessionId, cwd };
}

export function openLiveExternalInvocation(input: {
	readonly workSurfaceKey?: string | null;
	readonly fallbackCwd: string;
	readonly invocationId: string;
	readonly status: ExternalInvocationPanelPayload["status"];
	readonly agentLabel?: string;
	readonly externalSessionId?: string | null;
	readonly agentId?: string;
	readonly createIfMissing?: boolean;
}): void {
	const target = liveExternalInvocationTarget(input);
	if (!target) return;
	const store = getDefaultStore();
	const alreadyOpen = findBottomPanelTab(
		store.get(bottomPanelStateAtomFamily(target.scopeKey)).root,
		input.invocationId,
	);
	store.set(openExternalInvocationTabAtom, {
		scopeKey: target.scopeKey,
		sessionId: target.sessionId,
		cwd: target.cwd,
		invocationId: input.invocationId,
		status: input.status,
		agentLabel: input.agentLabel,
		externalSessionId: input.externalSessionId,
		agentId: input.agentId,
		createIfMissing: input.createIfMissing,
	});
	// 新会话落地后面板主键会换，只在旧主键上铺满不会作用到正在看的这一块。
	// 运行中的终端第一次打开时铺满主区；之后的状态更新不再强迫铺满，收起仍然有效。
	if (input.status === "running" && input.createIfMissing !== false && !alreadyOpen) {
		store.set(dispatchBottomPanelAtomFamily(target.scopeKey), { type: "set-filled", filled: true });
	}
}
