import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type ExternalSessionToolId,
	findGrokSummaryHeader,
	GROK_SUMMARY_SIDECAR_NAME,
	resolveExternalSessionDirectory,
	resolveGrokSessionsDirectory,
} from "@vetta/coding-agent/external-sessions";

export interface GrokSessionsDirectoryDetection {
	/** Absolute path to the Grok sessions root, if that directory exists. */
	readonly path?: string;
}

export interface DetectGrokSessionsDirectoryOptions {
	readonly grokHome?: string;
	readonly homeDirectory?: string;
	readonly exists?: (path: string) => boolean;
}

export interface DetectExternalSessionDirectoryOptions {
	readonly homeDirectory?: string;
	readonly exists?: (path: string) => boolean;
}

function isExistingDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function resolveToolSessionDirectory(tool: ExternalSessionToolId, homeDirectory: string): string {
	if (tool === "grok") {
		return resolveGrokSessionsDirectory({
			grokHome: process.env.GROK_HOME,
			homeDirectory,
			join,
		});
	}
	return resolveExternalSessionDirectory(tool, {
		homeDirectory,
		grokHome: process.env.GROK_HOME,
		claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
		codexHome: process.env.CODEX_HOME,
		cursorHome: process.env.CURSOR_HOME,
		piHome: process.env.PI_HOME,
		ompHome: process.env.OMP_HOME,
		join,
	});
}

/** Well-known path Grok-style: `$HOME/<tool-root>`. Directory may not exist. */
export function resolveDefaultExternalSessionDirectory(tool: ExternalSessionToolId): string {
	return resolveToolSessionDirectory(tool, homedir());
}

/** Resolve the well-known Grok sessions root and report it only when the directory exists. */
export function detectGrokSessionsDirectory(
	options: DetectGrokSessionsDirectoryOptions = {},
): GrokSessionsDirectoryDetection {
	const path = resolveGrokSessionsDirectory({
		grokHome: options.grokHome ?? process.env.GROK_HOME,
		homeDirectory: options.homeDirectory ?? homedir(),
		join,
	});
	const exists = options.exists ?? isExistingDirectory;
	return exists(path) ? { path } : {};
}

/** Same as Grok: one well-known path under the user home, only if that directory exists. */
export function detectExternalSessionDirectory(
	tool: ExternalSessionToolId,
	options: DetectExternalSessionDirectoryOptions = {},
): string | undefined {
	if (tool === "grok") return detectGrokSessionsDirectory(options).path;
	const path = resolveToolSessionDirectory(tool, options.homeDirectory ?? homedir());
	const exists = options.exists ?? isExistingDirectory;
	return exists(path) ? path : undefined;
}

/** 在 Grok 会话根下找出这次运行写过的会话：目录匹配，且最后活跃时间不早于启动时刻。多个时取最近的一条。 */
export function locateGrokSessionId(input: { sessionsRoot: string; cwd: string; startedAt: number }): string | null {
	const want = normalizePath(input.cwd);
	let best: { id: string; at: number } | null = null;
	for (const header of readGrokSummaries(input.sessionsRoot)) {
		if (header.kind !== "ok") continue;
		if (normalizePath(header.summary.cwd) !== want) continue;
		if (header.summary.lastActiveAt < input.startedAt) continue;
		if (!best || header.summary.lastActiveAt >= best.at) {
			best = { id: header.summary.id, at: header.summary.lastActiveAt };
		}
	}
	return best?.id ?? null;
}

function readGrokSummaries(root: string): ReturnType<typeof findGrokSummaryHeader>[] {
	let workspaces: string[] = [];
	try {
		workspaces = readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
	const headers: ReturnType<typeof findGrokSummaryHeader>[] = [];
	for (const workspace of workspaces) {
		let sessions: string[] = [];
		try {
			sessions = readdirSync(join(root, workspace), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			continue;
		}
		for (const session of sessions) {
			try {
				const text = readFileSync(join(root, workspace, session, GROK_SUMMARY_SIDECAR_NAME), "utf8");
				headers.push(findGrokSummaryHeader(text));
			} catch {
				// 缺 sidecar 或读失败的目录不是这次要定位的会话。
			}
		}
	}
	return headers;
}

function normalizePath(path: string): string {
	const slash = path.replace(/\\/g, "/").replace(/\/+$/, "");
	return slash.length === 0 ? "/" : slash;
}
