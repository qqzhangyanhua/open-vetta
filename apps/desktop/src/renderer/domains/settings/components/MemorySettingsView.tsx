import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { MotionSelect, SettingRow, SettingSection, SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { Switch } from "@vetta-org/ui";
import type { GlobalMemoryEntry, MemoryScope, ProjectMemoryKind } from "@/shared/memory";
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
	const showEmpty =
		model.entries.length === 0 && (model.scope === "global" || model.orphanedProjects.length === 0);
	return (
		<>
			{showEmpty ? (
				<p className="px-5 py-4 text-[13px] text-muted-foreground">
					{model.scope === "project" ? model.labels.projectEmpty : model.labels.empty}
				</p>
			) : null}
			{model.entries.length > 0 ? (
				<ul className="m-0 list-none p-0">
					{model.entries.map((entry) => (
						<li key={entry.id} className="border-b border-border px-5 py-4 last:border-b-0">
							<MemoryEntryBody entry={entry} category={model.labels.categories[entry.category]} />
						</li>
					))}
				</ul>
			) : null}
			{model.scope === "project" ? <OrphanedMemoryGroups model={model} /> : null}
		</>
	);
}

function OrphanedMemoryGroups({ model }: { readonly model: MemorySettingsModel }): JSX.Element | null {
	if (model.orphanedProjects.length === 0) return null;
	const canReattach = model.knownProjects.length > 0;
	return (
		<section>
			<h3 className="px-5 pt-4 text-[13px] text-foreground">{model.labels.orphanedGroup}</h3>
			{model.orphanedProjects.map((project) => (
				<div key={project.path} className="border-t border-border">
					<div className="flex flex-wrap items-center gap-2 px-5 pt-4">
						<p className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground" title={project.path}>
							{project.path}
						</p>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={model.orphanBusy}
							aria-label={model.labels.deleteGroupOf(project.path)}
							onClick={() => model.actions.deleteOrphanedGroup(project.path)}
						>
							{model.labels.deleteGroup}
						</Button>
						{canReattach ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={model.orphanBusy}
								aria-label={model.labels.reattachOf(project.path)}
								onClick={() => model.actions.reattachOrphaned(project.path)}
							>
								{model.labels.reattach}
							</Button>
						) : null}
					</div>
					{canReattach ? (
						<div className="px-5 pt-2">
							<MotionSelect
								aria-label={model.labels.reattachTargetOf(project.path)}
								value={model.reattachTarget(project.path)}
								disabled={model.orphanBusy}
								onValueChange={(value) => model.actions.setReattachTarget(project.path, value)}
								options={model.knownProjects.map((known) => ({
									value: known.path,
									label: projectOptionLabel(known, model.labels.conversationProject),
								}))}
								triggerClassName="h-8 min-w-[220px] max-w-full"
							/>
						</div>
					) : null}
					<ul className="m-0 list-none p-0">
						{project.entries.map((entry) => (
							<li key={entry.id} className="border-b border-border px-5 py-4 last:border-b-0">
								<MemoryEntryBody entry={entry} category={model.labels.categories[entry.category]} />
								<div className="mt-2 flex flex-wrap gap-2">
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={model.orphanBusy}
										aria-label={model.labels.deleteEntryOf(entry.text)}
										onClick={() => model.actions.deleteOrphanedEntry(project.path, entry.id)}
									>
										{model.labels.deleteEntry}
									</Button>
									{canReattach ? (
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={model.orphanBusy}
											aria-label={model.labels.reattachEntryOf(entry.text)}
											onClick={() => model.actions.reattachOrphaned(project.path, entry.id)}
										>
											{model.labels.reattachEntry}
										</Button>
									) : null}
								</div>
							</li>
						))}
					</ul>
				</div>
			))}
			{model.orphanActionError ? (
				<p role="alert" className="px-5 py-3 text-[13px] text-foreground">
					{model.labels.orphanActionError}
				</p>
			) : null}
		</section>
	);
}

function MemoryEntryBody({
	entry,
	category,
}: {
	readonly entry: GlobalMemoryEntry;
	readonly category: string;
}): JSX.Element {
	return (
		<>
			<div className="mb-2 flex items-center gap-2">
				<time dateTime={entry.recordedAt} className="text-[12px] text-muted-foreground">
					{entry.recordedAt}
				</time>
				<span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] text-primary">{category}</span>
			</div>
			<p className="whitespace-pre-wrap text-[13px] text-foreground">{entry.text}</p>
		</>
	);
}

function projectOptionLabel(
	project: { readonly kind: ProjectMemoryKind; readonly path: string },
	conversationLabel: string,
): string {
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
