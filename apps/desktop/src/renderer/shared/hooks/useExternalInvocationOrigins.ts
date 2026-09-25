import { sessionsMapAtom } from "@shared/store/atoms";
import {
	type ExternalInvocationOrigin,
	externalInvocationOrigins,
	replaceExternalInvocationOrigins,
	subscribeExternalInvocationOrigins,
} from "@shared/store/external-invocation-origins";
import { useAtomValue } from "jotai";
import { useEffect, useSyncExternalStore } from "react";

/**
 * 来源表从会话条目重建。会话集合变化，或一次调用结束，就重读一次，
 * 标记和「打开发起它的会话」才会跟着出现或消失。
 */
export function useExternalInvocationOrigins(): readonly ExternalInvocationOrigin[] {
	const rows = useSyncExternalStore(
		subscribeExternalInvocationOrigins,
		externalInvocationOrigins,
		externalInvocationOrigins,
	);
	const knownSessions = sessionPathKey(useAtomValue(sessionsMapAtom));
	// knownSessions 不参与请求，只在会话集合变化时触发重读，标记才会随删除消失。
	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch trigger, not a request input
	useEffect(() => {
		let cancelled = false;
		void reloadExternalInvocationOrigins(() => cancelled);
		return () => {
			cancelled = true;
		};
	}, [knownSessions]);
	return rows;
}

export function reloadExternalInvocationOrigins(stale: () => boolean = () => false): Promise<void> {
	const load = window.vetta?.externalInvocations?.origins;
	if (!load) return Promise.resolve();
	return load()
		.then((rows) => {
			if (!stale()) replaceExternalInvocationOrigins(rows);
		})
		.catch(() => undefined);
}

function sessionPathKey(sessions: ReadonlyMap<string, unknown>): string {
	return [...sessions.keys()].sort().join("\n");
}
