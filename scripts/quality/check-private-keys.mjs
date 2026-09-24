/**
 * Fail if text outside docs and generated trees looks like a private key.
 * The full scan and `check:quick` use the same set, including repo-root
 * files and extensions such as `.pem`. Docs stay skipped so examples are not keys.
 *
 * Usage:
 *   bun run scripts/quality/check-private-keys.mjs
 *   bun run scripts/quality/check-private-keys.mjs --staged
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
	CheckViolation,
	collectFileViolations,
	isBinaryLike,
	isDirectRun,
	lineNumberAt,
	readText,
	repoRoot,
	runCheck,
	stagedFiles,
	toPosix,
	walkFiles,
} from "./lib.mjs";

// Build markers at runtime so this file is not flagged by its own patterns.
const begin = "-----BEGIN ";
const endKey = "PRIVATE KEY-----";
const PATTERNS = [
	{ name: "RSA private key", rule: "rsa-private-key", re: new RegExp(`${begin}RSA ${endKey}`) },
	{ name: "OPENSSH private key", rule: "openssh-private-key", re: new RegExp(`${begin}OPENSSH ${endKey}`) },
	{ name: "EC private key", rule: "ec-private-key", re: new RegExp(`${begin}EC ${endKey}`) },
	{ name: "DSA private key", rule: "dsa-private-key", re: new RegExp(`${begin}DSA ${endKey}`) },
	{ name: "PGP private key block", rule: "pgp-private-key", re: new RegExp(`${begin}PGP PRIVATE KEY BLOCK-----`) },
	{ name: "generic PRIVATE KEY block", rule: "generic-private-key", re: new RegExp(`${begin}([A-Z0-9 ]+)?${endKey}`) },
];

const MAX_TEXT_LENGTH = 2_000_000;

const SKIP_DIR_PARTS = [
	"/node_modules/",
	"/dist/",
	"/.git/",
	"/.next/",
	"/coverage/",
	"/releases/",
	"/scripts/quality/",
	// intentional fixtures / docs that may show key-shaped examples
	"/test/fixtures/",
	"/docs/",
];

function shouldSkip(posixPath) {
	const path = `/${toPosix(posixPath)}`;
	if (path.endsWith("/check-private-keys.mjs")) return true;
	return SKIP_DIR_PARTS.some((part) => path.includes(part));
}

/** Changed-file gates reuse the full scan's skip list, including docs and this directory. */
export function selectPrivateKeyFiles(files) {
	return files.filter((file) => !isBinaryLike(file) && !shouldSkip(file));
}

const SCAN_ROOTS = ["packages", "apps", "scripts", "deploy"];

function repoRelative(root, file) {
	return toPosix(relative(root, file));
}

/** Full-tree paths, including repo-root text and extensions such as `.pem`. */
export function listPrivateKeyTargets(root = repoRoot) {
	const files = [];
	for (const dir of SCAN_ROOTS) {
		files.push(...walkFiles(join(root, dir), { extensions: null }).map((file) => repoRelative(root, file)));
	}
	let entries = [];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		entries = [];
	}
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		files.push(entry.name);
	}
	return selectPrivateKeyFiles(files);
}

/** First matching key in one file. Text above the size cap is ignored. */
export function findPrivateKeyViolationsInText(file, text) {
	if (text.length > MAX_TEXT_LENGTH) return [];
	for (const pattern of PATTERNS) {
		const index = text.search(pattern.re);
		if (index === -1) continue;
		return [new CheckViolation(file, lineNumberAt(text, index), pattern.rule, `possible ${pattern.name}`)];
	}
	return [];
}

function collectTargets(stagedOnly) {
	if (stagedOnly) {
		return selectPrivateKeyFiles(stagedFiles()).filter((file) => existsSync(join(repoRoot, file)));
	}
	return listPrivateKeyTargets();
}

/** Read each repo-relative path and return key violations. A file that cannot be read is skipped. */
export function checkPrivateKeys(files, readFile = (file) => readText(join(repoRoot, file))) {
	return collectFileViolations(files, findPrivateKeyViolationsInText, readFile);
}

export function main(argv = process.argv) {
	const stagedOnly = argv.includes("--staged");
	return runCheck("private-key", () => checkPrivateKeys(collectTargets(stagedOnly)));
}

if (isDirectRun(import.meta.url)) {
	process.exitCode = main();
}
