import type { VersionedJsonConfigStoreLogger } from "@vetta/toolkit/config-store";
import type {
	GenerateGlobalMemoryResult,
	GlobalMemoryEntry,
	MemoryCandidate,
	SaveMemoryCandidate,
} from "../../shared/memory.js";
import { containsCredential, parseMemoryCandidateOutput } from "./parse.js";
import { buildMemoryCandidateUserPrompt, MEMORY_CANDIDATE_SYSTEM_PROMPT } from "./prompt.js";
import { type GlobalMemoryDocument, parseSaveMemoryCandidates } from "./schema.js";
import { createGlobalMemoryStore } from "./store.js";

export interface MemoryModelRequest {
	readonly modelKey: string;
	readonly system: string;
	readonly user: string;
	readonly signal: AbortSignal;
}

export interface MemorySessionSource {
	readonly modelKey: string;
	readonly transcript: string;
}

export interface DesktopMemoryServiceDependencies {
	readonly directory: string;
	readonly now: () => Date;
	readonly createId: () => string;
	readonly source: (runtimeId: string) => MemorySessionSource;
	readonly complete: (request: MemoryModelRequest) => Promise<string>;
	readonly logger?: VersionedJsonConfigStoreLogger;
}

export class DesktopMemoryService {
	private readonly store: ReturnType<typeof createGlobalMemoryStore>;

	constructor(private readonly dependencies: DesktopMemoryServiceDependencies) {
		this.store = createGlobalMemoryStore(dependencies.directory, dependencies.logger);
	}

	async listGlobal(): Promise<GlobalMemoryEntry[]> {
		return [...(await this.readDocument()).entries];
	}

	async generate(runtimeId: string): Promise<GenerateGlobalMemoryResult> {
		const document = await this.readDocument();
		const source = this.dependencies.source(runtimeId);
		if (!source.modelKey.trim()) throw new Error("memory:model-unavailable");
		if (!source.transcript.trim()) return { status: "empty" };
		let text: string;
		try {
			text = await this.dependencies.complete({
				modelKey: source.modelKey,
				system: MEMORY_CANDIDATE_SYSTEM_PROMPT,
				user: buildMemoryCandidateUserPrompt({
					transcript: source.transcript,
					existing: document.entries.map((entry) => ({ text: entry.text, category: entry.category })),
				}),
				signal: AbortSignal.timeout(120_000),
			});
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("memory:")) throw error;
			throw new Error("memory:generation-failed");
		}
		const parsed = parseMemoryCandidateOutput(text);
		if (parsed.length === 0) return { status: "empty" };
		const candidates: MemoryCandidate[] = parsed.map((candidate) => ({
			id: this.dependencies.createId(),
			text: candidate.text,
			category: candidate.category,
		}));
		return { status: "candidates", candidates };
	}

	async save(candidates: readonly SaveMemoryCandidate[] | unknown): Promise<GlobalMemoryEntry[]> {
		const parsed = parseSaveMemoryCandidates(candidates);
		const document = await this.readDocument();
		if (parsed.length === 0) return [...document.entries];
		if (parsed.some((candidate) => containsCredential(candidate.text))) {
			throw new Error("memory:invalid-candidates");
		}
		const recordedAt = formatLocalDate(this.dependencies.now());
		const added: GlobalMemoryEntry[] = parsed.map((candidate) => ({
			id: this.dependencies.createId(),
			text: candidate.text,
			category: candidate.category,
			recordedAt,
		}));
		const next: GlobalMemoryDocument = {
			schemaVersion: document.schemaVersion,
			entries: [...document.entries, ...added],
		};
		await this.store.write(next);
		return [...next.entries];
	}

	private async readDocument(): Promise<GlobalMemoryDocument> {
		try {
			return await this.store.read();
		} catch (error) {
			if (error instanceof Error && error.message === "memory:store-rejected") throw error;
			throw new Error("memory:store-rejected");
		}
	}
}

function formatLocalDate(now: Date): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
