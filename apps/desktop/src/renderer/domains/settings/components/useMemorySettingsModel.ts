import { memoryCategoryLabels } from "@shared/memory/category-labels";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type DesktopMemoryApi,
	type GlobalMemoryEntry,
	type MemoryCategory,
	type MemoryModelChoice,
	type MemoryScope,
	memoryEntryWithPinned,
	type ProjectMemoryProject,
} from "@/shared/memory";

export interface MemorySettingsModel {
	readonly status: "loading" | "ready" | "error";
	readonly scope: MemoryScope;
	/** 当前范围下要展示的条目。全局读失败时为空，避免把失败画成空列表。 */
	readonly entries: readonly GlobalMemoryEntry[];
	readonly projects: readonly ProjectMemoryProject[];
	readonly selectedProjectPath: string;
	readonly projectLoadError: boolean;
	readonly readEnabled: boolean;
	readonly projectReadEnabled: boolean;
	readonly modelOverride: string | null;
	readonly modelChoices: readonly MemoryModelChoice[];
	readonly modelInvalid: boolean;
	readonly savingModel: boolean;
	readonly modelSaveError: boolean;
	readonly actions: {
		readonly setReadEnabled: (enabled: boolean) => void;
		readonly setProjectReadEnabled: (enabled: boolean) => void;
		readonly setScope: (scope: MemoryScope) => void;
		readonly setSelectedProject: (path: string) => void;
		readonly setModelOverride: (modelKey: string | null) => void;
		readonly setPinned: (id: string, pinned: boolean) => void;
	};
	readonly labels: {
		readonly title: string;
		readonly description: string;
		readonly section: string;
		readonly empty: string;
		readonly projectEmpty: string;
		readonly loadError: string;
		readonly projectLoadError: string;
		readonly loading: string;
		readonly readEnabled: string;
		readonly readEnabledDescription: string;
		readonly readEnabledAria: string;
		readonly readEnabledTitle: string;
		readonly projectReadEnabled: string;
		readonly projectReadEnabledDescription: string;
		readonly projectReadEnabledAria: string;
		readonly projectReadEnabledTitle: string;
		readonly scopeLabel: string;
		readonly scopeGlobal: string;
		readonly scopeProject: string;
		readonly projectFilter: string;
		readonly conversationProject: string;
		readonly model: string;
		readonly modelDescription: string;
		readonly modelUnset: string;
		readonly modelInvalid: string;
		readonly modelSaveError: string;
		readonly pin: string;
		readonly unpin: string;
		readonly pinAria: (text: string) => string;
		readonly unpinAria: (text: string) => string;
		readonly categories: Record<MemoryCategory, string>;
	};
}

