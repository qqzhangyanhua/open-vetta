import { memoryCategoryLabels } from "@shared/memory/category-labels";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type DesktopMemoryApi,
	type GlobalMemoryEntry,
	MEMORY_CATEGORIES,
	type MemoryCategory,
	type MemoryModelChoice,
	type MemoryScope,
	type ProjectMemoryProject,
	type UpdateMemoryEntry,
} from "@/shared/memory";
import { relocateMemoryEntry, removeMemoryEntry } from "./memory-entry-relocate";

export interface MemoryEntryDraft {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
	readonly scope: MemoryScope;
	readonly projectPath: string;
}

export interface MemorySettingsModel {
	readonly status: "loading" | "ready" | "error";
	readonly scope: MemoryScope;
	/** 当前范围下、经过分类筛选后要展示的条目。全局读失败时为空，避免把失败画成空列表。 */
	readonly entries: readonly GlobalMemoryEntry[];
	/** 当前范围里筛选前的条数，用来区分「没有记忆」和「这个分类是空的」。 */
	readonly scopeEntryCount: number;
	readonly categoryFilter: MemoryCategory | "all";
	readonly projects: readonly ProjectMemoryProject[];
	readonly selectedProjectPath: string;
	readonly projectLoadError: boolean;
	readonly draft: MemoryEntryDraft | null;
	readonly confirmDeleteId: string | null;
	readonly canSaveEdit: boolean;
	readonly savingEntry: boolean;
	readonly entryError: "save" | "delete" | null;
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
		readonly setCategoryFilter: (value: string) => void;
		readonly startEdit: (entry: GlobalMemoryEntry) => void;
		readonly cancelEdit: () => void;
		readonly setDraftText: (text: string) => void;
		readonly setDraftCategory: (category: MemoryCategory) => void;
		readonly setDraftScope: (scope: MemoryScope) => void;
		readonly setDraftProject: (path: string) => void;
		readonly saveEdit: () => void;
		readonly requestDelete: (id: string) => void;
		readonly cancelDelete: () => void;
		readonly confirmDelete: () => void;
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
		readonly categories: Record<MemoryCategory, string>;
		readonly categoryFilter: string;
		readonly categoryAll: string;
		readonly categoryEmpty: string;
		readonly editEntry: (text: string) => string;
		readonly deleteEntry: (text: string) => string;
		readonly editText: string;
		readonly editCategory: string;
		readonly editScope: string;
		readonly scopeToGlobal: string;
		readonly scopeToProject: string;
		readonly moveProject: string;
		readonly noProjectTarget: string;
		readonly saveEntry: string;
		readonly saveEntryTitle: string;
		readonly cancelEdit: string;
		readonly entrySaveError: string;
		readonly deleteConfirmTitle: string;
		readonly deleteConfirmMessage: string;
		readonly deleteConfirm: string;
		readonly cancelDelete: string;
		readonly deleteError: string;
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
	const [categoryFilter, setCategoryFilter] = useState<MemoryCategory | "all">("all");
	const [draft, setDraft] = useState<MemoryEntryDraft | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [savingEntry, setSavingEntry] = useState(false);
	const [entryError, setEntryError] = useState<"save" | "delete" | null>(null);
	const entriesRef = useRef(entries);
	const projectsRef = useRef(projects);
	entriesRef.current = entries;
	projectsRef.current = projects;

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
	const scopedEntries = scope === "global" ? entries : (selectedProject?.entries ?? []);
	const visibleEntries =
		categoryFilter === "all" ? scopedEntries : scopedEntries.filter((entry) => entry.category === categoryFilter);
	const trimmedDraft = draft?.text.trim() ?? "";
	const canSaveEdit =
		draft !== null &&
		trimmedDraft.length > 0 &&
		(draft.scope === "global" || draft.projectPath.length > 0) &&
		!savingEntry;

	const setCategoryFilterFromUser = (value: string) => {
		if (value === "all") {
			setCategoryFilter("all");
			return;
		}
		if ((MEMORY_CATEGORIES as readonly string[]).includes(value)) setCategoryFilter(value as MemoryCategory);
	};

