import { readFile } from "node:fs/promises";
import type { VersionedJsonConfigStoreLogger } from "@vetta/toolkit/config-store";
import {
	type GenerateGlobalMemoryResult,
	type GlobalMemoryEntry,
	type MemoryModelChoice,
	type MemoryScope,
	memoryScopeOf,
	type ProjectMemoryProject,
	type SaveMemoryCandidate,
} from "../../shared/memory.js";
import { DEFAULT_CONVERSATION_CWD } from "../config/desktop-config-store.js";
import { containsCredential, parseMemoryCandidateOutput, toReviewCandidates } from "./parse.js";
import { memoryProjectPath } from "./project-path.js";
import { buildMemoryCandidateUserPrompt, MEMORY_CANDIDATE_SYSTEM_PROMPT } from "./prompt.js";
import {
	type GlobalMemoryDocument,
	isGlobalMemoryReadEnabled,
	isProjectMemoryReadEnabled,
	MEMORY_GENERATION_CURSOR_LIMIT,
	MEMORY_GENERATION_SCHEMA_VERSION,
	type MemoryGenerationDocument,
	memoryGenerationCursors,
	type ProjectMemoryDocument,
	parseMemoryModelOverride,
	parseSaveMemoryCandidates,
	projectMemoryKindOf,
} from "./schema.js";
import {
	classifyMemorySaveCandidates,
	commitScopedMemorySave,
	mergeReviewedGlobalEntries,
	replacementsNeedProjectFile,
	resolveMemoryReplacements,
	touchesProjectMemory,
} from "./scoped-save.js";
import { readProjectEntriesForGeneration } from "./session-read.js";
import {
	createGlobalMemoryStore,
	createMemoryGenerationStore,
	createProjectMemoryStore,
	memoryGenerationFilePath,
} from "./store.js";
import { entriesAfterCursor, formatLocalDate, type MemoryTranscriptEntry } from "./transcript.js";

export interface MemoryModelRequest {
	readonly modelKey: string;
	readonly system: string;
	readonly user: string;
	readonly signal: AbortSignal;
}

export interface MemorySessionSource {
	readonly modelKey: string;
	readonly entries: readonly MemoryTranscriptEntry[];
	readonly cwd: string;
}

export interface DesktopMemoryServiceDependencies {
	readonly directory: string;
	readonly now: () => Date;
	readonly createId: () => string;
	readonly source: (runtimeId: string) => MemorySessionSource;
	readonly complete: (request: MemoryModelRequest) => Promise<string>;
	readonly listModels: () => readonly MemoryModelChoice[];
	readonly logger?: VersionedJsonConfigStoreLogger;
}

/** End entry of one generate. Save commits this object, not a later pending slot. */
interface MemoryPendingCursor {
	readonly runtimeId: string;
	readonly entryId: string;
	readonly projectPath: string;
}

export class DesktopMemoryService {
	private readonly store: ReturnType<typeof createGlobalMemoryStore>;
	private readonly projectStore: ReturnType<typeof createProjectMemoryStore>;
	private readonly generationStore: ReturnType<typeof createMemoryGenerationStore>;
	private mutationQueue: Promise<unknown> = Promise.resolve();
	private generationTicket = 0;
	private generationWrite: Promise<unknown> = Promise.resolve();
	/** Latest candidate-producing generate. No-id saves still use this slot. */
	private pendingCursor: MemoryPendingCursor | null = null;
	private readonly cursorsByCandidateId = new Map<string, MemoryPendingCursor>();
	/** Entries already in global.json whose cursor write has not succeeded. */
	private readonly savedCandidates = new Map<string, SavedCandidateRecord>();

	constructor(private readonly dependencies: DesktopMemoryServiceDependencies) {
		this.store = createGlobalMemoryStore(dependencies.directory, dependencies.logger);
		this.projectStore = createProjectMemoryStore(dependencies.directory, dependencies.logger);
		this.generationStore = createMemoryGenerationStore(dependencies.directory, dependencies.logger);
	}

	/** 开关和保存会交错读改写同一文件。轮到自己再读，避免用排队前的快照盖掉后一次结果。 */
	private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutationQueue.then(operation, operation);
		this.mutationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async listGlobal(): Promise<GlobalMemoryEntry[]> {
		return [...(await this.readDocument()).entries];
	}

	async listProjects(): Promise<ProjectMemoryProject[]> {
		const document = await this.readProjectDocument();
		return document.projects
			.filter((project) => project.entries.length > 0)
			.map((project) => ({
				path: project.path,
				kind: projectMemoryKindOf(project.path, DEFAULT_CONVERSATION_CWD),
				entries: [...project.entries],
			}));
	}

