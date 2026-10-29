import type { DesktopMemoryApi } from "@/shared/memory";
import { MemorySettingsView } from "./MemorySettingsView";
import { useMemorySettingsModel } from "./useMemorySettingsModel";

export function MemorySettings({
	client = window.vetta?.memory ?? null,
	projectPath,
}: {
	readonly client?: DesktopMemoryApi | null;
	readonly projectPath?: string;
} = {}): JSX.Element {
	const model = useMemorySettingsModel(client, projectPath);
	return <MemorySettingsView model={model} />;
}
