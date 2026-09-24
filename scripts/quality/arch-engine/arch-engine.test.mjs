import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { findNodes, parseSource, walkAst } from "./ast-walker.mjs";
import { createAstCache } from "./cache.mjs";

function canCreateSymlink() {
	const directory = mkdtempSync(join(tmpdir(), "vetta-arch-symlink-"));
	try {
		symlinkSync(directory, join(directory, "link"), "dir");
		return true;
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
		if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") return false;
		throw error;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function withRoot(run) {
	const root = mkdtempSync(join(tmpdir(), "vetta-arch-engine-"));
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeSource(root, relativePath, text) {
	const absolute = join(root, relativePath);
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, text);
	return absolute;
}

function importSpecifier(ast) {
	const declaration = findNodes(ast, (node) => node.kind === "ImportDeclaration")[0];
	return declaration?.children?.find((child) => child.kind === "StringLiteral")?.text;
}

const MODULE_WITH_IMPORTS = [
	'import type { Foo } from "@vetta/desktop";',
	'import { type Bar, baz } from "@vetta/agent";',
	'export type { Foo } from "./foo.js";',
	"export const answer = 42;",
	"",
].join("\n");

describe("parseSource", () => {
	it("keeps import, export, and literal facts a guard can match", () => {
		const ast = parseSource("src/mod.ts", MODULE_WITH_IMPORTS);
		const imports = findNodes(ast, (node) => node.kind === "ImportDeclaration");
		const typeClause = imports[0]?.children?.find((child) => child.kind === "ImportClause");
		const valueClause = imports[1]?.children?.find((child) => child.kind === "ImportClause");
		const typeSpecifier = findNodes(valueClause, (node) => node.kind === "ImportSpecifier").find(
			(node) => node.typeOnly,
		);
		const exported = findNodes(ast, (node) => node.kind === "ExportDeclaration")[0];

		expect(ast.kind).toBe("SourceFile");
		expect(ast.children?.some((node) => node.kind === "VariableStatement")).toBe(true);
		expect(imports.map((node) => node.children?.find((child) => child.kind === "StringLiteral")?.text)).toEqual([
			"@vetta/desktop",
			"@vetta/agent",
		]);
		expect(typeClause?.typeOnly).toBe(true);
		expect(typeClause?.line).toBe(1);
		expect(valueClause?.typeOnly).toBeUndefined();
		expect(typeSpecifier?.children?.find((child) => child.kind === "Identifier")?.text).toBe("Bar");
		expect(exported?.typeOnly).toBe(true);
		expect(exported?.children?.find((child) => child.kind === "StringLiteral")?.text).toBe("./foo.js");
		expect(findNodes(ast, (node) => node.kind === "Identifier").some((node) => node.text === "answer")).toBe(true);
		expect(findNodes(ast, (node) => node.kind === "NumericLiteral").map((node) => node.text)).toEqual(["42"]);
	});

	it("parses JSX only for JSX script kinds", () => {
		const text = "export const View = () => <Button />;\n";

		expect(findNodes(parseSource("view.tsx", text), (node) => node.kind === "JsxSelfClosingElement")).toHaveLength(1);
		expect(findNodes(parseSource("view.jsx", text), (node) => node.kind === "JsxSelfClosingElement")).toHaveLength(1);
		expect(findNodes(parseSource("view.ts", text), (node) => node.kind === "JsxSelfClosingElement")).toHaveLength(0);
	});

	it("sees require and dynamic import specifiers", () => {
		const ast = parseSource(
			"src/load.js",
			['const fs = require("node:fs");', 'export const lazy = import("./lazy.js");', ""].join("\n"),
		);

		expect(findNodes(ast, (node) => node.kind === "StringLiteral").map((node) => node.text)).toEqual([
			"node:fs",
			"./lazy.js",
		]);
	});

	it("stops descending when the visitor returns false", () => {
		const seen = [];
		walkAst(parseSource("src/mod.ts", 'import { a } from "./a.js";\n'), (node) => {
			seen.push(node.kind);
			if (node.kind === "ImportDeclaration") return false;
		});

		expect(seen).toContain("ImportDeclaration");
		expect(seen).not.toContain("StringLiteral");
	});

	it("parses an empty file as a source file without statements", () => {
		expect(parseSource("src/empty.ts", "").children).toBeUndefined();
	});
});

describe("ast cache", () => {
	it("reuses a parsed module until its bytes change, including a new process", () => {
		withRoot((root) => {
			writeSource(root, "src/mod.ts", 'import { a } from "./a.js";\n');
			const cache = createAstCache({ root });
			expect(cache.stats()).toMatchObject({ hits: 0, misses: 0, parses: 0, hitRate: 0 });

			const first = cache.load(join(root, "src", "mod.ts"));
			expect(importSpecifier(first)).toBe("./a.js");
			expect(cache.stats()).toMatchObject({ misses: 1, hits: 0, parses: 1 });
			expect(existsSync(join(root, ".cache", "quality", "ast"))).toBe(true);

			expect(cache.load("src/mod.ts")).toEqual(first);
			expect(cache.stats()).toMatchObject({ misses: 1, hits: 1, parses: 1, hitRate: 0.5 });

			const reopened = createAstCache({ root });
			expect(reopened.load("src/mod.ts")).toEqual(first);
			expect(reopened.stats()).toMatchObject({ hits: 1, misses: 0, parses: 0 });

			writeSource(root, "src/mod.ts", 'import { b } from "./b.js";\n');
			expect(importSpecifier(cache.load("src/mod.ts"))).toBe("./b.js");
			expect(cache.stats()).toMatchObject({ hashInvalidations: 1, parses: 2, hits: 1 });

			const afterEdit = createAstCache({ root });
			expect(importSpecifier(afterEdit.load("src/mod.ts"))).toBe("./b.js");
			expect(afterEdit.stats()).toMatchObject({ hits: 1, parses: 0 });
		});
	});

	it("reparses when the mtime changes and the bytes stay the same", () => {
		withRoot((root) => {
			const file = writeSource(root, "src/mod.ts", 'import { a } from "./a.js";\n');
			const cache = createAstCache({ root, cacheDir: join(root, "custom-cache") });
			const first = cache.load("src/mod.ts");
			const before = statSync(file);
			const shifted = new Date(before.mtimeMs + 10_000);
			utimesSync(file, shifted, shifted);

			expect(cache.load("src/mod.ts")).toEqual(first);
			expect(cache.stats()).toMatchObject({ mtimeInvalidations: 1, hashInvalidations: 0, hits: 0, parses: 2 });
			expect(existsSync(join(root, "custom-cache", "ast"))).toBe(true);
			expect(existsSync(join(root, ".cache", "quality"))).toBe(false);

			cache.load("src/mod.ts");
			expect(cache.stats()).toMatchObject({ hits: 1, parses: 2 });
		});
	});

	it("reparses when the bytes change even if the mtime is restored", () => {
		withRoot((root) => {
			const firstText = 'import { a } from "./aaa.js";\n';
			const nextText = 'import { b } from "./bbb.js";\n';
			expect(Buffer.byteLength(firstText)).toBe(Buffer.byteLength(nextText));
			const file = writeSource(root, "src/mod.ts", firstText);
			const cache = createAstCache({ root });
			cache.load("src/mod.ts");
			const before = statSync(file);
			writeSource(root, "src/mod.ts", nextText);
			utimesSync(file, before.atime, before.mtime);

			expect(importSpecifier(cache.load("src/mod.ts"))).toBe("./bbb.js");
			expect(cache.stats()).toMatchObject({ hashInvalidations: 1, mtimeInvalidations: 0, hits: 0, parses: 2 });
		});
	});

	it("rejects paths outside the cache root, missing files, and directories", () => {
		withRoot((root) => {
			const cache = createAstCache({ root });
			mkdirSync(join(root, "src", "not-a-file.ts"), { recursive: true });

			expect(() => cache.load("../outside.ts")).toThrow("inside the repository");
			expect(() => cache.load("src/missing.ts")).toThrow("src/missing.ts");
			expect(() => cache.load("src/not-a-file.ts")).toThrow("not a file");
			expect(cache.stats().parses).toBe(0);
		});
	});

	it("reparses when the stored format version differs or the cache file is unreadable", () => {
		withRoot((root) => {
			writeSource(root, "src/mod.ts", 'import { a } from "./a.js";\n');
			createAstCache({ root }).load("src/mod.ts");
			const cacheFile = join(
				root,
				".cache",
				"quality",
				"ast",
				readdirSync(join(root, ".cache", "quality", "ast"))[0],
			);
			const record = JSON.parse(readFileSync(cacheFile, "utf8"));
			record.version += 1;
			writeFileSync(cacheFile, JSON.stringify(record));

			const staleFormat = createAstCache({ root });
			expect(importSpecifier(staleFormat.load("src/mod.ts"))).toBe("./a.js");
			expect(staleFormat.stats()).toMatchObject({ misses: 1, parses: 1, hits: 0 });
			expect(JSON.parse(readFileSync(cacheFile, "utf8")).version).toBe(record.version - 1);

			writeFileSync(cacheFile, "{");
			const broken = createAstCache({ root });
			expect(importSpecifier(broken.load("src/mod.ts"))).toBe("./a.js");
			expect(broken.stats()).toMatchObject({ misses: 1, parses: 1, hits: 0 });
		});
	});

	it.skipIf(!canCreateSymlink())("rejects a source symlink that resolves outside the cache root", () => {
		withRoot((root) => {
			const outside = mkdtempSync(join(tmpdir(), "vetta-arch-outside-"));
			try {
				writeSource(outside, "secret.ts", 'import { secret } from "secret";\n');
				symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
				const cache = createAstCache({ root });

				expect(() => cache.load("escape.ts")).toThrow("inside the repository");
				expect(cache.stats().parses).toBe(0);
				expect(existsSync(join(root, ".cache", "quality"))).toBe(false);
			} finally {
				rmSync(outside, { recursive: true, force: true });
			}
		});
	});
});

describe("ast cache performance", () => {
	it("loads a warm cache at least twice as fast as parsing the same file again", () => {
		withRoot((root) => {
			let source = "";
			for (let index = 0; index < 2500; index += 1) {
				source += `import { value${index} } from "./mod-${index}.js";\n`;
			}
			const relativePath = "src/large.ts";
			writeSource(root, relativePath, source);
			const cache = createAstCache({ root });
			parseSource(relativePath, source);
			cache.load(relativePath);

			const iterations = 8;
			const cachedStarted = performance.now();
			for (let index = 0; index < iterations; index += 1) cache.load(relativePath);
			const cachedMs = performance.now() - cachedStarted;
			const parsedStarted = performance.now();
			for (let index = 0; index < iterations; index += 1) parseSource(relativePath, source);
			const parsedMs = performance.now() - parsedStarted;
			const ratio = parsedMs / cachedMs;

			expect(cache.stats().parses).toBe(1);
			expect(ratio, `parse ${parsedMs.toFixed(1)}ms, cache ${cachedMs.toFixed(1)}ms`).toBeGreaterThanOrEqual(2);
		});
	}, 20_000);
});
