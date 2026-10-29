import { memoryCategoryLabels } from "@shared/memory/category-labels";
import { confirmDialogAtom } from "@shared/store/atoms";
import { sameProjectLocation } from "@vetta/ssh-transport";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	DesktopMemoryApi,
	GlobalMemoryEntry,
	MemoryCategory,
	MemoryKnownProject,
	MemoryModelChoice,
	MemoryScope,
	ProjectMemoryProject,
} from "@/shared/memory";

export interface MemorySettingsModel {
	readonly status: "loading" | "ready" | "error";
	readonly scope: MemoryScope;
	/** 当前范围下要展示的条目。全局读失败时为空，避免把失败画成空列表。 */
	readonly entries: readonly GlobalMemoryEntry[];
	/** 仍在项目列表里的项目。失联项目不进筛选。 */
	readonly projects: readonly ProjectMemoryProject[];
	readonly orphanedProjects: readonly ProjectMemoryProject[];
	readonly knownProjects: readonly MemoryKnownProject[];
	readonly selectedProjectPath: string;
	readonly projectLoadError: boolean;
	readonly readEnabled: boolean;
	readonly projectReadEnabled: boolean;
	readonly modelOverride: string | null;
	readonly modelChoices: readonly MemoryModelChoice[];
	readonly modelInvalid: boolean;
	readonly savingModel: boolean;
	readonly modelSaveError: boolean;
	readonly orphanBusy: boolean;
	readonly orphanActionError: boolean;
	readonly reattachTarget: (path: string) => string;
	readonly actions: {
		readonly setReadEnabled: (enabled: boolean) => void;
		readonly setProjectReadEnabled: (enabled: boolean) => void;
		readonly setScope: (scope: MemoryScope) => void;
		readonly setSelectedProject: (path: string) => void;
		readonly setModelOverride: (modelKey: string | null) => void;
		readonly setReattachTarget: (path: string, targetPath: string) => void;
		readonly deleteOrphanedEntry: (path: string, entryId: string) => void;
		readonly deleteOrphanedGroup: (path: string) => void;
		readonly reattachOrphaned: (path: string, entryId?: string) => void;
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
		readonly orphanedGroup: string;
		readonly deleteEntry: string;
		readonly deleteGroup: string;
		readonly reattach: string;
		readonly reattachEntry: string;
		readonly orphanActionError: string;
		readonly deleteEntryOf: (text: string) => string;
		readonly deleteGroupOf: (path: string) => string;
		readonly reattachOf: (path: string) => string;
		readonly reattachEntryOf: (text: string) => string;
		readonly reattachTargetOf: (path: string) => string;
		readonly categories: Record<MemoryCategory, string>;
	};
}