	async getProjectReadEnabled(): Promise<boolean> {
		return isProjectMemoryReadEnabled(await this.readProjectDocument());
	}

	async setProjectReadEnabled(enabled: boolean): Promise<boolean> {
		return this.enqueueMutation(async () => {
			const document = await this.readProjectDocument();
			if ((document.projectEnabled ?? true) === enabled) return enabled;
			await this.projectStore.write({
				schemaVersion: document.schemaVersion,
				projects: document.projects,
				projectEnabled: enabled,
			});
			return enabled;
		});
	}

	async getReadEnabled(): Promise<boolean> {
		return isGlobalMemoryReadEnabled(await this.readDocument());
	}

	async setReadEnabled(enabled: boolean): Promise<boolean> {
		return this.enqueueMutation(async () => {
			const document = await this.readDocument();
			if ((document.globalEnabled ?? true) === enabled) return enabled;
			await this.store.write({
				schemaVersion: document.schemaVersion,
				entries: document.entries,
				globalEnabled: enabled,
			});
			return enabled;
		});
	}

	async listModels(): Promise<readonly MemoryModelChoice[]> {
		return this.dependencies.listModels();
	}

	async getModelOverride(): Promise<string | null> {
		return (await this.readGeneration()).modelKey ?? null;
	}

	async setModelOverride(modelKey: unknown): Promise<void> {
		const parsed = parseMemoryModelOverride(modelKey);
		if (parsed !== null && !this.dependencies.listModels().some((model) => model.modelKey === parsed)) {
			throw new Error("memory:invalid-model");
		}
		await this.updateGeneration(
			(current) => ({
				schemaVersion: current.schemaVersion,
				cursors: current.cursors,
				...(parsed ? { modelKey: parsed } : {}),
			}),
			true,
		);
	}

