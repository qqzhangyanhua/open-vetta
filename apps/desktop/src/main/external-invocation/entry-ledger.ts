import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExternalInvocationEntry, ExternalInvocationEntryStore } from "./service.js";

export function createExternalInvocationEntryLedger(
	file: string,
	persist: (entry: ExternalInvocationEntry) => Promise<void> | void,
): ExternalInvocationEntryStore & { retry(sessionId: string): Promise<void> } {
	const pending: ExternalInvocationEntry[] = [];

	function read(): ExternalInvocationEntry[] {
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8")
			.split("\n")
			.filter((line) => line.length > 0)
			.flatMap((line) => {
				try {
					return [JSON.parse(line) as ExternalInvocationEntry];
				} catch {
					return [];
				}
			});
	}

	return {
		list: read,
		forget(sessionId) {
			const kept = read().filter((entry) => entry.sessionId !== sessionId);
			if (!existsSync(file) && kept.length === 0) return;
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, kept.length === 0 ? "" : `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		},
		async append(entry) {
			mkdirSync(dirname(file), { recursive: true });
			appendFileSync(file, `${JSON.stringify(entry)}\n`);
			try {
				await persist(entry);
			} catch {
				pending.push(entry);
			}
		},
		async retry(sessionId) {
			const mine = pending.filter((entry) => entry.sessionId === sessionId);
			if (mine.length === 0) return;
			const rest = pending.filter((entry) => entry.sessionId !== sessionId);
			pending.length = 0;
			pending.push(...rest);
			for (const entry of mine) {
				try {
					await persist(entry);
				} catch {
					pending.push(entry);
				}
			}
		},
	};
}