export function useMemorySettingsModel(client: DesktopMemoryApi | null): MemorySettingsModel {
	const { t } = useTranslation("settings");
	const { t: tChat } = useTranslation("chat");
	const [status, setStatus] = useState<MemorySettingsModel["status"]>("loading");
	const [entries, setEntries] = useState<GlobalMemoryEntry[]>([]);
	const [projects, setProjects] = useState<ProjectMemoryProject[]>([]);
	const [projectLoadError, setProjectLoadError] = useState(false);
	const [scope, setScope] = useState<MemoryScope>("global");
	const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
	const [readEnabled, setReadEnabled] = useState(true);
	const [projectReadEnabled, setProjectReadEnabled] = useState(true);
	const writeGeneration = useRef(0);
	const projectWriteGeneration = useRef(0);
	const [modelOverride, setModelOverride] = useState<string | null>(null);
	const [modelChoices, setModelChoices] = useState<readonly MemoryModelChoice[]>([]);
	const [modelInvalid, setModelInvalid] = useState(false);
	const [savingModel, setSavingModel] = useState(false);
	const [modelSaveError, setModelSaveError] = useState(false);
	const pinGeneration = useRef(new Map<string, number>());

	useEffect(() => {
		let cancelled = false;
		if (!client) {
			setStatus("error");
			return;
		}
		setStatus("loading");
		setModelSaveError(false);
		void Promise.all([
			client.listGlobal().then(
				(next) => ({ ok: true as const, entries: next }),
				() => ({ ok: false as const }),
			),
			client.getReadEnabled().then(
				(enabled) => ({ ok: true as const, enabled }),
				() => ({ ok: false as const }),
			),
			client.getProjectReadEnabled().then(
				(enabled) => ({ ok: true as const, enabled }),
				() => ({ ok: false as const }),
			),
			client.listProjects().then(
				(next) => ({ ok: true as const, projects: next }),
				() => ({ ok: false as const }),
			),
			client.getModelOverride().then(
				(override) => ({ ok: true as const, override }),
				() => ({ ok: false as const }),
			),
			client.listModels().then(
				(choices) => choices,
				() => [],
			),
		]).then(([list, read, projectRead, projectList, model, choices]) => {
			if (cancelled) return;
			const ready = list.ok && read.ok;
			setEntries(ready ? list.entries : []);
			setReadEnabled(read.ok ? read.enabled : true);
			setStatus(ready ? "ready" : "error");
			setProjectReadEnabled(projectRead.ok ? projectRead.enabled : true);
			setProjects(projectList.ok ? projectList.projects : []);
			setProjectLoadError(!projectList.ok);
			setModelOverride(model.ok ? model.override : null);
			setModelInvalid(!model.ok);
			setModelChoices(choices);
		});
		return () => {
			cancelled = true;
		};
	}, [client]);

	const setReadEnabledFromUser = (enabled: boolean) => {
		if (!client) return;
		const generation = ++writeGeneration.current;
		setReadEnabled(enabled);
		void client.setReadEnabled(enabled).then(
			(stored) => {
				if (writeGeneration.current === generation) setReadEnabled(stored);
			},
			() => {
				if (writeGeneration.current === generation) setReadEnabled(!enabled);
			},
		);
	};

	const setProjectReadEnabledFromUser = (enabled: boolean) => {
		if (!client) return;
		const generation = ++projectWriteGeneration.current;
		setProjectReadEnabled(enabled);
		void client.setProjectReadEnabled(enabled).then(
			(stored) => {
				if (projectWriteGeneration.current === generation) setProjectReadEnabled(stored);
			},
			() => {
				if (projectWriteGeneration.current === generation) setProjectReadEnabled(!enabled);
			},
		);
	};

	const selectedProject = projects.find((project) => project.path === selectedProjectPath) ?? projects[0] ?? null;
	const visibleEntries = scope === "global" ? entries : (selectedProject?.entries ?? []);

	const replacePinned = (targetScope: MemoryScope, projectPath: string, id: string, next: GlobalMemoryEntry) => {
		if (targetScope === "global") {
			setEntries((current) => current.map((entry) => (entry.id === id ? next : entry)));
			return;
		}
		setProjects((current) =>
			current.map((project) =>
				project.path === projectPath
					? { ...project, entries: project.entries.map((entry) => (entry.id === id ? next : entry)) }
					: project,
			),
		);
	};

	return {
		status,
		scope,
		entries: visibleEntries,
		projects,
		selectedProjectPath: selectedProject?.path ?? "",
		projectLoadError,
		readEnabled,
		projectReadEnabled,
		modelOverride,
		modelChoices,
		modelInvalid,
		savingModel,
		modelSaveError,
		actions: {
			setReadEnabled: setReadEnabledFromUser,
			setProjectReadEnabled: setProjectReadEnabledFromUser,
			setScope,
			setSelectedProject: setSelectedProjectPath,
			setModelOverride(modelKey) {
				if (!client) return;
				setSavingModel(true);
				setModelSaveError(false);
				void client.setModelOverride(modelKey).then(
					() => {
						setModelOverride(modelKey);
						setModelInvalid(false);
						setSavingModel(false);
					},
					() => {
						setModelSaveError(true);
						setSavingModel(false);
					},
				);
			},
			setPinned(id, pinned) {
				if (!client) return;
				const current = visibleEntries.find((entry) => entry.id === id);
				if (!current) return;
				const targetScope = scope;
				const projectPath = selectedProject?.path ?? "";
				if (targetScope === "project" && !projectPath) return;
				const generation = (pinGeneration.current.get(id) ?? 0) + 1;
				pinGeneration.current.set(id, generation);
				replacePinned(targetScope, projectPath, id, memoryEntryWithPinned(current, pinned));
				void client
					.setPinned({
						id,
						scope: targetScope,
						...(targetScope === "project" ? { projectPath } : {}),
						pinned,
					})
					.then(
						(stored) => {
							if (pinGeneration.current.get(id) === generation)
								replacePinned(targetScope, projectPath, id, stored);
						},
						() => {
							if (pinGeneration.current.get(id) === generation)
								replacePinned(targetScope, projectPath, id, current);
						},
					);
			},
		},
		labels: {
			title: t("memoryPage.title"),
			description: t("memoryPage.description"),
			section: t("section_memory-global"),
			empty: t("memoryPage.empty"),
			projectEmpty: t("memoryPage.projectEmpty"),
			loadError: t("memoryPage.loadError"),
			projectLoadError: t("memoryPage.projectLoadError"),
			loading: t("memoryPage.loading"),
			readEnabled: t("memoryPage.readEnabled"),
			readEnabledDescription: t("memoryPage.readEnabledDescription"),
			readEnabledAria: t("memoryPage.readEnabledAria"),
			readEnabledTitle: t("memoryPage.readEnabledTitle"),
			projectReadEnabled: t("memoryPage.projectReadEnabled"),
			projectReadEnabledDescription: t("memoryPage.projectReadEnabledDescription"),
			projectReadEnabledAria: t("memoryPage.projectReadEnabledAria"),
			projectReadEnabledTitle: t("memoryPage.projectReadEnabledTitle"),
			scopeLabel: t("memoryPage.scopeLabel"),
			scopeGlobal: t("memoryPage.scopeGlobal"),
			scopeProject: t("memoryPage.scopeProject"),
			projectFilter: t("memoryPage.projectFilter"),
			conversationProject: t("memoryPage.conversationProject"),
			model: t("memoryPage.model"),
			modelDescription: t("memoryPage.modelDescription"),
			modelUnset: t("memoryPage.modelUnset"),
			modelInvalid: t("memoryPage.modelInvalid"),
			modelSaveError: t("memoryPage.modelSaveError"),
			pin: t("memoryPage.pin"),
			unpin: t("memoryPage.unpin"),
			pinAria: (text) => t("memoryPage.pinAria", { text }),
			unpinAria: (text) => t("memoryPage.unpinAria", { text }),
			categories: memoryCategoryLabels(tChat),
		},
	};
}
