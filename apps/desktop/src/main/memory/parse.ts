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
	readonly previousText?: string;
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
			// The update wins: an earlier new fact with the same text would save a second row.
			for (let index = candidates.length - 1; index >= 0; index -= 1) {
				const earlier = candidates[index];
				if (earlier && !earlier.replacesId && earlier.text === candidate.text) candidates.splice(index, 1);
			}
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
	createId: () => string,
): MemoryCandidate[] {
	return parsed.map((candidate) => ({
		id: createId(),
		text: candidate.text,
		category: candidate.category,
		scope: candidate.scope,
		...(candidate.replacesId === undefined
			? {}
			: { replacesId: candidate.replacesId, previousText: candidate.previousText }),
	}));
}

function readItem(
	value: unknown,
	existingById: ReadonlyMap<string, MemoryReference>,
): ParsedMemoryCandidate | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const replaces = replacesIdOf(value);
	if (replaces !== undefined) {
		const prior = existingById.get(replaces);
		return prior ? readUpdate(value, prior) : undefined;
	}
	// An action without a replaces citation is not a new fact.
	if (nonEmptyAction(value)) return undefined;
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
	const rawScope = "scope" in value && typeof value.scope === "string" ? value.scope.trim() : "";
	const scope = rawScope === "global" || rawScope === "project" ? rawScope : existing.scope;
	return { text, category, scope, replacesId: existing.id, previousText: existing.text };
}

/** Blank or null `replaces` is not a citation. */
function replacesIdOf(value: object): string | undefined {
	if (!("replaces" in value) || typeof value.replaces !== "string") return undefined;
	const id = value.replaces.trim();
	return id || undefined;
}

function nonEmptyAction(value: object): boolean {
	if ("action" in value && typeof value.action === "string" && value.action.trim() !== "") return true;
	if ("op" in value && typeof value.op === "string" && value.op.trim() !== "") return true;
	return false;
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