	async generate(runtimeId: string): Promise<GenerateGlobalMemoryResult> {
		const ticket = ++this.generationTicket;
		const document = await this.readDocument();
		const generation = await this.readGeneration();
		const source = this.dependencies.source(runtimeId);
		const projectPath = memoryProjectPath(source.cwd);
		const projectEntries = await readProjectEntriesForGeneration(this.dependencies.directory, projectPath);
		const modelKey = generation.modelKey ?? source.modelKey;
		if (!modelKey.trim()) throw new Error("memory:model-unavailable");
		const slice = entriesAfterCursor(
			source.entries,
			generation.cursors.find((cursor) => cursor.runtimeId === runtimeId)?.entryId,
		);
		const transcript = slice.map((entry) => entry.text).join("\n\n");
		if (!transcript.trim()) return { status: "empty" };
		const existing = [
			...document.entries.map((entry) => ({
				id: entry.id,
				text: entry.text,
				category: entry.category,
				scope: "global" as const,
			})),
			...(projectEntries ?? []).map((entry) => ({
				id: entry.id,
				text: entry.text,
				category: entry.category,
				scope: "project" as const,
			})),
		];
		let text: string;
		try {
			text = await this.dependencies.complete({
				modelKey,
				system: MEMORY_CANDIDATE_SYSTEM_PROMPT,
				user: buildMemoryCandidateUserPrompt({ transcript, existing }),
				signal: AbortSignal.timeout(120_000),
			});
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("memory:")) throw error;
			throw new Error("memory:generation-failed");
		}
		const parsed = parseMemoryCandidateOutput(text, existing);
		const candidates = toReviewCandidates(parsed, existing, () => this.dependencies.createId());
		if (candidates.length === 0) return { status: "empty" };
		const last = slice.at(-1);
		if (last) {
			const cursor = { runtimeId, entryId: last.id, projectPath };
			for (const candidate of candidates) this.cursorsByCandidateId.set(candidate.id, cursor);
			if (ticket === this.generationTicket) this.pendingCursor = cursor;
		}
		return { status: "candidates", candidates };
	}

	async save(candidates: readonly SaveMemoryCandidate[] | unknown): Promise<GlobalMemoryEntry[]> {
		const parsed = parseSaveMemoryCandidates(candidates);
		const cursor = this.cursorFor(parsed);
		// 先占 global.json，游标写入再占 generation.json，避免两把锁交叉。
		return this.enqueueMutation(async () => {
			const document = await this.readDocument();
			if (this.omitsSaved(parsed, cursor)) throw new Error("memory:invalid-candidates");
			if (parsed.length === 0) {
				if (this.pendingCursor === cursor) this.pendingCursor = null;
				return [...document.entries];
			}
			if (parsed.some((candidate) => containsCredential(candidate.text))) {
				throw new Error("memory:invalid-candidates");
			}
			const { additions, updates, replacements } = classifyMemorySaveCandidates(parsed, this.savedCandidates);
			const globalIds = new Set(document.entries.map((entry) => entry.id));
			const savedScope = (candidate: SaveMemoryCandidate) =>
				candidate.id ? this.savedCandidates.get(candidate.id)?.scope : undefined;
			const projectPath = cursor?.projectPath;
			let resolved = replacements;
			let projectDocument: ProjectMemoryDocument | undefined;
			if (replacementsNeedProjectFile(replacements, globalIds)) {
				if (projectPath) {
					projectDocument = await this.readProjectDocument();
					const projectIds = new Set(
						projectDocument.projects
							.find((project) => project.path === projectPath)
							?.entries.map((entry) => entry.id) ?? [],
					);
					resolved = resolveMemoryReplacements({ replacements, globalIds, projectIds });
				} else resolved = resolveMemoryReplacements({ replacements, globalIds, projectIds: null });
			}
			if (additions.length === 0 && updates.size === 0 && resolved.size === 0) {
				await this.commitCursor(cursor);
				this.forgetSaved(parsed);
				return [...document.entries];
			}
			if (
				touchesProjectMemory(additions, updates, parsed, savedScope) ||
				replacementsNeedProjectFile(resolved, globalIds)
			) {
				if (!projectPath) throw new Error("memory:invalid-candidates");
				projectDocument ??= await this.readProjectDocument();
				const savedScopeByEntryId = new Map<string, MemoryScope>();
				for (const saved of this.savedCandidates.values()) {
					if (saved.cursor === cursor) savedScopeByEntryId.set(saved.entryId, saved.scope);
				}
				return commitScopedMemorySave({
					document,
					projectDocument,
					additions,
					updates,
					replacements: resolved,
					savedScopeByEntryId,
					projectPath,
					recordedAt: formatLocalDate(this.dependencies.now()),
					createId: () => this.dependencies.createId(),
					writeGlobal: (next) => this.store.write(next),
					writeProject: (next) => this.projectStore.write(next),
					remember: (savedAdditions, added) => this.rememberSaved(savedAdditions, added, parsed, cursor),
					commitCursor: () => this.commitCursor(cursor),
					forget: () => this.forgetSaved(parsed),
				});
			}
			if ([...updates.keys()].some((entryId) => !globalIds.has(entryId))) {
				throw new Error("memory:store-rejected");
			}
			const recordedAt = formatLocalDate(this.dependencies.now());
			const merged = mergeReviewedGlobalEntries({
				entries: document.entries,
				additions,
				updates,
				replacements: resolved,
				recordedAt,
				createId: () => this.dependencies.createId(),
			});
			const next: GlobalMemoryDocument = {
				schemaVersion: document.schemaVersion,
				entries: merged.entries,
				...(document.globalEnabled === undefined ? {} : { globalEnabled: document.globalEnabled }),
			};
			await this.store.write(next);
			this.rememberSaved(
				[...additions, ...merged.replaced.map((item) => item.candidate)],
				[...merged.added, ...merged.replaced.map((item) => item.entry)],
				parsed,
				cursor,
			);
			await this.commitCursor(cursor);
			this.forgetSaved(parsed);
			return [...next.entries];
		});
	}

	/** A retry that drops an already written candidate must not succeed as if it was not saved. */
	private omitsSaved(parsed: readonly SaveMemoryCandidate[], cursor: MemoryPendingCursor | null): boolean {
		for (const [id, saved] of this.savedCandidates) {
			if (saved.cursor !== cursor) continue;
			if (!parsed.some((candidate) => candidate.id === id)) return true;
		}
		return false;
	}

	private rememberSaved(
		additions: readonly SaveMemoryCandidate[],
		added: readonly GlobalMemoryEntry[],
		parsed: readonly SaveMemoryCandidate[],
		cursor: MemoryPendingCursor | null,
	): void {
		additions.forEach((candidate, index) => {
			const entry = added[index];
			if (!candidate.id || !entry) return;
			this.savedCandidates.set(candidate.id, {
				entryId: entry.id,
				text: candidate.text,
				category: candidate.category,
				scope: memoryScopeOf(candidate),
				cursor,
			});
		});
		for (const candidate of parsed) {
			const id = candidate.id;
			if (!id) continue;
			const saved = this.savedCandidates.get(id);
			if (
				!saved ||
				(saved.text === candidate.text &&
					saved.category === candidate.category &&
					saved.scope === memoryScopeOf(candidate))
			) {
				continue;
			}
			this.savedCandidates.set(id, {
				entryId: saved.entryId,
				text: candidate.text,
				category: candidate.category,
				scope: memoryScopeOf(candidate),
				cursor: saved.cursor,
			});
		}
	}

	private cursorFor(parsed: readonly SaveMemoryCandidate[]): MemoryPendingCursor | null {
		for (const candidate of parsed) {
			if (!candidate.id) continue;
			const found = this.cursorsByCandidateId.get(candidate.id);
			if (found) return found;
		}
		if (parsed.some((candidate) => candidate.id)) return null;
		return this.pendingCursor;
	}

	private forgetSaved(parsed: readonly SaveMemoryCandidate[]): void {
		for (const candidate of parsed) {
			if (candidate.id) this.savedCandidates.delete(candidate.id);
		}
	}

	private async commitCursor(cursor: MemoryPendingCursor | null): Promise<void> {
		if (!cursor) return;
		await this.updateGeneration((current) => {
			const cursors = [
				...current.cursors.filter((item) => item.runtimeId !== cursor.runtimeId),
				{ runtimeId: cursor.runtimeId, entryId: cursor.entryId },
			];
			// Past the schema ceiling, drop the oldest so this save still records its boundary.
			const capped =
				cursors.length > MEMORY_GENERATION_CURSOR_LIMIT
					? cursors.slice(cursors.length - MEMORY_GENERATION_CURSOR_LIMIT)
					: cursors;
			return {
				schemaVersion: current.schemaVersion,
				...(current.modelKey ? { modelKey: current.modelKey } : {}),
				cursors: capped,
			};
		});
		if (this.pendingCursor === cursor) this.pendingCursor = null;
		for (const [id, value] of [...this.cursorsByCandidateId]) {
			if (value === cursor) this.cursorsByCandidateId.delete(id);
		}
	}

	private async updateGeneration(
		update: (current: MemoryGenerationDocument) => MemoryGenerationDocument,
		recoverInvalidModel = false,
	): Promise<void> {
		const run = this.generationWrite.then(async () => {
			const current = await this.readGenerationForUpdate(recoverInvalidModel);
			await this.generationStore.write(update(current));
		});
		// A failed write must not wedge the next one. Callers still observe this attempt's error.
		this.generationWrite = run.then(
			() => undefined,
			() => undefined,
		);
		await run;
	}

	private async readGenerationForUpdate(recoverInvalidModel: boolean): Promise<MemoryGenerationDocument> {
		try {
			return await this.readGeneration();
		} catch (error) {
			if (!recoverInvalidModel || !(error instanceof Error) || error.message !== "memory:invalid-model") {
				throw error;
			}
		}
		return this.readGenerationCursorsOnly();
	}

	/** Keeps cursors when the stored model key is illegal. The bad key is not returned. */
	private async readGenerationCursorsOnly(): Promise<MemoryGenerationDocument> {
		let raw: string;
		try {
			raw = await readFile(memoryGenerationFilePath(this.dependencies.directory), "utf8");
		} catch {
			throw new Error("memory:store-rejected");
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error("memory:store-rejected");
		}
		return {
			schemaVersion: MEMORY_GENERATION_SCHEMA_VERSION,
			cursors: memoryGenerationCursors(parsed),
		};
	}

	/** A corrupt project file leaves global generation usable. Project facts are omitted. */
	private async readProjectDocument(): Promise<ProjectMemoryDocument> {
		try {
			return await this.projectStore.read();
		} catch (error) {
			if (error instanceof Error && error.message === "memory:store-rejected") throw error;
			throw new Error("memory:store-rejected");
		}
	}

	private async readDocument(): Promise<GlobalMemoryDocument> {
		try {
			return await this.store.read();
		} catch (error) {
			if (error instanceof Error && error.message === "memory:store-rejected") throw error;
			throw new Error("memory:store-rejected");
		}
	}

	private async readGeneration(): Promise<MemoryGenerationDocument> {
		try {
			return await this.generationStore.read();
		} catch (error) {
			if (
				error instanceof Error &&
				(error.message === "memory:invalid-model" || error.message === "memory:store-rejected")
			) {
				throw error;
			}
			throw new Error("memory:store-rejected");
		}
	}
}

interface SavedCandidateRecord {
	readonly entryId: string;
	readonly text: string;
	readonly category: SaveMemoryCandidate["category"];
	readonly scope: MemoryScope;
	readonly cursor: MemoryPendingCursor | null;
}
