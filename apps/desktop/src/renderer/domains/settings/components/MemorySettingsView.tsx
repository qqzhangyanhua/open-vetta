import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { cn } from "@shared/lib/utils";
import { MotionSelect, SettingRow, SettingSection, SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { Switch } from "@vetta-org/ui";
import {
	MEMORY_CATEGORIES,
	type GlobalMemoryEntry,
	type MemoryCategory,
	type MemoryScope,
	type ProjectMemoryKind,
} from "@/shared/memory";
import { SETTINGS_SECTION } from "../registry";
import type { MemoryEntryDraft, MemorySettingsModel } from "./useMemorySettingsModel";

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
					{showCategoryFilter(model) ? (
						<div className="px-5 pt-3">
							<MotionSelect
								aria-label={model.labels.categoryFilter}
								value={model.categoryFilter}
								onValueChange={model.actions.setCategoryFilter}
								options={[
									{ value: "all", label: model.labels.categoryAll },
									...Object.entries(model.labels.categories).map(([value, label]) => ({ value, label })),
								]}
								triggerClassName="h-8 min-w-[160px]"
							/>
						</div>
					) : null}
					{model.entryError ? (
						<p role="alert" className="px-5 pt-3 text-[13px] text-foreground">
							{model.entryError === "delete" ? model.labels.deleteError : model.labels.entrySaveError}
						</p>
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
		model.scopeEntryCount === 0 && (model.scope === "global" || model.orphanedProjects.length === 0);
	const showCategoryEmpty = model.scopeEntryCount > 0 && model.entries.length === 0;
	return (
		<>
			{showEmpty ? (
				<p className="px-5 py-4 text-[13px] text-muted-foreground">
					{model.scope === "project" ? model.labels.projectEmpty : model.labels.empty}
				</p>
			) : null}
			{showCategoryEmpty ? (
				<p className="px-5 py-4 text-[13px] text-muted-foreground">{model.labels.categoryEmpty}</p>
			) : null}
			{model.entries.length > 0 ? (
				<ul className="m-0 list-none p-0">
					{model.entries.map((entry) => (
						<MemoryEntryRow key={entry.id} model={model} entry={entry} />
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
								<div className="mb-2 flex items-center gap-2">
									<time dateTime={entry.recordedAt} className="text-[12px] text-muted-foreground">
										{entry.recordedAt}
									</time>
									<span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] text-primary">
										{model.labels.categories[entry.category]}
									</span>
								</div>
								<p className="whitespace-pre-wrap text-[13px] text-foreground">{entry.text}</p>
								<div className="mt-2 flex flex-wrap gap-2">
									<Button
										type="button"
										variant="destructive"
										size="sm"
										disabled={model.orphanBusy}
										aria-label={model.labels.deleteEntryOf(entry.text)}
										onClick={() => model.actions.deleteOrphanedEntry(project.path, entry.id)}
									>
										{model.labels.orphanDeleteEntry}
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

function MemoryEntryRow({
	model,
	entry,
}: {
	readonly model: MemorySettingsModel;
	readonly entry: GlobalMemoryEntry;
}): JSX.Element {
	const editing = model.draft?.id === entry.id;
	const confirming = model.confirmDeleteId === entry.id;
	const category = editing && model.draft ? model.draft.category : entry.category;
	return (
		<li className="group border-b border-border px-5 py-4 last:border-b-0">
			<div className="mb-2 flex items-center gap-2">
				<time dateTime={entry.recordedAt} className="text-[12px] text-muted-foreground">
					{entry.recordedAt}
				</time>
				<span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] text-primary">
					{model.labels.categories[category]}
				</span>
				<div className="ml-auto flex items-center gap-0.5">
					<PinToggle model={model} entry={entry} />
					{editing || confirming ? null : (
						<>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
								aria-label={model.labels.editEntry(entry.text)}
								title={model.labels.editEntry(entry.text)}
								disabled={model.savingEntry}
								onClick={() => model.actions.startEdit(entry)}
							>
								<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
								aria-label={model.labels.deleteEntry(entry.text)}
								title={model.labels.deleteEntry(entry.text)}
								disabled={model.savingEntry}
								onClick={() => model.actions.requestDelete(entry.id)}
							>
								<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							</Button>
						</>
					)}
				</div>
			</div>
			{editing && model.draft ? (
				<MemoryEntryEditor model={model} draft={model.draft} />
			) : (
				<p className="whitespace-pre-wrap text-[13px] text-foreground">{entry.text}</p>
			)}
			{confirming ? <MemoryDeleteConfirm model={model} /> : null}
		</li>
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
			className={cn(pinned && "text-primary")}
		>
			<span className={cn("h-3.5 w-3.5", pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]")} />
			{pinned ? model.labels.unpin : model.labels.pin}
		</Button>
	);
}

function MemoryEntryEditor({
	model,
	draft,
}: {
	readonly model: MemorySettingsModel;
	readonly draft: MemoryEntryDraft;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			<Textarea
				aria-label={model.labels.editText}
				value={draft.text}
				disabled={model.savingEntry}
				onChange={(event) => model.actions.setDraftText(event.target.value)}
				className="min-h-16 text-[13px]"
			/>
			<div className="flex flex-wrap items-center gap-2">
				<MotionSelect
					aria-label={model.labels.editCategory}
					value={draft.category}
					disabled={model.savingEntry}
					onValueChange={(value) => {
						if (isMemoryCategory(value)) model.actions.setDraftCategory(value);
					}}
					options={Object.entries(model.labels.categories).map(([value, label]) => ({ value, label }))}
					triggerClassName="h-8 min-w-[140px]"
				/>
				<MotionSelect
					aria-label={model.labels.editScope}
					value={draft.scope}
					disabled={model.savingEntry}
					onValueChange={(value) => {
						if (value === "global" || value === "project") model.actions.setDraftScope(value);
					}}
					options={[
						{ value: "global", label: model.labels.scopeToGlobal },
						{ value: "project", label: model.labels.scopeToProject },
					]}
					triggerClassName="h-8 min-w-[140px]"
				/>
				{draft.scope === "project" && model.projects.length > 0 ? (
					<MotionSelect
						aria-label={model.labels.moveProject}
						value={draft.projectPath}
						disabled={model.savingEntry}
						onValueChange={model.actions.setDraftProject}
						options={model.projects.map((project) => ({
							value: project.path,
							label: projectOptionLabel(project, model.labels.conversationProject),
						}))}
						triggerClassName="h-8 min-w-[220px] max-w-full"
					/>
				) : null}
			</div>
			{draft.scope === "project" && model.projects.length === 0 ? (
				<p className="text-[13px] text-muted-foreground">{model.labels.noProjectTarget}</p>
			) : null}
			<div className="flex items-center gap-2">
				<Button
					type="button"
					size="xs"
					disabled={!model.canSaveEdit}
					title={model.labels.saveEntryTitle}
					onClick={model.actions.saveEdit}
				>
					{model.labels.saveEntry}
				</Button>
				<Button
					type="button"
					size="xs"
					variant="outline"
					disabled={model.savingEntry}
					onClick={model.actions.cancelEdit}
				>
					{model.labels.cancelEdit}
				</Button>
			</div>
		</div>
	);
}

function MemoryDeleteConfirm({ model }: { readonly model: MemorySettingsModel }): JSX.Element {
	return (
		<div role="group" aria-label={model.labels.deleteConfirmTitle} className="mt-2">
			<p className="text-[13px] text-muted-foreground">{model.labels.deleteConfirmMessage}</p>
			<div className="mt-2 flex items-center gap-2">
				<Button
					type="button"
					size="xs"
					variant="destructive"
					disabled={model.savingEntry}
					onClick={model.actions.confirmDelete}
				>
					{model.labels.deleteConfirm}
				</Button>
				<Button
					type="button"
					size="xs"
					variant="outline"
					disabled={model.savingEntry}
					onClick={model.actions.cancelDelete}
				>
					{model.labels.cancelDelete}
				</Button>
			</div>
		</div>
	);
}

function showCategoryFilter(model: MemorySettingsModel): boolean {
	if (model.scopeEntryCount === 0) return false;
	if (model.status === "error" && model.scope === "global") return false;
	if (model.scope === "project" && model.projectLoadError) return false;
	return true;
}

function isMemoryCategory(value: string): value is MemoryCategory {
	return (MEMORY_CATEGORIES as readonly string[]).includes(value);
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
