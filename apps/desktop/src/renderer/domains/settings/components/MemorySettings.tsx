import type { DesktopMemoryApi } from "@/shared/memory";
import { MemorySettingsView } from "./MemorySettingsView";
import { useMemorySettingsModel } from "./useMemorySettingsModel";

export function MemorySettings({
	client = window.vetta?.memory ?? null,
}: {
	readonly client?: DesktopMemoryApi | null;
} = {}): JSX.Element {
	const model = useMemorySettingsModel(client);
	return <MemorySettingsView model={model} />;
}
