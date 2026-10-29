import {
	MEMORY_CATEGORIES,
	type MemoryCandidate,
	type MemoryCategory,
	type MemoryScope,
	memoryScopeOf,
} from "../../shared/memory.js";

export interface ParsedMemoryCandidate {
	readonly text: string;
	readonly category: MemoryCategory;
	readonly scope: MemoryScope;
	readonly replacesId?: string;
}

export interface MemoryReference {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
	readonly scope: MemoryScope;
}

// No `g` flag: `RegExp.test` keeps `lastIndex` and would skip every other candidate.
const CREDENTIAL = new RegExp(
	[
		String.raw`(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer|密码|密钥|口令)(?:\s*[:：=是为]\s*|\s+is\s+)\S+`,
		"(?<![A-Za-z0-9])(?:sk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{8,}",
		String.raw`(?<!\d)\d{17}[\dXx](?!\d)`,
		String.raw`(?<!\d)(?:\d[ -]?){16,19}(?!\d)`,
	].join("|"),
	"i",
);

export function containsCredential(text: string): boolean {
	return CREDENTIAL.test(text);
}

const DELETE_ACTIONS = new Set(["delete", "remove", "drop", "forget", "删除", "移除"]);
const UPDATE_ACTIONS = new Set(["update", "replace", "更新", "替换"]);

export function parseMemoryCandidateOutput(
	text: string,
	existing: readonly MemoryReference[] = [],
): ParsedMemoryCandidate[] {
	const trimmed = text.trim();
	if (trimmed.toUpperCase() === "NONE" || trimmed === "[]") return [];
	const jsonText = extractJsonArray(trimmed);
	if (!jsonText) throw new Error("memory:invalid-output");
	let value: unknown;
	try {
		value = JSON.parse(jsonText);
	} catch {
		throw new Error("memory:invalid-output");
	}
	if (!Array.isArray(value)) throw new Error("memory:invalid-output");
	const existingById = new Map(existing.map((entry) => [entry.id, entry]));
	const seenTexts = new Set(existing.map((entry) => entry.text));
	const seenReplaces = new Set<string>();
	const candidates: ParsedMemoryCandidate[] = [];
	for (const item of value) {
		// A delete, or an update that cites a missing id, is dropped. It must not become a new entry.
		const candidate = readItem(item, existingById);
		if (!candidate || containsCredential(candidate.text)) continue;
		if (candidate.replacesId) {
			if (seenReplaces.has(candidate.replacesId)) continue;
			const prior = existingById.get(candidate.replacesId);
			if (
				prior &&
				prior.text === candidate.text &&
				prior.category === candidate.category &&
				prior.scope === candidate.scope
			) {
				continue;
			}
			seenReplaces.add(candidate.replacesId);
		} else if (seenTexts.has(candidate.text)) {
			continue;
		}
		seenTexts.add(candidate.text);
		candidates.push(candidate);
		if (candidates.length >= 50) break;
	}
	return candidates;
}

export function toReviewCandidates(
	parsed: readonly ParsedMemoryCandidate[],
	existing: readonly { readonly id: string; readonly text: string }[],
	createId: () => string,
): MemoryCandidate[] {
	const previousById = new Map(existing.map((entry) => [entry.id, entry.text]));
	const candidates: MemoryCandidate[] = [];
	for (const candidate of parsed) {
		const previousText = candidate.replacesId ? previousById.get(candidate.replacesId) : undefined;
		if (candidate.replacesId && previousText === undefined) continue;
		candidates.push({
			id: createId(),
			text: candidate.text,
			category: candidate.category,
			scope: candidate.scope,
			...(candidate.replacesId && previousText !== undefined
				? { replacesId: candidate.replacesId, previousText }
				: {}),
		});
	}
	return candidates;
}

function readItem(
	value: unknown,
	existingById: ReadonlyMap<string, MemoryReference>,
): ParsedMemoryCandidate | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	if (isDeleteIntent(value)) return undefined;
	const cited = citedReplaceId(value);
	if (cited.present) {
		const prior = cited.id ? existingById.get(cited.id) : undefined;
		return prior ? readUpdate(value, prior) : undefined;
	}
	return readCandidate(value);
}

function readCandidate(value: object): ParsedMemoryCandidate | undefined {
	const text = "text" in value && typeof value.text === "string" ? value.text.trim() : "";
	const category = "category" in value && typeof value.category === "string" ? value.category : "";
	if (!text || text.length > 2_000 || !isCategory(category)) return undefined;
	const scope = memoryScopeOf("scope" in value && typeof value.scope === "string" ? { scope: value.scope } : {});
	return { text, category, scope };
}

function readUpdate(value: object, existing: MemoryReference): ParsedMemoryCandidate | undefined {
	const text = "text" in value && typeof value.text === "string" ? value.text.trim() : "";
	if (!text || text.length > 2_000) return undefined;
	const category =
		"category" in value && typeof value.category === "string" && value.category ? value.category : existing.category;
	if (!isCategory(category)) return undefined;
	const scope =
		"scope" in value && typeof value.scope === "string" ? memoryScopeOf({ scope: value.scope }) : existing.scope;
	return { text, category, scope, replacesId: existing.id };
}

function isDeleteIntent(value: object): boolean {
	const action = actionOf(value);
	if (action && DELETE_ACTIONS.has(action)) return true;
	if ("delete" in value && value.delete === true) return true;
	if ("remove" in value && value.remove === true) return true;
	return false;
}

function citedReplaceId(value: object): { readonly present: boolean; readonly id?: string } {
	const action = actionOf(value);
	const update = action !== undefined && UPDATE_ACTIONS.has(action);
	const replaces = "replaces" in value ? value.replaces : "replacesId" in value ? value.replacesId : undefined;
	if (replaces === undefined && !update) return { present: false };
	if (typeof replaces === "string" && replaces.trim()) return { present: true, id: replaces.trim() };
	if (update && "id" in value && typeof value.id === "string" && value.id.trim()) {
		return { present: true, id: value.id.trim() };
	}
	return { present: true };
}

function actionOf(value: object): string | undefined {
	if ("action" in value && typeof value.action === "string") return value.action.trim().toLowerCase();
	if ("op" in value && typeof value.op === "string") return value.op.trim().toLowerCase();
	if ("operation" in value && typeof value.operation === "string") return value.operation.trim().toLowerCase();
	if ("kind" in value && typeof value.kind === "string") return value.kind.trim().toLowerCase();
	if ("type" in value && typeof value.type === "string") return value.type.trim().toLowerCase();
	return undefined;
}

function isCategory(value: string): value is MemoryCategory {
	return (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

function extractJsonArray(text: string): string | null {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const source = (fenced?.[1] ?? text).trim();
	if (source.startsWith("[")) return source;
	const start = source.indexOf("[");
	const end = source.lastIndexOf("]");
	if (start < 0 || end <= start) return null;
	return source.slice(start, end + 1);
}
