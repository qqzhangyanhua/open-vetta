import { pathBasename } from "@shared/lib/utils";
import {
	activeBottomPanelTab,
	collectBottomPanelLeaves,
	emptyBottomPanelState,
	EXTERNAL_INVOCATION_COMPONENT_ID,
	type ExternalInvocationPanelPayload,
	findBottomPanelTab,
	reduceBottomPanel,
	type BottomPanelSessionState,
} from "@shared/store/bottom-panel-layout";
import { type JSX, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	SessionExternalInvocationPage,
	type ExternalInvocationClient,
	type ExternalInvocationClientEvent,
} from "./SessionExternalInvocationPage";

interface Transcript {
	readonly head: string;
	readonly tail: string;
	readonly discardedBytes: number;
}

function payloadOf(state: BottomPanelSessionState, tabId: string): ExternalInvocationPanelPayload | null {
	const tab = findBottomPanelTab(state.root, tabId)?.tab;
	if (!tab || tab.componentId !== EXTERNAL_INVOCATION_COMPONENT_ID) return null;
	const payload = tab.payload;
	if (typeof payload !== "object" || payload === null || !("status" in payload)) return null;
	return payload as ExternalInvocationPanelPayload;
}

export function ExternalInvocationTerminalSession({
	session,
	client,
	prompt,
	onPromptChange,
}: {
	readonly session: { sessionId: string; cwd: string };
	readonly client: ExternalInvocationClient;
	readonly prompt: string;
	readonly onPromptChange: (value: string) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [layout, setLayout] = useState<BottomPanelSessionState>(emptyBottomPanelState());
	const [transcripts, setTranscripts] = useState<Readonly<Record<string, Transcript>>>({});
	const [views, setViews] = useState<Readonly<Record<string, string>>>({});
	const [scrollTo, setScrollTo] = useState<string | null>(null);
	const [confirmTab, setConfirmTab] = useState<string | null>(null);
	const tabByInvocation = useRef<Record<string, string>>({});
	const tabByExternalSession = useRef<Record<string, string>>({});
	const [boundSessionId, setBoundSessionId] = useState(session.sessionId);
	if (boundSessionId !== session.sessionId) {
		setBoundSessionId(session.sessionId);
		tabByInvocation.current = {};
		tabByExternalSession.current = {};
		setLayout(emptyBottomPanelState());
		setTranscripts({});
		setViews({});
		setScrollTo(null);
		setConfirmTab(null);
	}
	const projectLabel = pathBasename(session.cwd);

	function open(invocationId: string, status: "running" | "finished"): void {
		setLayout((current) =>
			reduceBottomPanel(current, {
				type: "open-external-invocation",
				tabId: invocationId,
				newLeafId: `leaf-${invocationId}`,
				payload: { invocationId, status, agentLabel: "Grok", projectLabel },
			}),
		);
	}

	function tabIdFor(event: ExternalInvocationClientEvent): string {
		const known = event.externalSessionId ? tabByExternalSession.current[event.externalSessionId] : undefined;
		if (known) return known;
		return tabByInvocation.current[event.invocationId] ?? event.invocationId;
	}

	function remember(event: ExternalInvocationClientEvent): void {
		if (event.type === "running") {
			if (tabByInvocation.current[event.invocationId]) return;
			const existing = event.externalSessionId ? tabByExternalSession.current[event.externalSessionId] : undefined;
			if (existing) {
				tabByInvocation.current[event.invocationId] = existing;
				const separator = t("externalInvocation.separator", {
					n: event.ordinal ?? 1,
					time: event.startedAt ?? "",
					status: t("externalInvocation.status.running"),
				});
				setViews((current) => ({ ...current, [existing]: `${current[existing] ?? ""}\n${separator}\n` }));
			} else {
				tabByInvocation.current[event.invocationId] = event.invocationId;
				if (event.externalSessionId) tabByExternalSession.current[event.externalSessionId] = event.invocationId;
				open(event.invocationId, "running");
			}
		}
		if (event.type === "completed" || event.type === "failed" || event.type === "interrupted") {
			if (event.externalSessionId) {
				tabByExternalSession.current[event.externalSessionId] =
					tabByInvocation.current[event.invocationId] ?? event.invocationId;
			}
			open(tabIdFor(event), "finished");
		}
		const viewId = tabIdFor(event);
		if (event.type === "output") {
			setTranscripts((current) => {
				const prev = current[viewId] ?? { head: "", tail: "", discardedBytes: 0 };
				const next = prev.discardedBytes > 0 ? { ...prev, tail: prev.tail + (event.chunk ?? "") } : { ...prev, head: prev.head + (event.chunk ?? "") };
				return { ...current, [viewId]: next };
			});
			setViews((current) => ({ ...current, [viewId]: (current[viewId] ?? "") + (event.chunk ?? "") }));
		}
		if (event.type === "truncated") {
			const notice = t("externalInvocation.truncated", { bytes: event.discardedBytes ?? 0 });
			setTranscripts((current) => {
				const prev = current[viewId] ?? { head: "", tail: "", discardedBytes: 0 };
				return { ...current, [viewId]: { ...prev, discardedBytes: event.discardedBytes ?? 0 } };
			});
			setViews((current) => ({
				...current,
				[viewId]: `${current[viewId] ?? ""}\n${notice}\n`,
			}));
		}
	}

	const rememberRef = useRef(remember);
	rememberRef.current = remember;
	const wrapped = useMemo<ExternalInvocationClient>(
		() => ({
			...client,
			start: async (request) => {
				const started = await client.start(request);
				if (request.newSession || !request.externalSessionId) {
					rememberRef.current({ type: "running", invocationId: started.invocationId, agentId: request.agentId });
				}
				return started;
			},
			subscribe: (sessionId, listener) =>
				client.subscribe(sessionId, (event) => {
					rememberRef.current(event);
					listener(event);
				}),
		}),
		[client],
	);

	const active = activeBottomPanelTab(layout);
	const activeId = active?.componentId === EXTERNAL_INVOCATION_COMPONENT_ID ? active.tabId : null;
	const activePayload = activeId ? payloadOf(layout, activeId) : null;
	const tabs = collectBottomPanelLeaves(layout.root).flatMap((leaf) => leaf.tabs);
	const showing = layout.root !== null && !layout.collapsed;

	return (
		<div>
			<SessionExternalInvocationPage
				session={session}
				client={wrapped}
				prompt={prompt}
				onPromptChange={onPromptChange}
				showPrompt
				penguinTools={null}
				onViewInTerminal={(invocationId) => {
					const transcript = transcripts[invocationId];
					if (!views[invocationId] && transcript) {
						const notice =
							transcript.discardedBytes > 0
								? `\n${t("externalInvocation.truncated", { bytes: transcript.discardedBytes })}\n`
								: "";
						setViews((current) => ({
							...current,
							[invocationId]: `${transcript.head}${notice}${transcript.tail}`,
						}));
					}
					open(invocationId, payloadOf(layout, invocationId)?.status ?? "finished");
					setScrollTo(invocationId);
				}}
			/>
			{showing ? (
				<section aria-label={t("externalInvocation.panel")}>
					{tabs.map((tab) => (
						<button key={tab.tabId} type="button" aria-current={tab.tabId === activeId ? "true" : undefined}>
							{payloadOf(layout, tab.tabId)?.agentLabel ?? tab.tabId}
						</button>
					))}
					{activeId && activePayload ? (
						<div>
							<p>{activePayload.agentLabel}</p>
							<p>{activePayload.projectLabel}</p>
							<p>{activePayload.status === "running" ? t("externalInvocation.status.running") : t("externalInvocation.status.completed")}</p>
							<pre data-scroll-target={scrollTo === activeId ? activeId : undefined}>{views[activeId] ?? ""}</pre>
							<button
								type="button"
								disabled={activePayload.status === "running"}
								onClick={() => {
									if (activePayload.status === "running" || !activeId) return;
									setViews((current) => ({ ...current, [activeId]: "" }));
								}}
							>
								{t("externalInvocation.clear")}
							</button>
							<button
								type="button"
								onClick={() => {
									if (activePayload.status === "running") {
										setConfirmTab(activeId);
										return;
									}
									setLayout((current) => reduceBottomPanel(current, { type: "close-tab", tabId: activeId }));
								}}
							>
								{t("externalInvocation.closeTab")}
							</button>
						</div>
					) : null}
					{confirmTab ? (
						<div role="dialog" aria-label={t("externalInvocation.closeConfirm.title")}>
							<p>{t("externalInvocation.closeConfirm.message")}</p>
							<button
								type="button"
								onClick={() => {
									client.stop?.(confirmTab);
									setLayout((current) => reduceBottomPanel(current, { type: "close-tab", tabId: confirmTab }));
									setConfirmTab(null);
								}}
							>
								{t("externalInvocation.closeConfirm.confirm")}
							</button>
						</div>
					) : null}
				</section>
			) : null}
		</div>
	);
}
