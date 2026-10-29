import { join } from "node:path";
import { getVettaHomePath } from "@vetta/coding-agent/config";
import type { AgentFeatureDefinition, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SessionExtensionDefinition } from "@vetta/runtime-core/session-extensions";
import { MEMORY_CATEGORIES, MEMORY_SCOPES, type MemoryCategory, type MemoryScope } from "../../shared/memory.js";
import {
	isRecallCategory,
	isRecallScope,
	RECALL_TOOL_NAME,
	type RecallQuery,
	type RecallSnapshot,
	readRecallSnapshot,
} from "./recall.js";
import { sessionReadsGlobalMemory } from "./session-read.js";

const RECALL_EXTENSION_ID = "desktop.curated-recall";

export const RECALL_TOOL_DESCRIPTION = [
	"Look up facts from User memory or Project memory that were not loaded into this prompt.",
	"Read-only: this cannot add, change, or delete facts.",
	"keyword matches fact text. category and scope are optional.",
	"scope global is about the user across projects. scope project is only the current project.",
	"Facts from a closed scope or another project are never returned.",
	"Returns [] when nothing unloaded matches.",
].join(" ");

const RECALL_TOOL_INPUT_SCHEMA: Readonly<Record<string, unknown>> = {
	type: "object",
	additionalProperties: false,
	required: ["keyword"],
	properties: {
		keyword: {
			type: "string",
			minLength: 1,
			maxLength: 200,
			description: "Text to find inside a saved fact. Matches a substring, ignoring letter case.",
		},
		category: {
			type: "string",
			enum: [...MEMORY_CATEGORIES],
			description: "Optional category filter.",
		},
		scope: {
			type: "string",
			enum: [...MEMORY_SCOPES],
			description: "Optional scope filter: global or the current project.",
		},
	},
};

export function validateRecallInput(input: Record<string, unknown>): RecallQuery {
	const keyword = input.keyword;
	if (typeof keyword !== "string") throw new Error("recall:invalid-keyword");
	const trimmed = keyword.trim();
	if (trimmed.length === 0 || trimmed.length > 200) throw new Error("recall:invalid-keyword");
	const categoryValue = input.category;
	let category: MemoryCategory | undefined;
	if (categoryValue !== undefined) {
		if (typeof categoryValue !== "string" || !isRecallCategory(categoryValue)) {
			throw new Error("recall:invalid-category");
		}
		category = categoryValue;
	}
	const scopeValue = input.scope;
	let scope: MemoryScope | undefined;
	if (scopeValue !== undefined) {
		if (typeof scopeValue !== "string" || !isRecallScope(scopeValue)) {
			throw new Error("recall:invalid-scope");
		}
		scope = scopeValue;
	}
	return {
		keyword: trimmed,
		...(category === undefined ? {} : { category }),
		...(scope === undefined ? {} : { scope }),
	};
}

export function createRecallTool(snapshot: RecallSnapshot): RuntimeToolDefinition<RecallQuery> {
	return {
		name: RECALL_TOOL_NAME,
		label: "Recall",
		description: RECALL_TOOL_DESCRIPTION,
		inputSchema: RECALL_TOOL_INPUT_SCHEMA,
		validateInput: validateRecallInput,
		async execute({ input }) {
			const hits = snapshot.search(input);
			return {
				content: [{ type: "text", text: JSON.stringify(hits) }],
				details: { count: hits.length },
			};
		},
	};
}

/** 非交互式会话和子会话不注册。开关在每一轮绑定时再读，关掉后下一条消息才消失。 */
export function createCuratedRecallSessionExtensions(session: {
	readonly scenario?: string;
	readonly parentSessionPath?: string;
	readonly cwd?: string;
}): readonly SessionExtensionDefinition[] {
	const cwd = session.cwd?.trim();
	if (!cwd || !sessionReadsGlobalMemory(session)) return [];
	return [
		{
			id: RECALL_EXTENSION_ID,
			create: () => ({
				contributions: [{ kind: "agent-feature", feature: createRecallFeature(cwd) }],
				dispose() {},
			}),
		},
	];
}

function createRecallFeature(cwd: string): AgentFeatureDefinition {
	return {
		id: RECALL_EXTENSION_ID,
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { modelCallProviders: [createRecallProvider(cwd)] };
				},
				async dispose() {},
			};
		},
	};
}

function createRecallProvider(cwd: string) {
	const readTool = () => {
		// 和提示词同一时刻读文件：本轮中途的保存或开关只对下一条用户消息可见。
		const snapshot = readRecallSnapshot({ directory: join(getVettaHomePath(), "memory"), cwd });
		return snapshot.visible ? createRecallTool(snapshot) : undefined;
	};
	return {
		id: RECALL_EXTENSION_ID,
		bindForTurn() {
			const tool = readTool();
			return {
				id: RECALL_EXTENSION_ID,
				async contribute(callContext: { readonly signal: AbortSignal }) {
					callContext.signal.throwIfAborted();
					return tool ? { tools: [tool] } : {};
				},
			};
		},
		async contribute(callContext: { readonly signal: AbortSignal }) {
			callContext.signal.throwIfAborted();
			const tool = readTool();
			return tool ? { tools: [tool] } : {};
		},
	};
}
