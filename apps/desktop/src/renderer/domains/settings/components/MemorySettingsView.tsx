import { SettingSection, SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { MemorySettingsModel } from "./useMemorySettingsModel";

export function MemorySettingsView({ model }: { readonly model: MemorySettingsModel }): JSX.Element {
	return (
		<SettingsPageShellView
			title={model.labels.title}
			description={model.status === "loading" ? undefined : model.labels.description}
			loading={model.status === "loading"}
			loadingLabel={model.labels.loading}
		>
			{model.status === "loading" ? null : (
				<SettingSection section={SETTINGS_SECTION["memory-global"]} title={model.labels.section}>
					{model.status === "error" ? (
						<p role="alert" className="px-5 py-4 text-[13px] text-foreground">
							{model.labels.loadError}
						</p>
					) : model.entries.length === 0 ? (
						<p className="px-5 py-4 text-[13px] text-muted-foreground">{model.labels.empty}</p>
					) : (
						<ul className="m-0 list-none p-0">
							{model.entries.map((entry) => (
								<li key={entry.id} className="border-b border-border px-5 py-4 last:border-b-0">
									<div className="mb-2 flex items-center gap-2">
										<time dateTime={entry.recordedAt} className="text-[12px] text-muted-foreground">
											{entry.recordedAt}
										</time>
										<span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] text-primary">
											{model.labels.categories[entry.category]}
										</span>
									</div>
									<p className="whitespace-pre-wrap text-[13px] text-foreground">{entry.text}</p>
								</li>
							))}
						</ul>
					)}
				</SettingSection>
			)}
		</SettingsPageShellView>
	);
}
