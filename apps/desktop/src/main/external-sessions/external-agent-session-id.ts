import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 在 OMP 会话根下找出这次运行写过的会话：目录匹配，且最后活跃时间不早于启动时刻。多个时取最近的一条。 */
export function locateOmpSessionId(input: { sessionsRoot: string; cwd: string; startedAt: number }): string | null {
	const want = normalizePath(input.cwd);
	let best: { id: string; at: number } | null = null;
	for (const session of readOmpSessions(input.sessionsRoot)) {
		if (normalizePath(session.cwd) !== want) continue;
		if (session.lastActiveAt < input.startedAt) continue;
		if (!best || session.lastActiveAt >= best.at) best = { id: session.id, at: session.lastActiveAt };
	}
	return best?.id ?? null;
}

/** 在 cursor-agent 会话根下找出这次运行写过的会话。会话 id 是 `meta.json` 所在目录名。 */
export function locateCursorAgentSessionId(input: {
	sessionsRoot: string;
	cwd: string;
	startedAt: number;
}): string | null {
	const want = normalizePath(input.cwd);
	let best: { id: string; at: number } | null = null;
	for (const session of readCursorSessions(input.sessionsRoot)) {
		if (normalizePath(session.cwd) !== want) continue;
		if (session.lastActiveAt < input.startedAt) continue;
		if (!best || session.lastActiveAt >= best.at) best = { id: session.id, at: session.lastActiveAt };
	}
	return best?.id ?? null;
}

interface LocatedSession {
	readonly id: string;
	readonly cwd: string;
	readonly lastActiveAt: number;
}

function readOmpSessions(root: string): LocatedSession[] {
	const found: LocatedSession[] = [];
	for (const file of jsonlFiles(root, 2)) {
		const session = parseOmpSession(file);
		if (session) found.push(session);
	}
	return found;
}

function jsonlFiles(root: string, depth: number): string[] {
	if (depth < 0) return [];
	let entries: { name: string; isDirectory: boolean; isFile: boolean }[] = [];
	try {
		entries = readdirSync(root, { withFileTypes: true }).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isFile: entry.isFile(),
		}));
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === "subagent-artifacts") continue;
		const path = join(root, entry.name);
		if (entry.isFile && entry.name.endsWith(".jsonl")) files.push(path);
		if (entry.isDirectory) files.push(...jsonlFiles(path, depth - 1));
	}
	return files;
}

function parseOmpSession(path: string): LocatedSession | null {
	let text = "";
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return null;
	}
	let id = "";
	let cwd = "";
	let lastActiveAt = 0;
	let titled = false;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let record: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(line);
			if (typeof parsed !== "object" || parsed === null) continue;
			record = parsed as Record<string, unknown>;
		} catch {
			continue;
		}
		if (record.type === "title") titled = true;
		if (record.type === "title" || record.type === "session") {
			const stamp = readTimestamp(record.type === "title" ? record.updatedAt : record.timestamp);
			if (stamp !== undefined && stamp >= lastActiveAt) lastActiveAt = stamp;
		}
		if (record.type !== "session") continue;
		if (typeof record.id === "string" && record.id.length > 0) id = record.id;
		if (typeof record.cwd === "string") cwd = record.cwd;
		if (typeof record.title === "string" && record.title.length > 0) titled = true;
	}
	if (!id) id = fileId(path);
	if (!titled || !id) return null;
	return { id, cwd, lastActiveAt };
}

function readCursorSessions(root: string): LocatedSession[] {
	const found: LocatedSession[] = [];
	for (const file of metaFiles(root, 2)) {
		const session = parseCursorMeta(file);
		if (session) found.push(session);
	}
	return found;
}

function metaFiles(root: string, depth: number): string[] {
	if (depth < 0) return [];
	let entries: { name: string; isDirectory: boolean; isFile: boolean }[] = [];
	try {
		entries = readdirSync(root, { withFileTypes: true }).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isFile: entry.isFile(),
		}));
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isFile && entry.name === "meta.json") files.push(path);
		if (entry.isDirectory) files.push(...metaFiles(path, depth - 1));
	}
	return files;
}

function parseCursorMeta(path: string): LocatedSession | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		const cwd = typeof record.cwd === "string" ? record.cwd : "";
		const updatedAtMs = typeof record.updatedAtMs === "number" ? record.updatedAtMs : 0;
		const id = parentName(path);
		if (!id) return null;
		return { id, cwd, lastActiveAt: updatedAtMs };
	} catch {
		return null;
	}
}

function fileId(path: string): string {
	const name = path.split(/[/\\]/).pop() ?? "";
	return name.replace(/\.jsonl$/i, "");
}

function parentName(path: string): string {
	const parts = path.split(/[/\\]/);
	return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
}

function readTimestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1000 : value;
	if (typeof value !== "string") return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizePath(path: string): string {
	const slash = path.replace(/\\/g, "/").replace(/\/+$/, "");
	return slash.length === 0 ? "/" : slash;
}
