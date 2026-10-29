import { MEMORY_CATEGORIES, type MemoryCategory, type MemoryScope, memoryScopeOf } from "../../shared/memory.js";

export interface ParsedMemoryCandidate {
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

export function parseMemoryCandidateOutput(text: string): ParsedMemoryCandidate[] {
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
	const seen = new Set<string>();
	const candidates: ParsedMemoryCandidate[] = [];
	for (const item of value) {
		const candidate = readCandidate(item);
		if (!candidate || containsCredential(candidate.text) || seen.has(candidate.text)) continue;
		seen.add(candidate.text);
		candidates.push(candidate);
		if (candidates.length >= 50) break;
	}
	return candidates;
}

function readCandidate(value: unknown): ParsedMemoryCandidate | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const text = "text" in value && typeof value.text === "string" ? value.text.trim() : "";
	const category = "category" in value && typeof value.category === "string" ? value.category : "";
	if (!text || text.length > 2_000 || !isCategory(category)) return undefined;
	const scope = memoryScopeOf("scope" in value && typeof value.scope === "string" ? { scope: value.scope } : {});
	return { text, category, scope };
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