export function useMemorySettingsModel(client: DesktopMemoryApi | null, projectPath?: string): MemorySettingsModel {
	const { t } = useTranslation("settings");
	const { t: tChat } = useTranslation("chat");
	const { t: tCommon } = useTranslation("common");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const [status, setStatus] = useState<MemorySettingsModel["status"]>("loading");
	const [entries, setEntries] = useState<GlobalMemoryEntry[]>([]);
	const [projects, setProjects] = useState<ProjectMemoryProject[]>([]);
	const [knownProjects, setKnownProjects] = useState<readonly MemoryKnownProject[]>([]);
	const [projectLoadError, setProjectLoadError] = useState(false);
	const [scope, setScope] = useState<MemoryScope>(projectPath ? "project" : "global");
	const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(projectPath ?? null);
	const [readEnabled, setReadEnabled] = useState(true);
	const [projectReadEnabled, setProjectReadEnabled] = useState(true);
	const writeGeneration = useRef(0);
	const projectWriteGeneration = useRef(0);
	const orphanLock = useRef(false);
	const [modelOverride, setModelOverride] = useState<string | null>(null);
	const [modelChoices, setModelChoices] = useState<readonly MemoryModelChoice[]>([]);
	const [modelInvalid, setModelInvalid] = useState(false);
	const [savingModel, setSavingModel] = useState(false);
	const [modelSaveError, setModelSaveError] = useState(false);
	const [orphanBusy, setOrphanBusy] = useState(false);
	const [orphanActionError, setOrphanActionError] = useState(false);
	const [reattachTargets, setReattachTargets] = useState<Readonly<Record<string, string>>>({});

	useEffect(() => {
		if (!projectPath) return;
		setScope("project");
		setSelectedProjectPath(projectPath);
	}, [projectPath]);

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
			client.listKnownProjects().then(
				(next) => next,
				() => [],
			),
			client.getModelOverride().then(
				(override) => ({ ok: true as const, override }),
				() => ({ ok: false as const }),
			),
			client.listModels().then(
				(choices) => choices,
				() => [],
			),
		]).then(([list, read, projectRead, projectList, known, model, choices]) => {
			if (cancelled) return;
			const ready = list.ok && read.ok;
			setEntries(ready ? list.entries : []);
			setReadEnabled(read.ok ? read.enabled : true);
			setStatus(ready ? "ready" : "error");
			setProjectReadEnabled(projectRead.ok ? projectRead.enabled : true);
			setProjects(projectList.ok ? projectList.projects : []);
			setProjectLoadError(!projectList.ok);
			setKnownProjects(known);
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

	const runOrphan = async (task: () => Promise<ProjectMemoryProject[]>) => {
		if (!client || orphanLock.current) return;
		orphanLock.current = true;
		setOrphanBusy(true);
		setOrphanActionError(false);
		try {
			setProjects(await task());
		} catch {
			setOrphanActionError(true);
		} finally {
			orphanLock.current = false;
			setOrphanBusy(false);
		}
	};

	const confirmDelete = (title: string, message: string, run: () => Promise<ProjectMemoryProject[]>) => {
		setConfirm({
			title,
			message,
			confirmLabel: tCommon("actions.delete"),
			variant: "danger",
			onConfirm: () => {
				void runOrphan(run);
			},
		});
	};

	const liveProjects = projects.filter((project) => !project.orphaned);
	const orphanedProjects = projects.filter((project) => project.orphaned);
	const selectedLive = selectLiveProject(liveProjects, selectedProjectPath);
	const visibleEntries = scope === "global" ? entries : (selectedLive?.entries ?? []);
	const reattachTarget = (path: string) => reattachTargets[path] ?? knownProjects[0]?.path ?? "";

	return {
		status,
		scope,
		entries: visibleEntries,
		projects: liveProjects,
		orphanedProjects,
		knownProjects,
		selectedProjectPath: selectedLive?.path ?? "",
		projectLoadError,
		readEnabled,
		projectReadEnabled,
		modelOverride,
		modelChoices,
		modelInvalid,
		savingModel,
		modelSaveError,
		orphanBusy,
		orphanActionError,
		reattachTarget,
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
			setReattachTarget(path, targetPath) {
				setReattachTargets((current) => ({ ...current, [path]: targetPath }));
			},
			deleteOrphanedEntry(path, entryId) {
				const project = orphanedProjects.find((item) => item.path === path);
				const entry = project?.entries.find((item) => item.id === entryId);
				if (!client || !project || !entry) return;
				confirmDelete(t("memoryPage.deleteEntryTitle"), t("memoryPage.deleteEntryMessage"), () =>
					client.deleteOrphanedProjectMemory({ path, entryId }),
				);
			},
			deleteOrphanedGroup(path) {
				const project = orphanedProjects.find((item) => item.path === path);
				if (!client || !project) return;
				confirmDelete(t("memoryPage.deleteGroupTitle"), t("memoryPage.deleteGroupMessage", { path }), () =>
					client.deleteOrphanedProjectMemory({ path }),
				);
			},
			reattachOrphaned(path, entryId) {
				const targetPath = reattachTarget(path);
				if (!client || !targetPath) return;
				void runOrphan(() =>
					client.reattachOrphanedProjectMemory(
						entryId === undefined ? { path, targetPath } : { path, targetPath, entryId },
					),
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
			orphanedGroup: t("memoryPage.orphanedGroup"),
			deleteEntry: t("memoryPage.deleteEntry"),
			deleteGroup: t("memoryPage.deleteGroup"),
			reattach: t("memoryPage.reattach"),
			reattachEntry: t("memoryPage.reattachEntry"),
			orphanActionError: t("memoryPage.orphanActionError"),
			deleteEntryOf: (text) => t("memoryPage.deleteEntryOf", { text }),
			deleteGroupOf: (path) => t("memoryPage.deleteGroupOf", { path }),
			reattachOf: (path) => t("memoryPage.reattachOf", { path }),
			reattachEntryOf: (text) => t("memoryPage.reattachEntryOf", { text }),
			reattachTargetOf: (path) => t("memoryPage.reattachTargetOf", { path }),
			categories: memoryCategoryLabels(tChat),
		},
	};
}

/** 指定了路径却对不上时保持空，不要退回第一个项目。 */
function selectLiveProject(
	live: readonly ProjectMemoryProject[],
	selectedPath: string | null,
): ProjectMemoryProject | null {
	if (selectedPath === null) return live[0] ?? null;
	return (
		live.find((project) => project.path === selectedPath) ??
		live.find((project) => samePath(project.path, selectedPath)) ??
		null
	);
}

function samePath(left: string, right: string): boolean {
	try {
		return sameProjectLocation(left, right);
	} catch {
		return false;
	}
}
