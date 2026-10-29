import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { MotionSelect, SettingRow, SettingSection, SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { Switch } from "@vetta-org/ui";
import type { GlobalMemoryEntry, MemoryScope, ProjectMemoryProject } from "@/shared/memory";
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
					<SettingRow
						title={model.labels.projectReadEnabled}
						description={model.labels.projectReadEnabledDescription}
					>
						<Switch
							checked={model.projectReadEnabled}
							onCheckedChange={model.actions.setProjectReadEnabled}
							aria-label={model.labels.projectReadEnabledAria}
							title={model.labels.projectReadEnabledTitle}
						/>
					</SettingRow>
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
					<MemoryScopeTabs model={model} />
					{model.scope === "project" && model.projects.length > 0 ? (
						<div className="px-5 pt-3">
							<MotionSelect
								aria-label={model.labels.projectFilter}
								value={model.selectedProjectPath}
								onValueChange={model.actions.setSelectedProject}
								options={model.projects.map((project) => ({
									value: project.path,
									label: projectOptionLabel(project, model.labels.conversationProject),
								}))}
								triggerClassName="h-8 min-w-[220px] max-w-full"
							/>
						</div>
					) : null}
					<MemoryEntryList model={model} />
				</SettingSection>
			)}
		</SettingsPageShellView>
	);
}

function MemoryScopeTabs({ model }: { readonly model: MemorySettingsModel }): JSX.Element {
	return (
		<div role="tablist" aria-label={model.labels.scopeLabel} className="flex items-center gap-1 px-5 pt-3">
			<ScopeTab model={model} scope="global" label={model.labels.scopeGlobal} />
			<ScopeTab model={model} scope="project" label={model.labels.scopeProject} />
		</div>
	);
}

function ScopeTab({
	model,
	scope,
	label,
}: {
	readonly model: MemorySettingsModel;
	readonly scope: MemoryScope;
	readonly label: string;
}): JSX.Element {
	const active = model.scope === scope;
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={() => model.actions.setScope(scope)}
			className={cn(
				"inline-flex cursor-pointer items-center rounded-full px-2.5 py-1 text-[12px] transition-colors",
				active ? "bg-accent/50 text-foreground" : "text-muted-foreground/70 hover:bg-accent/25 hover:text-foreground",
			)}
		>
			{label}
		</button>
	);
}

function MemoryEntryList({ model }: { readonly model: MemorySettingsModel }): JSX.Element {
	if (model.status === "error" && model.scope === "global") {
		return (
			<p role="alert" className="px-5 py-4 text-[13px] text-foreground">
				{model.labels.loadError}
			</p>
		);
	}
	if (model.scope === "project" && model.projectLoadError) {
		return (
			<p role="alert" className="px-5 py-4 text-[13px] text-foreground">
				{model.labels.projectLoadError}
			</p>
		);
	}
	if (model.entries.length === 0) {
		return (
			<p className="px-5 py-4 text-[13px] text-muted-foreground">
				{model.scope === "project" ? model.labels.projectEmpty : model.labels.empty}
			</p>
		);
	}
	return (
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
						<PinToggle model={model} entry={entry} />
					</div>
					<p className="whitespace-pre-wrap text-[13px] text-foreground">{entry.text}</p>
				</li>
			))}
		</ul>
	);
}

function PinToggle({
	model,
	entry,
}: {
	readonly model: MemorySettingsModel;
	readonly entry: GlobalMemoryEntry;
}): JSX.Element {
	const pinned = entry.pinned === true;
	return (
		<Button
			type="button"
			variant="ghost"
			size="xs"
			aria-pressed={pinned}
			aria-label={pinned ? model.labels.unpinAria(entry.text) : model.labels.pinAria(entry.text)}
			onClick={() => model.actions.setPinned(entry.id, !pinned)}
			className={cn("ml-auto", pinned && "text-primary")}
		>
			<span className={cn("h-3.5 w-3.5", pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]")} />
			{pinned ? model.labels.unpin : model.labels.pin}
		</Button>
	);
}

function projectOptionLabel(project: ProjectMemoryProject, conversationLabel: string): string {
	return project.kind === "conversation" ? conversationLabel : project.path;
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
