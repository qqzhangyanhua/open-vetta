/**
 * Plain TypeScript AST for architecture guards.
 *
 * The tree is JSON-serializable. A TypeScript SourceFile is not: parent
 * pointers cycle, and the compiler object cannot be reused from disk.
 * Bump AST_FORMAT_VERSION when a node field changes; the file cache trusts it.
 */

import ts from "typescript";

export const AST_FORMAT_VERSION = 1;

/**
 * SyntaxKind stores range aliases (FirstLiteralToken, FirstStatement) on the
 * same numbers as the real node names. Prefer the name that is not an alias.
 */
const PREFERRED_KIND_NAMES = preferredKindNames();

function preferredKindNames() {
	const names = new Map();
	for (const [name, value] of Object.entries(ts.SyntaxKind)) {
		if (typeof value !== "number") continue;
		const existing = names.get(value);
		const alias = /^(First|Last)/.test(name);
		if (!existing || (!alias && /^(First|Last)/.test(existing))) names.set(value, name);
	}
	return names;
}

function kindName(kind) {
	return PREFERRED_KIND_NAMES.get(kind) ?? "Unknown";
}

function scriptKind(filePath) {
	if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
		return ts.ScriptKind.JS;
	}
	return ts.ScriptKind.TS;
}

function literalText(node) {
	if (typeof node.text !== "string") return undefined;
	if (
		ts.isIdentifier(node) ||
		ts.isPrivateIdentifier(node) ||
		ts.isStringLiteralLike(node) ||
		ts.isNumericLiteral(node) ||
		ts.isBigIntLiteral(node) ||
		ts.isJsxText(node) ||
		ts.isRegularExpressionLiteral(node)
	) {
		return node.text;
	}
	return undefined;
}

function serialize(node, sourceFile) {
	const start = node.getStart(sourceFile, false);
	const plain = {
		kind: kindName(node.kind),
		start,
		end: node.end,
		line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
	};
	const text = literalText(node);
	if (text !== undefined) plain.text = text;
	if (node.isTypeOnly === true) plain.typeOnly = true;
	const children = [];
	node.forEachChild((child) => {
		// Every file ends with this token. It is not a statement and would make an empty file look populated.
		if (child.kind === ts.SyntaxKind.EndOfFileToken) return;
		children.push(serialize(child, sourceFile));
	});
	if (children.length > 0) plain.children = children;
	return plain;
}

/** Parse source text into a plain AST. `filePath` is only used to pick the script kind. */
export function parseSource(filePath, text) {
	if (typeof filePath !== "string" || filePath.length === 0) throw new Error("file path must be non-empty");
	if (typeof text !== "string") throw new Error("source text must be a string");
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, false, scriptKind(filePath));
	return serialize(sourceFile, sourceFile);
}

/** Preorder walk. Returning false from `visit` skips the node's children. */
export function walkAst(node, visit) {
	if (!node || typeof node !== "object") throw new Error("walkAst requires a node");
	if (typeof visit !== "function") throw new Error("walkAst requires a visitor");
	if (visit(node) === false) return;
	if (!node.children) return;
	for (const child of node.children) walkAst(child, visit);
}

/** Collect nodes for which `predicate` returns true, in preorder. */
export function findNodes(node, predicate) {
	if (typeof predicate !== "function") throw new Error("findNodes requires a predicate");
	const found = [];
	walkAst(node, (current) => {
		if (predicate(current)) found.push(current);
	});
	return found;
}
