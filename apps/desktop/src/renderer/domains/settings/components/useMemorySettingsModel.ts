import { memoryCategoryLabels } from "@shared/memory/category-labels";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopMemoryApi, GlobalMemoryEntry, MemoryCategory, MemoryModelChoice } from "@/shared/memory";

export interface MemorySettingsModel {
	readonly status: "loading" | "ready" | "error";
	readonly entries: readonly GlobalMemoryEntry[];
	readonly readEnabled: boolean;
	readonly modelOverride: string | null;
	readonly modelChoices: readonly MemoryModelChoice[];
	readonly modelInvalid: boolean;
	readonly savingModel: boolean;
	readonly modelSaveError: boolean;
	readonly actions: {
		readonly setReadEnabled: (enabled: boolean) => void;
		readonly setModelOverride: (modelKey: string | null) => void;
	};
	readonly labels: {
		readonly title: string;
		readonly description: string;
		readonly section: string;
		readonly empty: string;
		readonly loadError: string;
		readonly loading: string;
		readonly readEnabled: string;
		readonly readEnabledDescription: string;
		readonly readEnabledAria: string;
		readonly readEnabledTitle: string;
		readonly model: string;
		readonly modelDescription: string;
		readonly modelUnset: string;
		readonly modelInvalid: string;
		readonly modelSaveError: string;
		readonly categories: Record<MemoryCategory, string>;
	};
}

export function useMemorySettingsModel(client: DesktopMemoryApi | null): MemorySettingsModel {
	const { t } = useTranslation("settings");
	const { t: tChat } = useTranslation("chat");
	const [status, setStatus] = useState<MemorySettingsModel["status"]>("loading");
	const [entries, setEntries] = useState<GlobalMemoryEntry[]>([]);
	const [readEnabled, setReadEnabled] = useState(true);
	const writeGeneration = useRef(0);
	const [modelOverride, setModelOverride] = useState<string | null>(null);
	const [modelChoices, setModelChoices] = useState<readonly MemoryModelChoice[]>([]);
	const [modelInvalid, setModelInvalid] = useState(false);
	const [savingModel, setSavingModel] = useState(false);
	const [modelSaveError, setModelSaveError] = useState(false);

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
			client.getModelOverride().then(
				(override) => ({ ok: true as const, override }),
				() => ({ ok: false as const }),
			),
			client.listModels().then(
				(choices) => choices,
				() => [],
			),
		]).then(([list, read, model, choices]) => {
			if (cancelled) return;
			const ready = list.ok && read.ok;
			setEntries(ready ? list.entries : []);
			setReadEnabled(read.ok ? read.enabled : true);
			setStatus(ready ? "ready" : "error");
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

	return {
		status,
		entries,
		readEnabled,
		modelOverride,
		modelChoices,
		modelInvalid,
		savingModel,
		modelSaveError,
		actions: {
			setReadEnabled: setReadEnabledFromUser,
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
			loadError: t("memoryPage.loadError"),
			loading: t("memoryPage.loading"),
			readEnabled: t("memoryPage.readEnabled"),
			readEnabledDescription: t("memoryPage.readEnabledDescription"),
			readEnabledAria: t("memoryPage.readEnabledAria"),
			readEnabledTitle: t("memoryPage.readEnabledTitle"),
			model: t("memoryPage.model"),
			modelDescription: t("memoryPage.modelDescription"),
			modelUnset: t("memoryPage.modelUnset"),
			modelInvalid: t("memoryPage.modelInvalid"),
			modelSaveError: t("memoryPage.modelSaveError"),
			categories: memoryCategoryLabels(tChat),
		},
	};
}
