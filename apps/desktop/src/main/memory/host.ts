import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { completeSimple } from "@vetta/ai";
import { getOrCreateSharedModelRuntime } from "../agent-runtime/host-services.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { DesktopMemoryService } from "./service.js";
import { memoryTranscriptEntries } from "./transcript.js";

let service: DesktopMemoryService | undefined;

export function getDesktopMemoryService(): DesktopMemoryService {
	service ??= new DesktopMemoryService({
		directory: join(getVettaHomePath(), "memory"),
		now: () => new Date(),
		createId: () => crypto.randomUUID(),
		logger: {
			warn: (...args) => {
				getAppLogger("memory").warn(...args);
			},
		},
		source(runtimeId) {
			let snapshot: ReturnType<ReturnType<typeof getSharedRuntime>["getState"]>;
			let document: ReturnType<ReturnType<typeof getSharedRuntime>["readSessionDocument"]>;
			try {
				const runtime = getSharedRuntime();
				snapshot = runtime.getState(runtimeId);
				document = runtime.readSessionDocument(runtimeId);
			} catch {
				throw new Error("memory:session-unavailable");
			}
			const model = snapshot.model;
			if (!model) throw new Error("memory:model-unavailable");
			const cwd = document.identity.cwd?.trim();
			if (!cwd) throw new Error("memory:session-unavailable");
			return {
				modelKey: `${model.provider}/${model.id}`,
				cwd,
				entries: memoryTranscriptEntries(document),
			};
		},
		listModels() {
			return textModels().map((model) => ({
				modelKey: modelKeyOf(model),
				label: model.name.trim() ? `${model.provider} / ${model.name}` : modelKeyOf(model),
			}));
		},
		async complete(request) {
			const models = getOrCreateSharedModelRuntime();
			const model = textModels().find((entry) => modelKeyOf(entry) === request.modelKey);
			if (!model) throw new Error("memory:model-unavailable");
			const apiKey = await models.getApiKey(model);
			if (!apiKey) throw new Error("memory:model-unavailable");
			const response = await completeSimple(
				model,
				{
					systemPrompt: request.system,
					messages: [{ role: "user", content: request.user, timestamp: Date.now() }],
				},
				{ apiKey, maxTokens: 2_048, signal: request.signal },
			);
			if (response.stopReason === "error") throw new Error("memory:generation-failed");
			const text = response.content
				.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("\n")
				.trim();
			if (!text) throw new Error("memory:invalid-output");
			return text;
		},
	});
	return service;
}

function textModels() {
	return getOrCreateSharedModelRuntime()
		.getAvailable()
		.filter((model) => model.input.includes("text"));
}

function modelKeyOf(model: { readonly provider: string; readonly id: string }): string {
	return `${model.provider}/${model.id}`;
}
