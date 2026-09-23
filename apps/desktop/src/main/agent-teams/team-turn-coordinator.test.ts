import {
	AGENT_TEAM_SCHEMA_VERSION,
	type AgentTeamExtensionRegistry,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
	type TeamMemberTurnAttempt,
	type TeamMemberTurnRequest,
	type TeamSessionDocument,
	type TeamWorkItem,
} from "@vetta/agent-team";
import type { RuntimeHost } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import type { TeamMemberAttemptRunner } from "./team-member-attempt-runner.js";
import type { TeamSessionEventHub } from "./team-session-event-hub.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";
import { TeamTurnCoordinator } from "./team-turn-coordinator.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("TeamTurnCoordinator", () => {
	it("does not wake a task initiator after the user stopped the team", async () => {
		const deliverSessionContext = vi.fn(async () => undefined);
		const runtime = {
			deliverSessionContext,
			readSessionDocument: () => ({ entries: [] }),
		} as unknown as RuntimeHost;
		const completedWorkItem: TeamWorkItem = {
			id: "work-1",
			requestTurnId: "request-1",
			createdByParticipantId: "leader",
			assignedToParticipantId: "member",
			objective: "complete work",
			contextEntryIds: [],
			state: "completed",
			resultMessageId: "result-1",
			currentAttemptId: "attempt-1",
			createdAt: 1,
			updatedAt: 2,
			revision: 2,
		};
		const collaborationStore = {
			settle: vi.fn(async () => completedWorkItem),
		} as unknown as TeamCollaborationStore;
		const sessionState = {
			get: () => undefined,
			values: () => [],
		} as unknown as TeamSessionStateRepository;
		const coordinator = new TeamTurnCoordinator({
			runtime: () => runtime,
			extensions: {} as AgentTeamExtensionRegistry,
			collaborationStore,
			sessionState,
			eventHub: {} as TeamSessionEventHub,
			readSession: async () => session,
			readDocument: async () => ({
				schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
				revision: 0,
				agents: [],
				teams: [],
			}),
			observations: () => undefined,
			publishSessionUpdated: () => undefined,
		});

		await coordinator.abort(session.id);
		await coordinator.settleMemberAttempt(
			session,
			{ ...completedWorkItem, state: "running", resultMessageId: undefined, revision: 1 },
			attempt,
			{ state: "completed" },
			"result-1",
		);

		expect(deliverSessionContext).not.toHaveBeenCalled();
	});

	it("rejects a delegation whose session lookup finishes after the user stopped the team", async () => {
		let releaseRead!: () => void;
		const readStarted = deferred();
		const readSession = vi.fn(async () => {
			readStarted.resolve();
			await new Promise<void>((resolve) => {
				releaseRead = resolve;
			});
			return session;
		});
		const enqueueAssignment = vi.fn();
		const collaborationStore = {
			enqueueAssignment,
			cancelForTeamStop: vi.fn(async () => undefined),
			append: vi.fn(async () => undefined),
		} as unknown as TeamCollaborationStore;
		const runtime = {
			abort: vi.fn(async () => undefined),
			hasSessionExtension: vi.fn(() => false),
		} as unknown as RuntimeHost;
		const coordinator = new TeamTurnCoordinator({
			runtime: () => runtime,
			extensions: {
				orchestrationPolicies: new Map([
					[
						"leader-delegates-v1",
						{
							id: "leader-delegates-v1",
							resolveTargets: () => [],
						},
					],
				]),
			} as unknown as AgentTeamExtensionRegistry,
			collaborationStore,
			sessionState: {
				get: () => session,
				values: () => [session],
			} as unknown as TeamSessionStateRepository,
			eventHub: {} as TeamSessionEventHub,
			readSession,
			readDocument: async () => ({
				schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
				revision: 0,
				agents: [],
				teams: [],
			}),
			observations: () => undefined,
			publishSessionUpdated: () => undefined,
		});
		const delegation = coordinator.taskControls(session.id).delegateTask({
			sourceRuntimeSessionId: "leader-runtime",
			sourceTurnId: "leader-turn",
			toolCallId: "delegate-call",
			signal: new AbortController().signal,
			requestId: "late-delegation",
			targetHandle: "member",
			objective: "must not be admitted",
		});
		await readStarted.promise;

		await coordinator.abort(session.id);
		releaseRead();

		await expect(delegation).rejects.toThrow("stopped");
		expect(enqueueAssignment).not.toHaveBeenCalled();
	});

	it("wakes the teammate named in a peer-room reply and stops when the reply names nobody", async () => {
		const peerSession: TeamSessionDocument = {
			...session,
			orchestrationPolicyId: "peer-mentions-v1",
			memberHandles: { leader: "lead", member: "builder" },
		};
		const enqueued: TeamMemberTurnRequest[] = [];
		const collaborationStore = {
			enqueue: vi.fn(
				async (input: {
					requestId: string;
					memberId: string;
					objective: string;
					createdByParticipantId: string;
				}) => ({
					created: true,
					workItem: {
						id: `work:${input.requestId}:${input.memberId}`,
						requestTurnId: input.requestId,
						createdByParticipantId: input.createdByParticipantId,
						assignedToParticipantId: input.memberId,
						objective: input.objective,
						contextEntryIds: [],
						state: "queued" as const,
						createdAt: 1,
						updatedAt: 1,
						revision: 0,
					},
				}),
			),
			read: () => ({
				workItems: [],
				attempts: [],
				deliveries: [],
				publications: [],
				checkpoints: [],
				contextGenerations: [],
				contextReceipts: [],
			}),
		} as unknown as TeamCollaborationStore;
		const coordinator = new TeamTurnCoordinator({
			runtime: () => ({}) as RuntimeHost,
			extensions: DEFAULT_AGENT_TEAM_EXTENSIONS,
			collaborationStore,
			sessionState: {
				get: () => peerSession,
				values: () => [peerSession],
			} as unknown as TeamSessionStateRepository,
			eventHub: { isTurnActive: () => false } as unknown as TeamSessionEventHub,
			readSession: async () => peerSession,
			readDocument: async () => ({
				schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
				revision: 0,
				agents: [],
				teams: [],
			}),
			observations: () => undefined,
			publishSessionUpdated: () => undefined,
		});
		coordinator.setAttemptRunner({
			run: async (input: TeamMemberTurnRequest) => {
				enqueued.push(input);
				return peerSession;
			},
		} as unknown as TeamMemberAttemptRunner);

		await coordinator.continuePeerMentions({
			session: peerSession,
			speakerParticipantId: "leader",
			publishedText: "@builder 请看这一版。",
			requestTurnId: "user-1",
		});
		expect(enqueued.map((input) => input.memberId)).toEqual(["member"]);
		expect(enqueued[0]?.requestId).toBe(`peer-mention/1/leader/member/${encodeURIComponent("user-1")}`);
		expect(enqueued[0]?.promptText).toContain("@builder 请看这一版。");

		await coordinator.continuePeerMentions({
			session: peerSession,
			speakerParticipantId: "member",
			publishedText: "按这个做，不再叫人。",
			requestTurnId: enqueued[0]?.requestId ?? "",
		});
		expect(enqueued).toHaveLength(1);
	});
});

const session: TeamSessionDocument = {
	schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
	revision: 1,
	id: "team-session",
	teamId: "team",
	name: "Team",
	cwd: "C:/workspace",
	leaderMemberId: "leader",
	memberHandles: { leader: "leader", member: "member" },
	createdAt: 1,
	updatedAt: 1,
	coordinationRuntime: { sessionId: "coordination", sessionPath: "C:/coordination.jsonl" },
	events: [],
	memberRuntime: {
		leader: {
			sessionId: "leader-runtime",
			sessionPath: "C:/leader.jsonl",
			agentProfileRevision: 1,
			deliveredEventIds: [],
		},
		member: {
			sessionId: "member-runtime",
			sessionPath: "C:/member.jsonl",
			agentProfileRevision: 1,
			deliveredEventIds: [],
		},
	},
};

const attempt: TeamMemberTurnAttempt = {
	id: "attempt-1",
	workItemId: "work-1",
	participantConversationId: "member-runtime",
	sourceTurnId: "member-turn",
	attempt: 1,
	mode: "initial",
	state: "running",
	lastProgressAt: 1,
};

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
