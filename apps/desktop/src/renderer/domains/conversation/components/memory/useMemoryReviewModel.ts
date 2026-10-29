import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { memoryCategoryLabels } from "@shared/memory/category-labels";
import {
	createContext,
	createElement,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { DesktopMemoryApi, MemoryCandidate, MemoryCategory, SaveMemoryCandidate } from "@/shared/memory";

export type MemoryReviewPhase = "closed" | "loading" | "empty" | "error" | "candidates" | "saving";

export interface MemoryDraft {
	readonly id: string;
	readonly text: string;
	readonly category: MemoryCategory;
	readonly selected: boolean;
}

export interface MemoryReviewModel {
	readonly phase: MemoryReviewPhase;
	readonly drafts: readonly MemoryDraft[];
	readonly errorMessage: string | null;
	readonly labels: {
		readonly menu: string;
		readonly generate: string;
		readonly title: string;
		readonly loading: string;
		readonly loadingHint: string;
		readonly empty: string;
		readonly retry: string;
		readonly close: string;
		readonly save: string;
		readonly saving: string;
		readonly category: string;
		readonly discardHint: string;
		readonly categories: Record<MemoryCategory, string>;
	};
	readonly actions: {
		readonly start: () => Promise<void>;
		readonly close: () => void;
		readonly retry: () => Promise<void>;
		readonly toggle: (id: string) => void;
		readonly editText: (id: string, text: string) => void;
		readonly editCategory: (id: string, category: MemoryCategory) => void;
		readonly save: () => Promise<void>;
	};
}

function errorCodeOf(error: unknown): string {
	if (!(error instanceof Error)) return "memory:generation-failed";
	const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /u, "");
	if (message.startsWith("memory:")) return message;
	return "memory:generation-failed";
}

export function useMemoryReviewModel(runtimeId: string | null, client: DesktopMemoryApi | null): MemoryReviewModel {
	const { t } = useTranslation("chat");
	const [phase, setPhase] = useState<MemoryReviewPhase>("closed");
	const [drafts, setDrafts] = useState<MemoryDraft[]>([]);
	const [errorCode, setErrorCode] = useState<string | null>(null);
	const [failureKind, setFailureKind] = useState<"generate" | "save" | null>(null);
	const generationRef = useRef(0);
	const seenRuntime = useRef(runtimeId);

	useEffect(() => {
		if (seenRuntime.current === runtimeId) return;
		seenRuntime.current = runtimeId;
		generationRef.current += 1;
		setPhase("closed");
		setDrafts([]);
		setErrorCode(null);
		setFailureKind(null);
	}, [runtimeId]);

	const start = useCallback(async () => {
		const generation = generationRef.current + 1;
		generationRef.current = generation;
		const capturedRuntimeId = runtimeId;
		setPhase("loading");
		setDrafts([]);
		setErrorCode(null);
		setFailureKind(null);
		await waitForCommittedPaint();
		if (generationRef.current !== generation) return;
		if (!client || !capturedRuntimeId) {
			setErrorCode("memory:session-unavailable");
			setFailureKind("generate");
			setPhase("error");
			return;
		}
		try {
			const result = await client.generate(capturedRuntimeId);
			if (generationRef.current !== generation) return;
			if (result.status === "empty") {
				setPhase("empty");
				return;
			}
			setDrafts(result.candidates.map((candidate: MemoryCandidate) => ({ ...candidate, selected: true })));
			setPhase("candidates");
		} catch (error) {
			if (generationRef.current !== generation) return;
			setErrorCode(errorCodeOf(error));
			setFailureKind("generate");
			setPhase("error");
		}
	}, [client, runtimeId]);

	const close = useCallback(() => {
		generationRef.current += 1;
		setPhase("closed");
		setDrafts([]);
		setErrorCode(null);
		setFailureKind(null);
	}, []);

	const toggle = useCallback((id: string) => {
		setDrafts((current) =>
			current.map((draft) => (draft.id === id ? { ...draft, selected: !draft.selected } : draft)),
		);
	}, []);

	const editText = useCallback((id: string, text: string) => {
		setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, text } : draft)));
	}, []);

	const editCategory = useCallback((id: string, category: MemoryCategory) => {
		setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, category } : draft)));
	}, []);

	const save = useCallback(async () => {
		if (!client) return;
		const generation = generationRef.current;
		const selected: SaveMemoryCandidate[] = drafts
			.filter((draft) => draft.selected && draft.text.trim())
			.map((draft) => ({ id: draft.id, text: draft.text.trim(), category: draft.category }));
		setPhase("saving");
		setErrorCode(null);
		try {
			await client.save(selected);
			if (generationRef.current !== generation) return;
			setPhase("closed");
			setDrafts([]);
		} catch (error) {
			if (generationRef.current !== generation) return;
			setErrorCode(errorCodeOf(error));
			setFailureKind("save");
			setPhase("candidates");
		}
	}, [client, drafts]);

	const errorMessage = (() => {
		if (!errorCode || !failureKind) return null;
		if (errorCode === "memory:session-unavailable") return t("memoryReview.sessionUnavailable");
		if (errorCode === "memory:store-rejected") return t("memoryReview.storeRejected");
		if (errorCode === "memory:model-unavailable") return t("memoryReview.modelUnavailable");
		if (failureKind === "save") return t("memoryReview.saveFailed");
		return t("memoryReview.error");
	})();

	return {
		phase,
		drafts,
		errorMessage,
		labels: {
			menu: t("memoryReview.menu"),
			generate: t("memoryReview.generate"),
			title: t("memoryReview.title"),
			loading: t("memoryReview.loading"),
			loadingHint: t("memoryReview.loadingHint"),
			empty: t("memoryReview.empty"),
			retry: t("memoryReview.retry"),
			close: t("memoryReview.close"),
			save: t("memoryReview.save"),
			saving: t("memoryReview.saving"),
			category: t("memoryReview.category"),
			discardHint: t("memoryReview.discardHint"),
			categories: memoryCategoryLabels(t),
		},
		actions: { start, close, retry: start, toggle, editText, editCategory, save },
	};
}

const MemoryReviewStartContext = createContext<(() => Promise<void>) | null>(null);

/** ChatView owns the one review model. Slash and message actions call the same start. */
export function MemoryReviewStartProvider({
	start,
	children,
}: {
	readonly start: () => Promise<void>;
	readonly children: ReactNode;
}): ReactElement {
	return createElement(MemoryReviewStartContext.Provider, { value: start, children });
}

export function useMemoryReviewStart(): (() => Promise<void>) | null {
	return useContext(MemoryReviewStartContext);
}
