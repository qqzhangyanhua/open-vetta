import { MEMORY_CATEGORIES, type MemoryCategory } from "@/shared/memory";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import type { MemoryReviewModel } from "./useMemoryReviewModel";

function readCategory(value: string): MemoryCategory {
	switch (value) {
		case "identity":
		case "family":
		case "location":
		case "work":
		case "preference":
		case "interest":
		case "other":
			return value;
		default:
			return "other";
	}
}

export function MemoryReviewPanelView({ model }: { readonly model: MemoryReviewModel }): JSX.Element {
	const { labels, phase } = model;
	const busy = phase === "saving";
	return (
		<section
			role="region"
			aria-label={labels.title}
			className="mx-4 mb-2 flex min-h-0 shrink flex-col overflow-hidden rounded-lg border border-border bg-card px-3 py-3"
		>
			<div className="mb-2 flex shrink-0 items-center justify-between gap-3">
				<h2 className="text-[13px] font-medium text-foreground">{labels.title}</h2>
				<Button type="button" variant="ghost" size="sm" onClick={model.actions.close} disabled={busy}>
					{labels.close}
				</Button>
			</div>
			{phase === "loading" ? (
				<div role="status">
					<p className="text-[13px] text-foreground">{labels.loading}</p>
					<p className="mt-1 text-[12px] text-muted-foreground">{labels.loadingHint}</p>
				</div>
			) : null}
			{phase === "error" ? (
				<div role="alert">
					<p className="text-[13px] text-foreground">{model.errorMessage}</p>
					<div className="mt-2">
						<Button type="button" variant="outline" size="sm" onClick={() => void model.actions.retry()}>
							{labels.retry}
						</Button>
					</div>
				</div>
			) : null}
			{phase === "empty" ? (
				<p role="status" className="text-[13px] text-foreground">
					{labels.empty}
				</p>
			) : null}
			{phase === "candidates" || phase === "saving" ? (
				<div className="flex min-h-0 shrink flex-col">
					{model.errorMessage ? (
						<p role="alert" className="mb-2 shrink-0 text-[13px] text-foreground">
							{model.errorMessage}
						</p>
					) : (
						<p className="mb-2 shrink-0 text-[12px] text-muted-foreground">{labels.discardHint}</p>
					)}
					<ul className="m-0 flex min-h-0 max-h-[46vh] shrink list-none flex-col gap-3 overflow-y-auto p-0">
						{model.drafts.map((draft) => (
							<li key={draft.id} className="rounded-lg border border-border bg-background p-2">
								<div className="mb-2 flex items-center gap-2">
									<input
										type="checkbox"
										checked={draft.selected}
										aria-label={draft.text}
										disabled={busy}
										onChange={() => model.actions.toggle(draft.id)}
									/>
									<select
										aria-label={labels.category}
										className="rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground"
										value={draft.category}
										disabled={busy}
										onChange={(event) => model.actions.editCategory(draft.id, readCategory(event.target.value))}
									>
										{MEMORY_CATEGORIES.map((category) => (
											<option key={category} value={category}>
												{labels.categories[category]}
											</option>
										))}
									</select>
									<span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] text-primary">
										{labels.categories[draft.category]}
									</span>
								</div>
								<Textarea
									value={draft.text}
									aria-label={draft.text}
									disabled={busy}
									onChange={(event) => model.actions.editText(draft.id, event.target.value)}
								/>
							</li>
						))}
					</ul>
					<div className="mt-3 shrink-0">
						<Button type="button" size="sm" onClick={() => void model.actions.save()} disabled={busy}>
							{busy ? labels.saving : labels.save}
						</Button>
					</div>
				</div>
			) : null}
		</section>
	);
}
