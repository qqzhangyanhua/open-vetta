import { describe, expect, it } from "vitest";
import { normalizeMentionHandle } from "../src/domain.js";
import {
	isPeerMentionContinuation,
	LEADER_DELEGATION_TOOL_NAMES,
	MAX_PEER_MENTION_DEPTH,
	mentionedParticipantIds,
	PEER_MENTION_ORCHESTRATION_POLICY_ID,
	PEER_MENTION_TOOL_NAMES,
	peerMentionLineage,
	peerMentionTargets,
	planPeerMentionContinuations,
	teamCollaborationToolNames,
} from "../src/peer-mentions.js";

const members = [
	{ id: "design", handle: "设计" },
	{ id: "frontend", handle: "前端开发" },
	{ id: "lead", handle: "Lead" },
];

describe("peer mention routing", () => {
	it("wakes mentioned teammates in the order they appear and skips the speaker", () => {
		expect(
			mentionedParticipantIds(
				members,
				"@前端开发 稿收到了。请 @设计 确认，「待校准」和 @前端开发 再对一下。",
				"frontend",
			),
		).toEqual(["design"]);
	});

	it("accepts a mention after an opening bracket and ignores an address inside a word", () => {
		expect(mentionedParticipantIds(members, "（@设计）看一下 user@设计.com 和@Lead。")).toEqual(["design", "lead"]);
		expect(normalizeMentionHandle("Lead")).toBe("lead");
	});

	it("does not plan continuations for the leader policy, a reply with no mention, or the depth cap", () => {
		const base = {
			policyId: PEER_MENTION_ORCHESTRATION_POLICY_ID,
			members,
			speakerParticipantId: "design",
			speakerHandle: "设计",
			publishedText: "好，按这个定。",
			requestTurnId: "user-1",
		};
		expect(planPeerMentionContinuations(base)).toEqual([]);
		expect(
			planPeerMentionContinuations({ ...base, policyId: "leader-delegates-v1", publishedText: "@前端开发 看一下" }),
		).toEqual([]);
		const capped = peerMentionLineage(`peer-mention/${MAX_PEER_MENTION_DEPTH}/design/frontend/user-1`);
		expect(capped).toEqual({ rootRequestId: "user-1", depth: MAX_PEER_MENTION_DEPTH });
		expect(
			planPeerMentionContinuations({
				...base,
				publishedText: "@前端开发 再看一眼",
				requestTurnId: `peer-mention/${MAX_PEER_MENTION_DEPTH}/frontend/design/${encodeURIComponent("user-1")}`,
			}),
		).toEqual([]);
	});

	it("plans the next room turn from the published reply and keeps two speakers from colliding", () => {
		const [fromDesign, fromLead] = ["design", "lead"].map((speakerParticipantId) =>
			planPeerMentionContinuations({
				policyId: PEER_MENTION_ORCHESTRATION_POLICY_ID,
				members,
				speakerParticipantId,
				speakerHandle: speakerParticipantId,
				publishedText: "@前端开发 按表格做。",
				requestTurnId: "user-1",
			}),
		);
		expect(fromDesign?.[0]).toMatchObject({
			participantId: "frontend",
			depth: 1,
			rootRequestId: "user-1",
			requestId: `peer-mention/1/design/frontend/${encodeURIComponent("user-1")}`,
			promptText: "Answer this public message from @design:\n@前端开发 按表格做。",
		});
		expect(fromLead?.[0]?.requestId).not.toBe(fromDesign?.[0]?.requestId);
		expect(isPeerMentionContinuation(fromDesign?.[0]?.requestId ?? "")).toBe(true);
		expect(isPeerMentionContinuation("user-1")).toBe(false);
		const next = planPeerMentionContinuations({
			policyId: PEER_MENTION_ORCHESTRATION_POLICY_ID,
			members,
			speakerParticipantId: "frontend",
			speakerHandle: "前端开发",
			publishedText: "@设计 两点确认。",
			requestTurnId: fromDesign?.[0]?.requestId ?? "",
		});
		expect(next[0]).toMatchObject({ participantId: "design", depth: 2, rootRequestId: "user-1" });
	});

	it("addresses nobody when a peer room message names nobody", () => {
		const team = {
			id: "team",
			revision: 1,
			name: "Room",
			description: "",
			leaderMemberId: "lead",
			members: members.map((member) => ({
				id: member.id,
				handle: member.handle,
				binding: { kind: "reference" as const, agentProfileId: member.id },
			})),
			orchestrationPolicyId: PEER_MENTION_ORCHESTRATION_POLICY_ID,
			contextPolicyId: "public-results-v1",
			createdAt: 0,
			updatedAt: 0,
		};
		expect(peerMentionTargets(team, [])).toEqual([]);
		expect(peerMentionTargets(team, ["frontend", "frontend"])).toEqual(["frontend"]);
		expect(() => peerMentionTargets(team, ["missing"])).toThrow("Unknown team member: missing");
	});

	it("hides delegation tools in a peer room and keeps them for the leader policy", () => {
		expect(teamCollaborationToolNames(PEER_MENTION_ORCHESTRATION_POLICY_ID)).toEqual([...PEER_MENTION_TOOL_NAMES]);
		expect(teamCollaborationToolNames("leader-delegates-v1")).toEqual([...LEADER_DELEGATION_TOOL_NAMES]);
		expect(teamCollaborationToolNames(undefined)).toContain("team_delegate_task");
		expect(teamCollaborationToolNames(PEER_MENTION_ORCHESTRATION_POLICY_ID)).not.toContain("team_delegate_task");
		expect(teamCollaborationToolNames(PEER_MENTION_ORCHESTRATION_POLICY_ID)).not.toContain("team_send_message");
	});
});
