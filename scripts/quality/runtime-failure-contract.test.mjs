import { describe, expect, it } from "vitest";
import { findRuntimeFailureContractViolations, REQUIRED_RUNTIME_FAILURE_MARKERS } from "./check-runtime-boundaries.mjs";

function contractFixture() {
	return Object.entries(REQUIRED_RUNTIME_FAILURE_MARKERS).map(([path, markers]) => ({
		path,
		text: markers.join("\n"),
	}));
}

describe("runtime failure contract gate", () => {
	it("keeps the production failure markers", () => {
		expect(REQUIRED_RUNTIME_FAILURE_MARKERS).toEqual({
			"packages/coding-agent/src/rpc/rpc-failure.ts": [
				"RpcFailureMetadataSchema",
				'"retry_safe"',
				'"continue_session"',
				'"restart_session"',
				'"user_action"',
				'"fatal"',
			],
			"packages/coding-agent/src/rpc/rpc-types.ts": ["RpcFailureMetadata"],
			"packages/coding-agent/src/rpc/rpc-client.ts": ["reject(rpcClientErrorFromResponse(response))"],
			"packages/coding-agent/src/composition/runtime-host-retry.ts": [
				"CONVERSATION_STORAGE_ERROR_CODES.OWNERSHIP_CONFLICT",
				'runtimeError("SESSION_LOCKED"',
			],
			"apps/cli-host/src/session-compatibility-error.ts": ["recoverability"],
			"packages/runtime-core/src/errors.ts": ["SESSION_BUSY", "SESSION_LOCKED", "isSessionError"],
			"apps/desktop/src/main/conversations/desktop-conversation-service.ts": [
				"RUNTIME_ERROR_CODES.SESSION_BUSY",
				"RUNTIME_ERROR_CODES.SESSION_LOCKED",
			],
			"packages/runtime-desktop/src/lifecycle.ts": ["DesktopRuntimeFailure", "DesktopRuntimeHealth"],
			"apps/im-gateway/internal/hostclient/types.go": [
				"type TypedFailure interface",
				"FailureRecoverability() FailureRecoverability",
			],
			"apps/im-gateway/internal/hostclient/local/session.go": ["failureFromResponse(resp, commandPhase(cmd.Type))"],
			"apps/im-gateway/internal/hostclient/pool.go": ["func (a *Acquired) Discard() error"],
			"apps/im-gateway/internal/router/router.go": ["discardRestartRequiredSession", "FailureRestartSession"],
		});
	});

	it("accepts structured failure boundaries with explicit recovery values", () => {
		expect(findRuntimeFailureContractViolations(contractFixture())).toEqual([]);
	});

	it("rejects missing metadata and message-based recovery classification", () => {
		const files = contractFixture();
		files[0].text = files[0].text.replace('"retry_safe"', "");
		files.push({
			path: "packages/coding-agent/src/rpc/example.ts",
			text: 'if (error.message.includes("timeout")) return "automatic_replay";',
		});

		expect(findRuntimeFailureContractViolations(files)).toEqual([
			'packages/coding-agent/src/rpc/rpc-failure.ts: missing contract marker ("retry_safe")',
			"packages/coding-agent/src/rpc/example.ts: classifies recovery by JavaScript error message",
			"packages/coding-agent/src/rpc/example.ts: reintroduces automatic Turn replay",
		]);
	});

	it("rejects a missing contract file", () => {
		expect(findRuntimeFailureContractViolations(contractFixture().slice(1))).toEqual([
			"packages/coding-agent/src/rpc/rpc-failure.ts: required runtime failure contract file is missing",
		]);
	});

	it("can inspect isolated forbidden-pattern fixtures", () => {
		const files = [
			{
				path: "apps/im-gateway/internal/hostclient/example.go",
				text: 'strings.Contains(err.Error(), "timeout")',
			},
			{
				path: "apps/desktop/src/main/conversations/example.ts",
				text: 'if (error.name === "SessionLockError") return "locked";',
			},
		];

		expect(findRuntimeFailureContractViolations(files, { requireBaseline: false })).toEqual([
			"apps/im-gateway/internal/hostclient/example.go: classifies recovery by Go error message",
			"apps/desktop/src/main/conversations/example.ts: classifies recovery by JavaScript error name",
		]);
	});
});
