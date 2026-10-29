import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createVersionedJsonConfigStore, type VersionedJsonConfigStoreLogger } from "@vetta/toolkit/config-store";
import { migrateVersionedConfig } from "@vetta/toolkit/versioned-config";
import { GLOBAL_MEMORY_SCHEMA_VERSION, PROJECT_MEMORY_SCHEMA_VERSION } from "../../shared/memory.js";
import {
	type GlobalMemoryDocument,
	MEMORY_GENERATION_SCHEMA_VERSION,
	type MemoryGenerationDocument,
	memoryGenerationCursors,
	normalizeGlobalMemoryDocument,
	normalizeMemoryGenerationDocument,
	normalizeProjectMemoryDocument,
	type ProjectMemoryDocument,
} from "./schema.js";

export function globalMemoryFilePath(directory: string): string {
	return join(directory, "global.json");
}

export function migrateGlobalMemoryDocument(value: unknown) {
	return migrateVersionedConfig(value, {
		currentVersion: GLOBAL_MEMORY_SCHEMA_VERSION,
		migrations: [],
	});
}

export function createGlobalMemoryStore(directory: string, logger?: VersionedJsonConfigStoreLogger) {
	return createVersionedJsonConfigStore<GlobalMemoryDocument>({
		path: globalMemoryFilePath(directory),
		name: "global-memory",
		normalize: normalizeGlobalMemoryDocument,
		migrate: migrateGlobalMemoryDocument,
		readErrorPolicy: "throw",
		logger,
	});
}

export function projectMemoryFilePath(directory: string): string {
	return join(directory, "projects.json");
}

export function migrateProjectMemoryDocument(value: unknown) {
	return migrateVersionedConfig(value, {
		currentVersion: PROJECT_MEMORY_SCHEMA_VERSION,
		migrations: [],
	});
}

export function createProjectMemoryStore(directory: string, logger?: VersionedJsonConfigStoreLogger) {
	return createVersionedJsonConfigStore<ProjectMemoryDocument>({
		path: projectMemoryFilePath(directory),
		name: "project-memory",
		normalize: normalizeProjectMemoryDocument,
		migrate: migrateProjectMemoryDocument,
		readErrorPolicy: "throw",
		logger,
	});
}

export function memoryGenerationFilePath(directory: string): string {
	return join(directory, "generation.json");
}

export function migrateMemoryGenerationDocument(value: unknown) {
	return migrateVersionedConfig(value, {
		currentVersion: MEMORY_GENERATION_SCHEMA_VERSION,
		migrations: [],
	});
}

/** Keeps cursors when the stored model key is illegal. The bad key is not returned. */
export async function readMemoryGenerationCursorsIgnoringInvalidModel(
	directory: string,
): Promise<MemoryGenerationDocument> {
	let raw: string;
	try {
		raw = await readFile(memoryGenerationFilePath(directory), "utf8");
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

export function createMemoryGenerationStore(directory: string, logger?: VersionedJsonConfigStoreLogger) {
	return createVersionedJsonConfigStore<MemoryGenerationDocument>({
		path: memoryGenerationFilePath(directory),
		name: "memory-generation",
		normalize: normalizeMemoryGenerationDocument,
		migrate: migrateMemoryGenerationDocument,
		readErrorPolicy: "throw",
		logger,
	});
}
