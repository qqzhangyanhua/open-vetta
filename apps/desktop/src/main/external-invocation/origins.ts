export interface ExternalInvocationOrigin {
	readonly externalSessionId: string;
	readonly sessionId: string;
	readonly invocationId: string;
}

interface OriginEntry {
	readonly sessionId: string;
	readonly data: {
		readonly invocationId: string;
		readonly externalSessionId: string | null;
	};
}

/**
 * 发起关系只认「开始时还不知道外部会话 id、结束时才写上」的那一次调用。
 * 从历史续跑或追问一开始就带着 id，不能在发起会话被删掉后顶上。
 */
export function rebuildExternalInvocationOrigins(entries: readonly OriginEntry[]): readonly ExternalInvocationOrigin[] {
	const grouped = new Map<string, OriginEntry[]>();
	for (const entry of entries) {
		const group = grouped.get(entry.data.invocationId) ?? [];
		group.push(entry);
		grouped.set(entry.data.invocationId, group);
	}
	const origins = new Map<string, ExternalInvocationOrigin>();
	for (const entry of entries) {
		const group = grouped.get(entry.data.invocationId);
		if (!group || group.at(-1) !== entry) continue;
		const externalSessionId = entry.data.externalSessionId;
		if (!externalSessionId || origins.has(externalSessionId)) continue;
		const earlier = group.slice(0, -1);
		if (earlier.length === 0) continue;
		if (earlier.some((item) => item.data.externalSessionId === externalSessionId)) continue;
		origins.set(externalSessionId, {
			externalSessionId,
			sessionId: entry.sessionId,
			invocationId: entry.data.invocationId,
		});
	}
	return [...origins.values()];
}
