export interface ExternalInvocationOrigin {
	readonly externalSessionId: string;
	readonly sessionId: string;
	readonly invocationId: string;
}

const origins = new Map<string, ExternalInvocationOrigin>();
const listeners = new Set<() => void>();
let snapshot: readonly ExternalInvocationOrigin[] = [];

export function externalInvocationOriginFor(externalSessionId: string): ExternalInvocationOrigin | null {
	return origins.get(externalSessionId) ?? null;
}

export function externalInvocationOrigins(): readonly ExternalInvocationOrigin[] {
	return snapshot;
}

export function replaceExternalInvocationOrigins(next: readonly ExternalInvocationOrigin[]): void {
	origins.clear();
	for (const origin of next) origins.set(origin.externalSessionId, origin);
	snapshot = [...origins.values()];
	for (const listener of listeners) listener();
}

export function subscribeExternalInvocationOrigins(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function clearExternalInvocationOrigins(): void {
	if (origins.size === 0) return;
	origins.clear();
	snapshot = [];
	for (const listener of listeners) listener();
}

/** 已有会话的草稿 key 是会话文件路径；新会话页是 `new:${cwd}`。 */
export function vettaSessionIdFromDraftKey(draftKey: string | null | undefined): string | null {
	if (!draftKey || draftKey.startsWith("new:")) return null;
	const base = draftKey.slice(draftKey.lastIndexOf("/") + 1).replace(/\.jsonl$/i, "");
	return base.length > 0 ? base : null;
}
