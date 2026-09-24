import type { TeamDefinition } from "./contracts.js";

/** Same folding as `normalizeMentionHandle`. Kept local so this module does not import `domain`. */
function normalizeHandle(value: string): string {
	return value.normalize("NFKC").trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}

/** Members speak in one room and wake each other with @mentions. */
export const PEER_MENTION_ORCHESTRATION_POLICY_ID = "peer-mentions-v1";

/**
 * How many peer replies may follow one user message.
 * The user turn is depth 0. A reply at this depth is still published, and does not wake anyone else.
 */
export const MAX_PEER_MENTION_DEPTH = 6;

const PEER_REQUEST_PREFIX = "peer-mention/";

/** Tools a peer room keeps. Delegation, waiting and explicit send are the leader loop. */
export const PEER_MENTION_TOOL_NAMES = Object.freeze([
	"team_get_task",
	"team_continue_task",
	"team_retry_task",
	"team_read_shared_history",
] as const);

export const LEADER_DELEGATION_TOOL_NAMES = Object.freeze([
	"team_delegate_task",
	"team_get_task",
	"team_wait_tasks",
	"team_continue_task",
	"team_retry_task",
	"team_cancel_task",
	"team_send_message",
	"team_read_shared_history",
] as const);

export function teamCollaborationToolNames(policyId: string | undefined): readonly string[] {
	return policyId === PEER_MENTION_ORCHESTRATION_POLICY_ID ? PEER_MENTION_TOOL_NAMES : LEADER_DELEGATION_TOOL_NAMES;
}

export function isPeerMentionContinuation(requestTurnId: string): boolean {
	return requestTurnId.startsWith(PEER_REQUEST_PREFIX);
}

export interface PeerMentionLineage {
	readonly rootRequestId: string;
	readonly depth: number;
}

/** User turns stay at depth 0. Peer wakes encode depth, speaker, target and the root request. */
export function peerMentionLineage(requestTurnId: string): PeerMentionLineage {
	const match = /^peer-mention\/(\d+)\/[^/]+\/[^/]+\/(.+)$/u.exec(requestTurnId);
	if (!match?.[1] || !match[2]) return { rootRequestId: requestTurnId, depth: 0 };
	const depth = Number(match[1]);
	if (!Number.isInteger(depth) || depth < 1) return { rootRequestId: requestTurnId, depth: 0 };
	return { rootRequestId: decodeURIComponent(match[2]), depth };
}

export interface PeerMentionContinuation {
	readonly participantId: string;
	readonly requestId: string;
	readonly promptText: string;
	readonly depth: number;
	readonly rootRequestId: string;
}

export function planPeerMentionContinuations(input: {
	readonly policyId: string | undefined;
	readonly members: readonly { readonly id: string; readonly handle: string }[];
	readonly speakerParticipantId: string;
	readonly speakerHandle: string;
	readonly publishedText: string;
	readonly requestTurnId: string;
}): readonly PeerMentionContinuation[] {
	if (input.policyId !== PEER_MENTION_ORCHESTRATION_POLICY_ID) return [];
	const lineage = peerMentionLineage(input.requestTurnId);
	if (lineage.depth >= MAX_PEER_MENTION_DEPTH) return [];
	const mentioned = mentionedParticipantIds(input.members, input.publishedText, input.speakerParticipantId);
	const depth = lineage.depth + 1;
	const root = encodeURIComponent(lineage.rootRequestId);
	return mentioned.map((participantId) => ({
		participantId,
		depth,
		rootRequestId: lineage.rootRequestId,
		requestId: `${PEER_REQUEST_PREFIX}${depth}/${input.speakerParticipantId}/${participantId}/${root}`,
		promptText: `Answer this public message from @${input.speakerHandle}:\n${input.publishedText.trim()}`,
	}));
}

/** @handles in first-seen order. An ASCII word or email does not start a mention; CJK text may sit against the @. */
export function mentionedParticipantIds(
	members: readonly { readonly id: string; readonly handle: string }[],
	text: string,
	excludeParticipantId?: string,
): readonly string[] {
	const ranked = [...members].sort((left, right) => right.handle.length - left.handle.length);
	const ids: string[] = [];
	let index = 0;
	while (index < text.length) {
		const at = text.indexOf("@", index);
		if (at < 0) break;
		if (!isMentionBoundary(text[at - 1])) {
			index = at + 1;
			continue;
		}
		const slice = text.slice(at + 1);
		const member = ranked.find((candidate) => {
			if (!candidate.handle) return false;
			const taken = slice.slice(0, candidate.handle.length);
			return (
				normalizeHandle(taken) === normalizeHandle(candidate.handle) && isMentionEnd(slice[candidate.handle.length])
			);
		});
		if (!member || member.id === excludeParticipantId || ids.includes(member.id)) {
			index = at + 1;
			continue;
		}
		ids.push(member.id);
		index = at + 1 + member.handle.length;
	}
	return ids;
}

/** A peer-room message addresses only the people it names. No mention starts nobody. */
export function peerMentionTargets(team: TeamDefinition, requestedMemberIds: readonly string[]): readonly string[] {
	const members = new Set(team.members.map((member) => member.id));
	const unique = [...new Set(requestedMemberIds)];
	for (const memberId of unique) {
		if (!members.has(memberId)) throw new Error(`Unknown team member: ${memberId}`);
	}
	return unique;
}

function isMentionBoundary(previous: string | undefined): boolean {
	if (previous === undefined) return true;
	return !/[A-Za-z0-9._]/u.test(previous);
}

function isMentionEnd(next: string | undefined): boolean {
	if (next === undefined) return true;
	return !/[\p{L}\p{N}_-]/u.test(next);
}
