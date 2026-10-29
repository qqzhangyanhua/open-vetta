import { MotionSelect, SettingRow, SettingSection, SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { Switch } from "@vetta-org/ui";
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
					{model.status === "error" ? null : (
						<SettingRow title={model.labels.readEnabled} description={model.labels.readEnabledDescription}>
							<Switch
								checked={model.readEnabled}
								onCheckedChange={model.actions.setReadEnabled}
								aria-label={model.labels.readEnabledAria}
								title={model.labels.readEnabledTitle}
							/>
						</SettingRow>
					)}
					<SettingRow title={model.labels.model} description={model.labels.modelDescription}>
						{model.modelInvalid ? (
							<p role="alert" className="max-w-sm text-[13px] text-foreground">
								{model.labels.modelInvalid}
							</p>
						) : null}
						<MotionSelect
							aria-label={model.labels.model}
							value={model.modelOverride ?? ""}
							disabled={model.savingModel}
							onValueChange={(value) => model.actions.setModelOverride(value ? value : null)}
							options={modelOptions(model)}
							triggerClassName="h-8 min-w-[220px]"
						/>
					</SettingRow>
					{model.modelSaveError ? (
						<p role="alert" className="px-5 pb-4 text-[13px] text-foreground">
							{model.labels.modelSaveError}
						</p>
					) : null}
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

function modelOptions(model: MemorySettingsModel): readonly { value: string; label: string }[] {
	const options = [
		{ value: "", label: model.labels.modelUnset },
		...model.modelChoices.map((choice) => ({ value: choice.modelKey, label: choice.label })),
	];
	if (model.modelOverride && !options.some((option) => option.value === model.modelOverride)) {
		options.push({ value: model.modelOverride, label: model.modelOverride });
	}
	return options;
}
