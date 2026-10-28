import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import electronPath from "electron";
import { resolveDevProcessEnvironment } from "./run-dev-electron.mjs";

test("development Electron enables local action approval bypass by default", () => {
	assert.equal(resolveDevProcessEnvironment({}).VETTA_DEV_AUTO_APPROVE_ACTIONS, "1");
});

test("development approval bypass can be disabled explicitly", () => {
	assert.equal(
		resolveDevProcessEnvironment({ VETTA_DEV_AUTO_APPROVE_ACTIONS: "0" }).VETTA_DEV_AUTO_APPROVE_ACTIONS,
		"0",
	);
});

test("inherited ELECTRON_RUN_AS_NODE does not make Chromium switches a bad option", () => {
	const env = resolveDevProcessEnvironment({
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
	});
	assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);

	const result = spawnSync(electronPath, ["--user-data-dir=/tmp/vetta-dev-electron-env-test", "--version"], {
		env,
		encoding: "utf8",
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /^v\d+\.\d+\.\d+/);
});