	const startEdit = (entry: GlobalMemoryEntry) => {
		setConfirmDeleteId(null);
		setEntryError(null);
		setDraft({
			id: entry.id,
			text: entry.text,
			category: entry.category,
			scope,
			projectPath: selectedProject?.path ?? projects[0]?.path ?? "",
		});
	};

	const saveEdit = () => {
		if (!client || !draft || !canSaveEdit) return;
		const update: UpdateMemoryEntry = {
			id: draft.id,
			text: draft.text.trim(),
			category: draft.category,
			scope: draft.scope,
			...(draft.scope === "project" ? { projectPath: draft.projectPath } : {}),
		};
		setSavingEntry(true);
		setEntryError(null);
		void client.updateEntry(update).then(
			() => {
				const next = relocateMemoryEntry(entriesRef.current, projectsRef.current, update);
				setEntries(next.entries);
				setProjects(next.projects);
				setDraft(null);
				setSavingEntry(false);
			},
			() => {
				setEntryError("save");
				setSavingEntry(false);
			},
		);
	};

	const confirmDelete = () => {
		if (!client || !confirmDeleteId || savingEntry) return;
		const id = confirmDeleteId;
		setSavingEntry(true);
		setEntryError(null);
		void client.deleteEntry(id).then(
			() => {
				const next = removeMemoryEntry(entriesRef.current, projectsRef.current, id);
				setEntries(next.entries);
				setProjects(next.projects);
				setConfirmDeleteId(null);
				setSavingEntry(false);
			},
			() => {
				setEntryError("delete");
				setSavingEntry(false);
			},
		);
	};

	return {
		status,
		scope,
		entries: visibleEntries,
		scopeEntryCount: scopedEntries.length,
		categoryFilter,
		projects,
		draft,
		confirmDeleteId,
		canSaveEdit,
		savingEntry,
		entryError,
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
			setCategoryFilter: setCategoryFilterFromUser,
			startEdit,
			cancelEdit() {
				setDraft(null);
				setEntryError(null);
			},
			setDraftText(text) {
				setDraft((current) => (current ? { ...current, text } : current));
			},
			setDraftCategory(category) {
				setDraft((current) => (current ? { ...current, category } : current));
			},
			setDraftScope(nextScope) {
				setDraft((current) =>
					current
						? { ...current, scope: nextScope, projectPath: current.projectPath || projects[0]?.path || "" }
						: current,
				);
			},
			setDraftProject(path) {
				setDraft((current) => (current ? { ...current, projectPath: path } : current));
			},
			saveEdit,
			requestDelete(id) {
				setDraft(null);
				setEntryError(null);
				setConfirmDeleteId(id);
			},
			cancelDelete() {
				setConfirmDeleteId(null);
				setEntryError(null);
			},
			confirmDelete,
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
			categories: memoryCategoryLabels(tChat),
			categoryFilter: t("memoryPage.categoryFilter"),
			categoryAll: t("memoryPage.categoryAll"),
			categoryEmpty: t("memoryPage.categoryEmpty"),
			editEntry: (text) => t("memoryPage.editEntry", { text }),
			deleteEntry: (text) => t("memoryPage.deleteEntry", { text }),
			editText: t("memoryPage.editText"),
			editCategory: t("memoryPage.editCategory"),
			editScope: t("memoryPage.editScope"),
			scopeToGlobal: t("memoryPage.scopeToGlobal"),
			scopeToProject: t("memoryPage.scopeToProject"),
			moveProject: t("memoryPage.moveProject"),
			noProjectTarget: t("memoryPage.noProjectTarget"),
			saveEntry: t("memoryPage.saveEntry"),
			saveEntryTitle: t("memoryPage.saveEntryTitle"),
			cancelEdit: t("memoryPage.cancelEdit"),
			entrySaveError: t("memoryPage.entrySaveError"),
			deleteConfirmTitle: t("memoryPage.deleteConfirmTitle"),
			deleteConfirmMessage: t("memoryPage.deleteConfirmMessage"),
			deleteConfirm: t("memoryPage.deleteConfirm"),
			cancelDelete: t("memoryPage.cancelDelete"),
			deleteError: t("memoryPage.deleteError"),
		},
	};
}
