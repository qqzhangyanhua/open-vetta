import type { JSX } from "react";
import { MemoryReviewPanelView } from "./MemoryReviewPanelView";
import { SessionMemoryMenu } from "./SessionMemoryMenu";
import type { MemoryReviewModel } from "./useMemoryReviewModel";

/** Menu and review panel share one composition so the session test and ChatView stay aligned. */
export function sessionMemoryElements(model: MemoryReviewModel): {
	menu: JSX.Element;
	panel: JSX.Element | null;
} {
	return {
		menu: (
			<SessionMemoryMenu
				menuLabel={model.labels.menu}
				generateLabel={model.labels.generate}
				onGenerate={model.actions.start}
			/>
		),
		panel: model.phase === "closed" ? null : <MemoryReviewPanelView model={model} />,
	};
}
