import { join } from "node:path";
import { createVersionedJsonConfigStore, type VersionedJsonConfigStoreLogger } from "@vetta/toolkit/config-store";
import { migrateVersionedConfig } from "@vetta/toolkit/versioned-config";
import { GLOBAL_MEMORY_SCHEMA_VERSION } from "../../shared/memory.js";
import { type GlobalMemoryDocument, normalizeGlobalMemoryDocument } from "./schema.js";

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
