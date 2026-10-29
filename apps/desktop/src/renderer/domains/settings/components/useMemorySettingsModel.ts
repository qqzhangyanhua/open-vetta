import { memoryCategoryLabels } from "@shared/memory/category-labels";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopMemoryApi, GlobalMemoryEntry, MemoryCategory } from "@/shared/memory";

export interface MemorySettingsModel {
	readonly status: "loading" | "ready" | "error";
	readonly entries: readonly GlobalMemoryEntry[];
	readonly labels: {
		readonly title: string;
		readonly description: string;
		readonly section: string;
		readonly empty: string;
		readonly loadError: string;
		readonly loading: string;
		readonly categories: Record<MemoryCategory, string>;
	};
}

export function useMemorySettingsModel(client: DesktopMemoryApi | null): MemorySettingsModel {
	const { t } = useTranslation("settings");
	const { t: tChat } = useTranslation("chat");
	const [status, setStatus] = useState<MemorySettingsModel["status"]>("loading");
	const [entries, setEntries] = useState<GlobalMemoryEntry[]>([]);

	useEffect(() => {
		let cancelled = false;
		if (!client) {
			setStatus("error");
			return;
		}
		setStatus("loading");
		void client.listGlobal().then(
			(next) => {
				if (cancelled) return;
				setEntries(next);
				setStatus("ready");
			},
			() => {
				if (cancelled) return;
				setStatus("error");
			},
		);
		return () => {
			cancelled = true;
		};
	}, [client]);

	return {
		status,
		entries,
		labels: {
			title: t("memoryPage.title"),
			description: t("memoryPage.description"),
			section: t("section_memory-global"),
			empty: t("memoryPage.empty"),
			loadError: t("memoryPage.loadError"),
			loading: t("memoryPage.loading"),
			categories: memoryCategoryLabels(tChat),
		},
	};
}
