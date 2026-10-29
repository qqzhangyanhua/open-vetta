/**
 * 渲染进程跑在 Vite 的浏览器包里。`@vetta/ssh-transport` 的包根会再导出
 * helper-deployment 和 ssh-argv，这两个模块在顶层读取 `node:crypto.createHash`。
 * 开发模式把依赖入口整包预构建，于是只要页面运行时导入包根，打开该页就会报
 * “Module node:crypto has been externalized for browser compatibility”。
 * 运行时只能导入不触碰 Node 内置模块的子路径，例如 `./project-uri`。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER_ROOT = join(__dirname);
const PROJECT_URI_SOURCE = join(RENDERER_ROOT, "../../../../packages/ssh-transport/src/project-uri.ts");
const SSH_TRANSPORT_ROOT = "@vetta/ssh-transport";

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function listRendererSources(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules") continue;
			out.push(...listRendererSources(full));
			continue;
		}
		if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/** 去掉注释但保留换行，避免把说明文字当成导入，同时行号仍对得上源文件。 */
function stripComments(source: string): string {
	let out = "";
	let index = 0;
	while (index < source.length) {
		const current = source[index];
		const next = source[index + 1];
		if (current === "/" && next === "/") {
			index += 2;
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (current === "/" && next === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				out += source[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			index += 2;
			continue;
		}
		if (current === '"' || current === "'" || current === "`") {
			out += current;
			index += 1;
			while (index < source.length && source[index] !== current) {
				out += source[index];
				if (source[index] === "\\") {
					index += 1;
					out += source[index] ?? "";
				}
				index += 1;
			}
			out += source[index] ?? "";
			index += 1;
			continue;
		}
		out += current;
		index += 1;
	}
	return out;
}

function isTypeOnlyClause(clause: string): boolean {
	const body = clause.trim();
	if (body.startsWith("type ") || body.startsWith("type{")) return true;
	const open = body.indexOf("{");
	const close = body.lastIndexOf("}");
	if (open < 0 || close < open) return false;
	if (body.slice(0, open).trim().length > 0) return false;
	const specs = body
		.slice(open + 1, close)
		.split(",")
		.map((spec) => spec.trim())
		.filter((spec) => spec.length > 0);
	return specs.length > 0 && specs.every((spec) => spec.startsWith("type ") || spec.startsWith("type\n"));
}

function findSshTransportRootRuntimeImports(source: string): number[] {
	const text = stripComments(source);
	const lines: number[] = [];
	const fromPattern = /\b(?:import|export)\s+([\s\S]*?)\sfrom\s*(["'])([^"']+)\2/g;
	for (const match of text.matchAll(fromPattern)) {
		const clause = match[1] ?? "";
		const specifier = match[3] ?? "";
		if (specifier !== SSH_TRANSPORT_ROOT || isTypeOnlyClause(clause)) continue;
		lines.push(text.slice(0, match.index ?? 0).split("\n").length);
	}
	const sideEffectPattern = /\bimport\s*(["'])(@vetta\/ssh-transport)\1/g;
	for (const match of text.matchAll(sideEffectPattern)) {
		lines.push(text.slice(0, match.index ?? 0).split("\n").length);
	}
	const dynamicPattern = /\bimport\(\s*(["'])(@vetta\/ssh-transport)\1\s*\)/g;
	for (const match of text.matchAll(dynamicPattern)) {
		lines.push(text.slice(0, match.index ?? 0).split("\n").length);
	}
	return lines;
}

function nodeBuiltinImports(source: string): string[] {
	const text = stripComments(source);
	const found: string[] = [];
	const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(node:[^"']+)\1/g;
	for (const match of text.matchAll(pattern)) {
		found.push(match[2] ?? "");
	}
	return found;
}

function relativeModuleGraph(entry: string): string[] {
	const pending = [entry];
	const seen = new Set<string>();
	const files: string[] = [];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || seen.has(file)) continue;
		seen.add(file);
		files.push(file);
		const source = readFileSync(file, "utf8");
		const text = stripComments(source);
		const pattern = /\bfrom\s*(["'])(\.[^"']+)\1/g;
		for (const match of text.matchAll(pattern)) {
			const specifier = match[2] ?? "";
			const resolved = join(file, "..", specifier.endsWith(".js") ? specifier.replace(/\.js$/, ".ts") : specifier);
			pending.push(resolved);
		}
	}
	return files;
}

describe("渲染进程不加载 ssh-transport 包根", () => {
	it("类型导入和 project-uri 子路径可以保留，包根的值导入会被标出", () => {
		const source = `
			import type { SshHost } from "@vetta/ssh-transport";
			import { type RemoteDirectoryEntry } from "@vetta/ssh-transport";
			import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
			import { sameProjectLocation } from "@vetta/ssh-transport";
			import {
				quoteShellArgument,
			} from "@vetta/ssh-transport";
		`;
		expect(findSshTransportRootRuntimeImports(source)).toEqual([5, 6]);
	});

	it("渲染进程源码没有对 @vetta/ssh-transport 包根的运行时导入", () => {
		const violations = listRendererSources(RENDERER_ROOT).flatMap((file) =>
			findSshTransportRootRuntimeImports(readFileSync(file, "utf8")).map((line) => ({
				file: toPosix(relative(RENDERER_ROOT, file)),
				line,
			})),
		);
		expect(violations).toEqual([]);
	});

	it("project-uri 子路径自身不导入 Node 内置模块", () => {
		const hits = relativeModuleGraph(PROJECT_URI_SOURCE).flatMap((file) =>
			nodeBuiltinImports(readFileSync(file, "utf8")).map((specifier) => ({
				file: toPosix(file),
				specifier,
			})),
		);
		expect(hits).toEqual([]);
	});
});
